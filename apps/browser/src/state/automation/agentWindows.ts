import { tabTargetId } from "../../platform/cli";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, pinKeyOf } from "../browser/model";
import { resolveTarget } from "../app/cliControlled";
import { eligibleKind } from "./automationWindows";
import { failure, type MethodError } from "./automationMethods";

type Planned<T> = T | { error: MethodError };
type Answer<T> = Promise<{ result: T } | { error: MethodError }>;

const TARGET_WAIT_MS = 10_000;
const TARGET_POLL_MS = 100;

const noWindow = (what: string) => failure("no_window", `There's no window ${what} the ardia command can close.`);

export type CloseWindowPlan = ({ windowId: string } | { targetId: string; url: string | null }) & { withTabs: boolean | null };
export type OpenWindowPlan = { profileId: string; url: string };

export function planCloseWindow(s: Pick<BrowserState, "windows">, params: Record<string, unknown>): Planned<CloseWindowPlan> {
  const { window, target, url, tabs } = params;
  if (tabs !== undefined && tabs !== null && typeof tabs !== "boolean") return failure("bad_request", "tabs must be true or false.");
  const withTabs = typeof tabs === "boolean" ? tabs : null;
  if (typeof window === "string" && window) return eligibleKind(s, window) ? { windowId: window, withTabs } : noWindow(window);
  if (typeof target === "string" && target) return { targetId: target, url: typeof url === "string" ? url : null, withTabs };
  return failure("bad_request", "closeWindow needs a window id from windows, or the target (a CDP targetId) of one of its tabs.");
}

export function closeWindowNow(windowId: string, withTabs: boolean | null) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return;
  if (withTabs ?? (w.kind !== "small" && !!w.chromeWindow)) {
    const own = w.tabIds.filter((id) => {
      const tab = s.tabs[id];
      return !!tab && tab.windowId === windowId && !tab.pin && pinKeyOf(tab) === tab.id;
    });
    if (own.length) s.closeTabs(own, { lastClosesWindow: true });
  }
  if (useBrowser.getState().windows[windowId]) useBrowser.getState().closeWindow(windowId);
}

export async function closeWindowOf(plan: CloseWindowPlan): Answer<{ ok: true; window: string }> {
  let windowId: string;
  if ("windowId" in plan) windowId = plan.windowId;
  else {
    const tabId = await resolveTarget(plan);
    const found = tabId ? useBrowser.getState().tabs[tabId]?.windowId : undefined;
    if (!found || !eligibleKind(useBrowser.getState(), found)) return noWindow(`with target ${plan.targetId}`);
    windowId = found;
  }
  closeWindowNow(windowId, plan.withTabs);
  return { result: { ok: true, window: windowId } };
}

export function planOpenWindow(s: Pick<BrowserState, "profiles" | "profileOrder">, params: Record<string, unknown>): Planned<OpenWindowPlan> {
  const { profile, url } = params;
  if (typeof profile !== "string" || !profile.trim()) return failure("bad_request", "openWindow needs a profile: its name or id.");
  const wanted = profile.trim().toLowerCase();
  const profileId = s.profileOrder.find((id) => id.toLowerCase() === wanted) ?? s.profileOrder.find((id) => s.profiles[id]?.name.trim().toLowerCase() === wanted);
  if (!profileId) return failure("no_window", `There's no profile ${profile}. The profiles are: ${s.profileOrder.map((id) => s.profiles[id]?.name ?? id).join(", ")}.`);
  const page = url === undefined || url === null || url === "" ? "about:blank" : url;
  if (typeof page !== "string" || (page !== "about:blank" && !/^https?:\/\//i.test(page))) return failure("bad_request", "openWindow's url must be an http(s) URL or about:blank.");
  return { profileId, url: page };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function openWindowFor({ profileId, url }: OpenWindowPlan): Answer<{ window: string; tab: string; target: string }> {
  const windowId = useBrowser.getState().createWindow({ profileId, url, background: true });
  const tabId = activeTabId(useBrowser.getState(), windowId);
  if (!tabId) return failure("failed", "The new window has no tab.");
  for (const end = Date.now() + TARGET_WAIT_MS; Date.now() < end; await pause(TARGET_POLL_MS)) {
    if (!useBrowser.getState().tabs[tabId]) return failure("failed", "The new window's tab closed before it loaded.");
    const target = await tabTargetId(tabId).catch(() => null);
    if (target) return { result: { window: windowId, tab: tabId, target } };
  }
  return failure("failed", `The new window's tab didn't load in ${TARGET_WAIT_MS / 1000} s.`);
}
