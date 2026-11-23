import assert from "node:assert/strict";
import { after, test } from "node:test";
const { S, socketClient, freshWindow, tick } = await import("./fixtures/socketHarness.mjs");
const { useControlledTabs } = await import("../app/controlledTabs.ts");
const { useControlServer, useControlIndicator } = await import("../app/programControl.ts");
const { viewTabIds, familyKeyOf } = await import("../browser/model.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");
const stub = await import("../../test-native/index.ts");

const targetOf = new Map();
globalThis.acTestCliTargets = (id) => ({ targetId: targetOf.get(id) ?? `T-${id}`, pageGeneration: 1 });
const dialogs = shellNativeModules.ArdiaDialogs;
const originalConfirm = dialogs.confirm;
const asked = [];
dialogs.confirm = (options) => {
  asked.push(options);
  return Promise.resolve({ confirmed: false, suppressed: false });
};
after(() => {
  dialogs.confirm = originalConfirm;
  delete globalThis.acTestCliTargets;
  S().updateSettings({ cliControl: false, shareTabsAcrossWindows: false });
});

const shown = () => useControlledTabs.getState().tabs;
const loaded = (id) => S().tabs[id]?.page.kind === "loaded" || S().tabs[id]?.page.kind === "adopted";
const settle = async () => {
  for (let i = 0; i < 20; i++) await tick();
};

async function waitFor(check, what, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (check()) return;
  assert.fail(`waited ${ms} ms for ${what}`);
}

test("controlling marks only the tabs named by targetId, with the caller's name, and replaces the list", async () => {
  const { windowId, tab } = await freshWindow();
  const other = S().newTab(windowId, { url: "https://b.example/" });
  S().activate(other);
  assert.ok(loaded(tab) && loaded(other), "both tabs have pages");
  targetOf.set(tab, "T-A");
  targetOf.set(other, "T-B");
  const claude = socketClient(301);
  await claude.ok("hello", { caller: { name: "Claude" } });
  assert.deepEqual(await claude.ok("controlling", { targets: ["T-A", "T-unknown"] }), { ok: true, tabs: [tab] });
  assert.deepEqual(shown(), { [tab]: "Claude" });
  assert.deepEqual(await claude.ok("controlling", { targets: ["T-B"] }), { ok: true, tabs: [other] });
  assert.equal(shown()[other], "Claude");
  assert.equal(shown()[tab], "Claude", "the tab it stopped driving keeps its mark for the hold");
  await waitFor(() => !shown()[tab], "the hold to end", 4500);
  assert.deepEqual(shown(), { [other]: "Claude" });
  assert.deepEqual(await claude.ok("controlling", { targets: [] }), { ok: true, tabs: [] });
});

test("a caller with no name is ardia; closing the connection and turning control off release its tabs", async () => {
  const { tab } = await freshWindow();
  targetOf.set(tab, "T-C");
  const plain = socketClient(302);
  await plain.ok("hello");
  await plain.ok("controlling", { targets: ["T-C"] });
  assert.deepEqual(shown(), { [tab]: "ardia" });
  stub.emitControlClose(302);
  await settle();
  assert.equal(shown()[tab], "ardia", "held after the connection closes");
  await waitFor(() => !shown()[tab], "the closed connection's hold to end", 4500);

  await plain.ok("controlling", { targets: ["T-C"] });
  assert.ok(shown()[tab]);
  S().updateSettings({ cliControl: false });
  await settle();
  assert.deepEqual(shown(), {}, "turning control off clears every mark at once");
});

test("controlling checks its params", async () => {
  await freshWindow();
  const c = socketClient(303);
  assert.equal((await c.call("controlling", {})).error.code, "bad_request");
  assert.equal((await c.call("controlling", { targets: "T" })).error.code, "bad_request");
  assert.equal((await c.call("controlling", { targets: [1] })).error.code, "bad_request");
  assert.equal((await c.call("controlling", { targets: Array.from({ length: 65 }, (_, i) => `T${i}`) })).error.code, "bad_request");
  const methods = await c.ok("methods");
  assert.ok(methods.some((m) => m.name === "controlling" && m.mutates === false));
});

test("with shared tabs the mark follows the tab's family into every window", async () => {
  const { windowId, tab } = await freshWindow();
  S().updateSettings({ shareTabsAcrossWindows: true });
  const second = S().createWindow({});
  const copy = viewTabIds(S(), second).find((id) => id !== tab && familyKeyOf(S().tabs[id]) === familyKeyOf(S().tabs[tab]));
  assert.ok(copy, "the second window lists a copy of the tab");
  targetOf.set(tab, "T-S");
  const c = socketClient(304);
  await c.ok("hello", { caller: { name: "Claude Code" } });
  await c.ok("controlling", { targets: ["T-S"] });
  assert.equal(useControlledTabs.getState().families[familyKeyOf(S().tabs[copy])], "Claude Code");
  assert.ok(S().windows[windowId]);
  await c.ok("controlling", { targets: [] });
  S().updateSettings({ shareTabsAcrossWindows: false });
});

test("an announcing client keeps the window-wide pill hidden; a CDP client that never announces shows it after 1.5 s", async (t) => {
  await freshWindow();
  const c = socketClient(305);
  await c.ok("hello", { caller: { name: "Claude" } });
  await c.ok("controlling", { targets: [] });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  useControlServer.setState({ server: { state: "on", connections: 1, generation: 11, file: "" } });
  t.mock.timers.tick(2000);
  assert.equal(useControlIndicator.getState().shown, false, "the announcing client's CDP connection shows no window pill");
  stub.emitControlClose(305);
  useControlServer.setState({ server: { state: "on", connections: 1, generation: 12, file: "" } });
  assert.equal(useControlIndicator.getState().shown, false);
  t.mock.timers.tick(1500);
  assert.equal(useControlIndicator.getState().shown, true);
  useControlServer.setState({ server: { state: "on", connections: 0, generation: 13, file: "" } });
  t.mock.timers.tick(3000);
  assert.equal(useControlIndicator.getState().shown, false);
});

test("windows.create agent opens the caller's window behind and answers with its tab's targetId", async () => {
  const { windowId } = await freshWindow();
  const focusedBefore = S().ui.focusOrder[0];
  const c = socketClient(306);
  const reply = await c.call("windows.create", { agent: true, url: "https://agent.example/" });
  assert.ok(!reply.error, JSON.stringify(reply.error));
  const made = S().windows[reply.result.id];
  const tab = made.activeTabIds[made.profileId];
  assert.equal(made.agent, true);
  assert.equal(reply.result.agent, true);
  assert.equal(reply.result.activeTab, tab);
  assert.equal(S().tabs[tab].url, "https://agent.example/");
  assert.equal(reply.result.targetId, `T-${tab}`);
  assert.equal(S().ui.focusOrder[0], focusedBefore ?? windowId, "the user's window keeps focus");
  const plain = await c.ok("windows.create", {});
  assert.equal(plain.agent, false);
  assert.equal(plain.targetId, undefined);
});

test("windows.close on an agent window closes it without asking and leaves every shared user tab in place", async () => {
  const { windowId, tab } = await freshWindow("https://mine.example/");
  S().updateSettings({ shareTabsAcrossWindows: true, warnBeforeClosingWindow: true, warnBeforeClosingLastTab: true });
  const mine2 = S().newTab(windowId, { url: "https://mine2.example/" });
  const c = socketClient(307);
  const created = await c.ok("windows.create", { agent: true, url: "https://agent.example/" });
  const made = S().windows[created.id];
  S().newTab(made.id, { url: "https://agent2.example/", background: true });
  assert.ok(!viewTabIds(S(), made.id).some((id) => S().tabs[id].url === "https://mine.example/"), "the agent window lists none of the user's tabs");
  assert.ok(!viewTabIds(S(), windowId).some((id) => S().tabs[id].url.startsWith("https://agent")), "and the user's window none of the agent's");
  asked.length = 0;
  const closed = await c.call("windows.close", { window: made.id });
  assert.ok(!closed.error, JSON.stringify(closed.error));
  await settle();
  assert.equal(asked.length, 0, "nothing asked");
  assert.equal(S().windows[made.id], undefined, "the agent window closed");
  assert.ok(S().tabs[tab] && S().tabs[mine2], "the user's tabs stay");
  assert.deepEqual(viewTabIds(S(), windowId).map((id) => S().tabs[id].url).sort(), ["https://mine.example/", "https://mine2.example/"], "without the agent's tabs");
  S().updateSettings({ shareTabsAcrossWindows: false });
});
