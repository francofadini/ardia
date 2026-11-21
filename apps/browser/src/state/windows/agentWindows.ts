import { useBrowser, type BrowserState } from "../browser/store";
import { inPinnedContainer, pinKeyOf } from "../browser/model";
import { tabsLostWithWindow } from "../tabs/sharedWindowClose";
import { isEmptyCardTab } from "../omnibox/newTabBarPolicy";
import { isOpenRegularWindow } from "./small";
import type { Tab } from "../browser/types";

export function agentTabsIn(s: BrowserState, windowId: string): string[] {
  const w = s.windows[windowId];
  if (w?.kind !== "main" || !w.agent) return [];
  const families = new Set(w.agentTabs ?? []);
  return w.tabIds.filter((id) => {
    const t = s.tabs[id];
    return !!t && t.windowId === windowId && !t.pin && !inPinnedContainer(s, id) && families.has(pinKeyOf(t));
  });
}

export type AgentWindowClose = { closed: true } | { closed: false; kept: string[] };

export function closeAgentWindow(windowId: string): AgentWindowClose {
  const store = () => useBrowser.getState();
  const own = agentTabsIn(store(), windowId);
  if (own.length) store().closeTabs(own, { lastClosesWindow: true });
  const s = store();
  const w = s.windows[windowId];
  if (!w) return { closed: true };
  const kept: Tab[] = tabsLostWithWindow(s, windowId, isOpenRegularWindow).filter((t: Tab) => !!t.url && !isEmptyCardTab(s, t));
  if (!kept.length) s.closeWindow(windowId);
  const left = store().windows[windowId];
  if (!left) return { closed: true };
  if (left.kind === "main") {
    const { agent: _a, agentTabs: _t, ...user } = left;
    useBrowser.setState((now) => ({ windows: { ...now.windows, [windowId]: user } }));
  }
  return { closed: false, kept: kept.map((t) => t.id) };
}
