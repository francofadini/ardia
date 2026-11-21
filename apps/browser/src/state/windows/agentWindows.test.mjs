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

test("a user's tab swapped into the agent window (its shared copy activated there) survives closing the agent window", () => {
  const { user, mine, agent } = userAndAgent({ share: true });
  const copy = inWindow(agent, "https://mine.com/");
  assert.ok(copy && copy !== mine);
  S().activate(copy);
  assert.equal(S().tabs[mine].windowId, agent, "activating the copy swaps the user's live tab into the agent window");
  const result = closeAgentWindow(agent);
  assert.ok(inWindow(user, "https://mine.com/"), "mine.com stays in the user's window");
  assert.ok(inWindow(user, "https://mine2.com/"));
  assert.equal(anywhere("https://agent.com/").length, 0, "the agent's tab closed everywhere");
  assert.deepEqual(result, { closed: true });
  assert.equal(S().windows[agent], undefined);
  S().updateSettings({ shareTabsAcrossWindows: false });
});

test("the agent's own tab swapped out to the user's window still closes with the agent window", () => {
  const { user, agent, agentTab } = userAndAgent({ share: true });
  const copyInUser = inWindow(user, "https://agent.com/");
  assert.ok(copyInUser && copyInUser !== agentTab);
  S().activate(copyInUser);
  assert.equal(S().tabs[agentTab].windowId, user, "the agent's live tab moved to the user's window");
  assert.deepEqual(closeAgentWindow(agent), { closed: true });
  assert.equal(anywhere("https://agent.com/").length, 0);
  assert.deepEqual(urls(user), ["https://mine.com/", "https://mine2.com/"]);
  S().updateSettings({ shareTabsAcrossWindows: false });
});

test("closing the agent's last tab after a swap asks nothing and never takes the user's tab", async () => {
  const { user, mine, agent, agentTab } = userAndAgent({ share: true });
  S().activate(inWindow(agent, "https://mine.com/"));
  S().activate(agentTab);
  const dialogs = noDialogs();
  await closeTab(agentTab);
  dialogs.restore();
  assert.equal(dialogs.asked.length, 0);
  assert.ok(S().tabs[mine] || inWindow(user, "https://mine.com/"), "mine.com survives");
  assert.ok(inWindow(user, "https://mine.com/"));
  assert.equal(anywhere("https://agent.com/").length, 0);
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
