import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { viewTabIds, familyKeyOf } = await import("../browser/model.ts");
const { closeAgentWindow } = await import("./agentWindows.ts");
const { closeTab } = await import("../browser/actions.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const urls = (w) => viewTabIds(S(), w).map((id) => S().tabs[id].url).sort();
const inWindow = (w, url) => viewTabIds(S(), w).find((id) => S().tabs[id].url === url);
const anywhere = (url) => Object.values(S().tabs).filter((t) => t.url === url);

function userAndAgent({ share }) {
  S().hydrate({});
  S().updateSettings({ shareTabsAcrossWindows: share, warnBeforeClosingWindow: true, warnBeforeClosingLastTab: true });
  const user = S().createWindow({ url: "https://mine.com/" });
  const mine = S().windows[user].tabIds[0];
  S().newTab(user, { url: "https://mine2.com/" });
  S().activate(mine);
  const agent = S().createWindow({ url: "https://agent.com/", agent: true, background: true });
  return { user, mine, agent, agentTab: S().windows[agent].tabIds.find((id) => S().tabs[id].url === "https://agent.com/") };
}

function noDialogs() {
  const asked = [];
  const original = shellNativeModules.ArdiaDialogs.confirm;
  shellNativeModules.ArdiaDialogs.confirm = (o) => (asked.push(o), Promise.resolve({ confirmed: false, suppressed: false }));
  return { asked, restore: () => (shellNativeModules.ArdiaDialogs.confirm = original) };
}

test("the agent's window records the tabs it opened, and nothing else", () => {
  const { agent, agentTab } = userAndAgent({ share: true });
  const later = S().newTab(agent, { url: "https://agent2.com/" });
  assert.deepEqual(S().windows[agent].agentTabs, [agentTab, later]);
  S().updateSettings({ shareTabsAcrossWindows: false });
});

test("with shared tabs, the agent's window lists none of the user's tabs and the user's window none of the agent's", () => {
  const { user, agent, agentTab } = userAndAgent({ share: true });
  S().updateTab(agentTab, { url: "https://agent.com/next", title: "Next" });
  const later = S().newTab(agent, { url: "https://agent2.com/", background: true });
  assert.deepEqual(urls(agent), ["https://agent.com/next", "https://agent2.com/"]);
  assert.deepEqual(urls(user), ["https://mine.com/", "https://mine2.com/"]);
  assert.equal(anywhere("https://agent.com/next").length, 1, "no copy of the agent's tab anywhere");
  assert.equal(anywhere("https://mine.com/").length, 1, "no copy of the user's tab anywhere");
  assert.ok(S().tabs[later]);
  S().updateSettings({ shareTabsAcrossWindows: false });
});

test("closing the agent's last tab asks nothing and leaves the user's tabs alone", async () => {
  const { user, mine, agent, agentTab } = userAndAgent({ share: true });
  const dialogs = noDialogs();
  await closeTab(agentTab);
  dialogs.restore();
  assert.equal(dialogs.asked.length, 0);
  assert.equal(S().windows[agent], undefined);
  assert.ok(S().tabs[mine]);
  assert.deepEqual(urls(user), ["https://mine.com/", "https://mine2.com/"]);
  assert.equal(anywhere("https://agent.com/").length, 0);
  S().updateSettings({ shareTabsAcrossWindows: false });
});

test("a user's window closing hands its tabs to another of the user's windows, never to the agent's", () => {
  const { user, agent } = userAndAgent({ share: true });
  const other = S().createWindow({ url: "https://other.com/" });
  const work = S().createProfile({ name: "Work" });
  S().newTab(user, { url: "https://work.com/", profileId: work, background: true });
  S().setFocusedWindow(user);
  S().setFocusedWindow(agent);
  S().closeWindow(user);
  assert.equal(anywhere("https://work.com/").length, 1, "the Work tab survives");
  assert.equal(anywhere("https://work.com/")[0].windowId, other);
  assert.deepEqual(urls(agent), ["https://agent.com/"]);
  S().updateSettings({ shareTabsAcrossWindows: false });
});

test("a tab the user dragged into the agent window survives: the window stays open as theirs", () => {
  const { user, agent, agentTab } = userAndAgent({ share: false });
  const dragged = inWindow(user, "https://mine2.com/");
  S().moveTabsToWindow([dragged], agent);
  assert.equal(S().tabs[dragged].windowId, agent);
  assert.ok(!S().windows[agent].agentTabs.includes(dragged));
  const result = closeAgentWindow(agent);
  assert.equal(result.closed, false);
  assert.deepEqual(result.kept, [dragged]);
  assert.ok(S().tabs[dragged], "the dragged tab survives");
  assert.equal(S().tabs[agentTab], undefined, "the agent's tab closed");
  assert.equal(S().windows[agent].agent, undefined, "the window is the user's now");
  assert.equal(S().windows[agent].agentTabs, undefined);
});

test("a tab the agent opened and the user dragged out isn't the agent's to close any more", () => {
  const { user, agent } = userAndAgent({ share: false });
  const second = S().newTab(agent, { url: "https://agent2.com/" });
  S().moveTabsToWindow([second], user);
  assert.ok(!S().windows[agent].agentTabs.includes(second));
  assert.deepEqual(closeAgentWindow(agent), { closed: true });
  assert.ok(S().tabs[second]);
});

test("the agent's own tabs close, the window goes and nothing asks", () => {
  const { user, agent } = userAndAgent({ share: true });
  S().newTab(agent, { url: "https://agent2.com/", background: true });
  const dialogs = noDialogs();
  const result = closeAgentWindow(agent);
  dialogs.restore();
  assert.deepEqual(result, { closed: true });
  assert.equal(dialogs.asked.length, 0);
  assert.equal(anywhere("https://agent.com/").length + anywhere("https://agent2.com/").length, 0);
  assert.deepEqual(urls(user), ["https://mine.com/", "https://mine2.com/"]);
  assert.ok(viewTabIds(S(), user).every((id) => familyKeyOf(S().tabs[id])));
  S().updateSettings({ shareTabsAcrossWindows: false });
});
