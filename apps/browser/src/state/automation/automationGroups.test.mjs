import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { startAutomation } = await import("./controlSocket.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let nextId = 0;

async function controlOn() {
  S().hydrate({});
  S().updateSettings({ cliControl: true });
  startAutomation();
  for (let i = 0; i < 5 && !stub.controlSocket.running; i++) await tick();
  await tick();
}

function call(method, params) {
  const id = ++nextId;
  const before = stub.controlSocket.replies.length;
  stub.emitControlRequest({ connection: 1, generation: stub.controlSocket.generation, line: JSON.stringify({ id, method, params }) });
  const replies = stub.controlSocket.replies.slice(before).filter((r) => r.connection === 1);
  assert.equal(replies.length, 1, `one reply to ${method}`);
  return JSON.parse(replies[0].line);
}

function windowWithTabs(n) {
  const w = S().createWindow({ url: "https://t0.example/" });
  for (let i = 1; i < n; i++) S().newTab(w, { url: `https://t${i}.example/` });
  return { w, ids: [...S().windows[w].tabIds] };
}

const listed = (w) => call("windows").result.find((x) => x.id === w);
const sidebar = (w) => S().windows[w].tabIds;

test("createGroup groups tabs under a name, and windows lists the groups in sidebar order", async () => {
  await controlOn();
  const { w, ids } = windowWithTabs(5);
  const first = call("createGroup", { tabs: [ids[3], ids[4]], name: "  Later  " }).result.groupId;
  const second = call("createGroup", { window: w, tabs: [ids[1]], name: "Work" }).result.groupId;
  assert.deepEqual(S().groups[first].tabIds, [ids[3], ids[4]]);
  assert.equal(S().groups[first].name, "Later");
  assert.equal(S().groups[first].pinned, false);
  const groups = listed(w).groups;
  assert.deepEqual(
    groups.map((g) => [g.id, g.name, g.pinned, g.collapsed, g.parent, g.tabs]),
    [
      [second, "Work", false, false, null, [ids[1]]],
      [first, "Later", false, false, null, [ids[3], ids[4]]],
    ],
  );
  assert.equal(listed(w).tabs.find((t) => t.id === ids[1]).group, second);
  const nested = call("createGroup", { tabs: [ids[4]], name: "Inner" }).result.groupId;
  assert.equal(S().groups[nested].parentId, first);
  assert.deepEqual(
    listed(w).groups.map((g) => [g.id, g.parent]),
    [
      [second, null],
      [first, null],
      [nested, first],
    ],
  );
  const pinned = call("createGroup", { tabs: [ids[0]], name: "Pinned", pinned: true }).result.groupId;
  assert.equal(S().groups[pinned].pinned, true);
  assert.equal(listed(w).groups.find((g) => g.id === pinned).pinned, true);
});

test("createGroup validates its tabs", async () => {
  await controlOn();
  const { w, ids } = windowWithTabs(2);
  const other = windowWithTabs(1);
  const priv = S().createWindow({ kind: "private", url: "https://secret.example/" });
  const little = S().createWindow({ kind: "small", url: "https://c.example/" });
  assert.equal(call("createGroup", {}).error.code, "bad_request");
  assert.equal(call("createGroup", { tabs: [] }).error.code, "bad_request");
  assert.equal(call("createGroup", { tabs: [ids[0]], name: 3 }).error.code, "bad_request");
  assert.equal(call("createGroup", { tabs: [ids[0]], pinned: "yes" }).error.code, "bad_request");
  assert.equal(call("createGroup", { tabs: ["nope"] }).error.code, "no_window");
  assert.equal(call("createGroup", { tabs: [S().windows[priv].tabIds[0]] }).error.code, "no_window");
  assert.equal(call("createGroup", { tabs: [S().windows[little].tabIds[0]] }).error.code, "bad_request");
  assert.equal(call("createGroup", { tabs: [ids[0], other.ids[0]] }).error.code, "bad_request");
  assert.equal(call("createGroup", { window: other.w, tabs: [ids[0]] }).error.code, "no_window");
  S().pinTabs([ids[1]], true);
  assert.equal(call("createGroup", { tabs: [ids[1]] }).error.code, "bad_request");
  assert.deepEqual(Object.keys(S().groups), []);
  assert.ok(call("createGroup", { window: w, tabs: [ids[0]] }).result.groupId);
});

test("moveTab moves a tab into a group at an index, out to the top level, and reorders", async () => {
  await controlOn();
  const { w, ids } = windowWithTabs(5);
  const g = call("createGroup", { tabs: [ids[1], ids[2]], name: "G" }).result.groupId;
  assert.deepEqual(call("moveTab", { tab: ids[4], group: g, index: 0 }).result, { ok: true, group: g });
  assert.deepEqual(S().groups[g].tabIds, [ids[4], ids[1], ids[2]]);
  call("moveTab", { tab: ids[0], group: g });
  assert.deepEqual(S().groups[g].tabIds, [ids[4], ids[1], ids[2], ids[0]]);
  call("moveTab", { tab: ids[2], index: 0 });
  assert.deepEqual(S().groups[g].tabIds, [ids[2], ids[4], ids[1], ids[0]]);
  assert.deepEqual(call("moveTab", { tab: ids[4], group: null, index: 0 }).result, { ok: true, group: null });
  assert.deepEqual(sidebar(w), [ids[4], ids[2], ids[1], ids[0], ids[3]]);
  call("moveTab", { tab: ids[4], group: null, index: 1 });
  assert.deepEqual(sidebar(w), [ids[2], ids[1], ids[0], ids[4], ids[3]]);
  call("moveTab", { tab: ids[3], group: null, index: 99 });
  assert.deepEqual(sidebar(w), [ids[2], ids[1], ids[0], ids[4], ids[3]]);
  assert.deepEqual(listed(w).groups.map((x) => x.tabs), [[ids[2], ids[1], ids[0]]]);
});

test("moveTab counts a nested group as one item and unpins a pinned tab it moves", async () => {
  await controlOn();
  const { ids } = windowWithTabs(4);
  const outer = call("createGroup", { tabs: [ids[0], ids[1], ids[2]], name: "Outer" }).result.groupId;
  const inner = call("createGroup", { tabs: [ids[1], ids[2]], name: "Inner" }).result.groupId;
  assert.equal(S().groups[inner].parentId, outer);
  S().pinTabs([ids[3]], true);
  call("moveTab", { tab: ids[3], group: outer, index: 2 });
  assert.equal(S().tabs[ids[3]].pin, null);
  assert.deepEqual(S().groups[outer].tabIds, [ids[0], ids[1], ids[2], ids[3]]);
  call("moveTab", { tab: ids[0], index: 1 });
  assert.deepEqual(S().groups[outer].tabIds, [ids[1], ids[2], ids[0], ids[3]]);
  assert.deepEqual(S().groups[inner].tabIds, [ids[1], ids[2]]);
});

test("moveTab and renameGroup validate ids", async () => {
  await controlOn();
  const { ids } = windowWithTabs(2);
  const other = windowWithTabs(1);
  const g = call("createGroup", { tabs: [ids[0]] }).result.groupId;
  const elsewhere = call("createGroup", { tabs: [other.ids[0]] }).result.groupId;
  assert.equal(call("moveTab", {}).error.code, "no_window");
  assert.equal(call("moveTab", { tab: "nope" }).error.code, "no_window");
  assert.equal(call("moveTab", { tab: ids[1], group: "nope" }).error.code, "no_window");
  assert.equal(call("moveTab", { tab: ids[1], group: "__proto__" }).error.code, "no_window");
  assert.equal(call("moveTab", { tab: ids[1], group: elsewhere }).error.code, "bad_request");
  assert.equal(call("moveTab", { tab: ids[1], group: g, index: -1 }).error.code, "bad_request");
  assert.equal(call("moveTab", { tab: ids[1], group: g, index: 1.5 }).error.code, "bad_request");
  assert.equal(call("renameGroup", { group: "nope", name: "x" }).error.code, "no_window");
  assert.equal(call("renameGroup", { group: g }).error.code, "bad_request");
  assert.deepEqual(call("renameGroup", { group: g, name: " Reading " }).result, { ok: true });
  assert.equal(S().groups[g].name, "Reading");
  assert.equal(call("windows").result.flatMap((x) => x.groups).find((x) => x.id === g).title, "Reading");
});
