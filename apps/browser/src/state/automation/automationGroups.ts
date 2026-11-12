import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import type { TabPlacement } from "../pins/placing";
import { isPinnedRow } from "../browser/model";
import { pinnedGroupMembers } from "../browser/structure";
import { ancestorIds, innermostGroupOf } from "../groups/groups";
import { eligibleGroup, eligibleKind, isEligibleTab } from "./automationWindows";
import { failure, type MethodError } from "./automationMethods";

type GroupState = Pick<BrowserState, "windows" | "tabs" | "peeks" | "groups">;
type Planned<T> = T | { error: MethodError };

export type CreateGroupPlan = { tabIds: string[]; name: string; pinned: boolean };
export type MoveTabPlan = { tabId: string; placement: TabPlacement };
export type RenameGroupPlan = { groupId: string; name: string };

const noTab = (tab: unknown) => failure("no_window", `There's no tab ${String(tab)} the ardia command can use.`);
const noGroup = (group: unknown) => failure("no_window", `There's no group ${String(group)} the ardia command can use.`);
const isGiven = (value: unknown) => value !== undefined && value !== null;

function groupName(name: unknown): Planned<string> {
  if (!isGiven(name)) return "";
  if (typeof name !== "string") return failure("bad_request", "name must be a string.");
  return name.trim();
}

function sidebarTab(s: GroupState, tab: unknown): Planned<string> {
  if (typeof tab !== "string" || !isEligibleTab(s, tab)) return noTab(tab);
  if (eligibleKind(s, s.tabs[tab]!.windowId) !== "normal") return failure("bad_request", `Tab ${tab} is in Little Ardia, which has no groups.`);
  return tab;
}

export function planCreateGroup(s: GroupState, params: Record<string, unknown>): Planned<CreateGroupPlan> {
  const { window, tabs, pinned } = params;
  const name = groupName(params.name);
  if (typeof name !== "string") return name;
  if (isGiven(pinned) && typeof pinned !== "boolean") return failure("bad_request", "pinned must be true or false.");
  if (!Array.isArray(tabs) || !tabs.length) return failure("bad_request", "createGroup needs tabs: a list of tab ids from windows.");
  const tabIds: string[] = [];
  for (const tab of new Set(tabs)) {
    const id = sidebarTab(s, tab);
    if (typeof id !== "string") return id;
    tabIds.push(id);
  }
  const first = s.tabs[tabIds[0]!]!;
  if (isGiven(window) && window !== first.windowId) return failure("no_window", `Tab ${first.id} isn't in window ${String(window)}.`);
  for (const id of tabIds) {
    const t = s.tabs[id]!;
    if (t.windowId !== first.windowId || t.profileId !== first.profileId) return failure("bad_request", "A group's tabs share one window and one profile.");
    if (t.pin && !isPinnedRow(t)) return failure("bad_request", `Tab ${id} is a pinned tile, and tiles don't go in groups.`);
  }
  return { tabIds, name, pinned: pinned === true };
}

function itemHeads(s: GroupState, tab: string, parent: TabGroup | null): string[] {
  const t = s.tabs[tab]!;
  const members = parent ? new Set(parent.tabIds) : null;
  const pinnedMembers = pinnedGroupMembers(s.groups);
  const seen = new Set<string>();
  const heads: string[] = [];
  for (const id of s.windows[t.windowId]?.tabIds ?? []) {
    const other = s.tabs[id];
    if (id === tab || !other || other.profileId !== t.profileId) continue;
    if (members ? !members.has(id) : other.pin || pinnedMembers.has(id)) continue;
    const inner = innermostGroupOf(s.groups, id);
    const chain = inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [];
    const child = chain.find((g) => g !== parent?.id && (s.groups[g]!.parentId ?? null) === (parent?.id ?? null));
    const key = child ?? id;
    if (seen.has(key)) continue;
    seen.add(key);
    heads.push(id);
  }
  return heads;
}

export function planMoveTab(s: GroupState, params: Record<string, unknown>): Planned<MoveTabPlan> {
  const { group, index } = params;
  const tabId = sidebarTab(s, params.tab);
  if (typeof tabId !== "string") return tabId;
  if (isGiven(index) && !(Number.isSafeInteger(index) && (index as number) >= 0)) return failure("bad_request", "index must be a whole number, 0 or more.");
  const t = s.tabs[tabId]!;
  let target: TabGroup | null;
  if (group === undefined) target = innermostGroupOf(s.groups, tabId) ?? null;
  else if (group === null) target = null;
  else {
    target = typeof group === "string" ? eligibleGroup(s, group) : null;
    if (!target) return noGroup(group);
    if (target.windowId !== t.windowId) return failure("bad_request", `Group ${target.id} is in another window than tab ${tabId}.`);
    if (target.profileId !== t.profileId) return failure("bad_request", `Group ${target.id} belongs to another profile than tab ${tabId}.`);
  }
  const heads = itemHeads(s, tabId, target);
  const beforeId = isGiven(index) ? (heads[index as number] ?? null) : null;
  return { tabId, placement: { pinned: false, groupId: target?.id ?? null, beforeId } };
}

export function planRenameGroup(s: GroupState, params: Record<string, unknown>): Planned<RenameGroupPlan> {
  const { group } = params;
  const target = typeof group === "string" ? eligibleGroup(s, group) : null;
  if (!target) return noGroup(group);
  if (typeof params.name !== "string") return failure("bad_request", "renameGroup needs a name: a string, empty for the automatic one.");
  return { groupId: target.id, name: params.name.trim() };
}
