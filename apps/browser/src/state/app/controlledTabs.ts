import { create } from "zustand";
import { controlTabTargets } from "../../platform/control";
import { useBrowser } from "../browser/store";
import { familyKeyOf } from "../browser/model";
import { hasPage } from "../tabs/pageSession";
import { noteAnnouncing } from "./programControl";

export const DEFAULT_CONTROLLER = "ardia";
const TAB_HOLD_MS = 3000;

type Controllers = Readonly<Record<string, string>>;
type Announcement = { controller: string; targets: readonly string[] };

export const useControlledTabs = create<{ tabs: Controllers; families: Controllers }>()(() => ({ tabs: {}, families: {} }));

const announcements = new Map<number, Announcement>();
const targetOfTab = new Map<string, string>();
const tabHides = new Map<string, ReturnType<typeof setTimeout>>();
let live: Controllers = {};
let resolving: Promise<void> = Promise.resolve();

export const isAnnouncing = () => announcements.size > 0;

function familiesOf(tabs: Controllers): Controllers {
  const all = useBrowser.getState().tabs;
  const out: Record<string, string> = {};
  for (const [tabId, controller] of Object.entries(tabs)) {
    const tab = all[tabId];
    if (tab) out[familyKeyOf(tab)] = controller;
  }
  return out;
}

function publish(tabs: Controllers) {
  const shown = useControlledTabs.getState().tabs;
  const same = Object.keys(tabs).length === Object.keys(shown).length && Object.entries(tabs).every(([id, c]) => shown[id] === c);
  if (!same) useControlledTabs.setState({ tabs, families: familiesOf(tabs) });
}

function clearHolds() {
  for (const hide of tabHides.values()) clearTimeout(hide);
  tabHides.clear();
}

function showLive(next: Controllers) {
  live = next;
  const shown = useControlledTabs.getState().tabs;
  const out: Record<string, string> = { ...next };
  for (const tabId of Object.keys(next)) {
    const hide = tabHides.get(tabId);
    if (hide) clearTimeout(hide);
    tabHides.delete(tabId);
  }
  for (const [tabId, controller] of Object.entries(shown)) {
    if (next[tabId] || !useBrowser.getState().tabs[tabId]) continue;
    out[tabId] = controller;
    if (tabHides.has(tabId)) continue;
    tabHides.set(
      tabId,
      setTimeout(() => {
        tabHides.delete(tabId);
        if (live[tabId]) return;
        const { [tabId]: _gone, ...rest } = useControlledTabs.getState().tabs;
        publish(rest);
      }, TAB_HOLD_MS),
    );
  }
  publish(out);
}

async function refreshTargets(tabIds: string[]) {
  if (!tabIds.length) return;
  const targets = await controlTabTargets(tabIds).catch(() => null);
  if (!targets) return;
  for (const id of tabIds) {
    const targetId = targets[id]?.targetId;
    if (targetId) targetOfTab.set(id, targetId);
    else targetOfTab.delete(id);
  }
}

function tabsByTarget(): Map<string, string> {
  const tabs = useBrowser.getState().tabs;
  const out = new Map<string, string>();
  for (const [tabId, targetId] of targetOfTab) {
    if (!tabs[tabId]) targetOfTab.delete(tabId);
    else out.set(targetId, tabId);
  }
  return out;
}

async function resolveAll(): Promise<void> {
  const wanted = new Set([...announcements.values()].flatMap((a) => a.targets));
  if (wanted.size && [...wanted].some((t) => !tabsByTarget().has(t))) {
    await refreshTargets(Object.values(useBrowser.getState().tabs).filter(hasPage).map((t) => t.id));
  }
  const byTarget = tabsByTarget();
  const next: Record<string, string> = {};
  for (const { controller, targets } of announcements.values()) {
    for (const target of targets) {
      const tabId = byTarget.get(target);
      if (tabId && (!next[tabId] || next[tabId] === DEFAULT_CONTROLLER)) next[tabId] = controller;
    }
  }
  showLive(next);
}

function refresh(): Promise<void> {
  noteAnnouncing(isAnnouncing());
  resolving = resolving.then(resolveAll, resolveAll);
  return resolving;
}

export async function noteControlling(connection: number, controller: string | null, targets: readonly string[]): Promise<string[]> {
  announcements.set(connection, { controller: controller || DEFAULT_CONTROLLER, targets: [...new Set(targets)] });
  await refresh();
  const byTarget = tabsByTarget();
  return [...new Set(targets)].map((t) => byTarget.get(t)).filter((id): id is string => !!id);
}

export function dropControlling(connection?: number) {
  if (connection !== undefined) {
    if (announcements.delete(connection)) void refresh();
    return;
  }
  announcements.clear();
  clearHolds();
  live = {};
  noteAnnouncing(false);
  publish({});
}

export function useTabController(tabId: string): string | null {
  const family = useBrowser((s) => {
    const tab = s.tabs[tabId];
    return tab ? familyKeyOf(tab) : null;
  });
  return useControlledTabs((s) => s.tabs[tabId] ?? (family ? s.families[family] : undefined) ?? null);
}

useBrowser.subscribeTo(["tabs"], (s, prev) => {
  if (s.tabs === prev.tabs) return;
  const shown = useControlledTabs.getState().tabs;
  if (Object.keys(shown).some((id) => !s.tabs[id])) publish(Object.fromEntries(Object.entries(shown).filter(([id]) => s.tabs[id])));
});

if (__DEV__) (globalThis as { acControlled?: unknown }).acControlled = useControlledTabs;
