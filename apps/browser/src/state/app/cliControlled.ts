import { tabTargetId } from "../../platform/cli";
import { useBrowser } from "../browser/store";

export const DEFAULT_CONTROLLER = "ardia";
const MAX_CONTROLLER = 40;
const MAX_TARGETS = 64;

export type ControlledTarget = { targetId: string; url: string | null };
export type Announcement = { controller: string; targets: ControlledTarget[] };
export type ControlledTabs = Readonly<Record<string, string>>;

const announcements = new Map<number, Announcement>();
const targetOfTab = new Map<string, string>();
let resolved: Record<string, string> = {};
let listener: () => void = () => {};
let running: Promise<void> | null = null;
let again = false;

export function onControlledChanged(next: () => void) {
  listener = next;
}

export const isAnnouncing = () => announcements.size > 0;

export function controlledTabs(): ControlledTabs {
  const tabs = useBrowser.getState().tabs;
  const out: Record<string, string> = {};
  for (const [tabId, controller] of Object.entries(resolved)) if (tabs[tabId]) out[tabId] = controller;
  return out;
}

export function parseAnnouncement(params: Record<string, unknown>): Announcement | { error: string } {
  const { controller, targets } = params;
  if (controller !== undefined && controller !== null && typeof controller !== "string") return { error: "controller must be a string." };
  if (!Array.isArray(targets)) return { error: "controlling needs targets: a list of { targetId, url }." };
  if (targets.length > MAX_TARGETS) return { error: `controlling takes at most ${MAX_TARGETS} targets.` };
  const parsed: ControlledTarget[] = [];
  for (const target of targets) {
    const fields = typeof target === "object" && target !== null ? (target as Record<string, unknown>) : null;
    if (!fields || typeof fields.targetId !== "string" || !fields.targetId) return { error: "Each target needs a targetId." };
    parsed.push({ targetId: fields.targetId, url: typeof fields.url === "string" ? fields.url : null });
  }
  const name = (controller ?? "").replace(/[\p{Cc}\s]+/gu, " ").trim().slice(0, MAX_CONTROLLER);
  return { controller: name || DEFAULT_CONTROLLER, targets: parsed };
}

export function noteControlling(connection: number, announcement: Announcement) {
  announcements.set(connection, announcement);
  refresh();
}

export function dropControlling(connection?: number) {
  const changed = connection === undefined ? announcements.size > 0 : announcements.delete(connection);
  if (connection === undefined) announcements.clear();
  if (changed) refresh();
}

const withoutHash = (url: string) => url.split("#", 1)[0];

async function targetsOf(tabIds: string[]) {
  const ids = await Promise.all(tabIds.map((id) => tabTargetId(id).catch(() => null)));
  tabIds.forEach((id, i) => {
    const target = ids[i];
    if (target) targetOfTab.set(id, target);
  });
}

function cachedTab(targetId: string): string | null {
  const tabs = useBrowser.getState().tabs;
  for (const [tabId, target] of targetOfTab) {
    if (!tabs[tabId]) targetOfTab.delete(tabId);
    else if (target === targetId) return tabId;
  }
  return null;
}

async function resolveTarget({ targetId, url }: ControlledTarget): Promise<string | null> {
  const cached = cachedTab(targetId);
  if (cached) return cached;
  const live = Object.values(useBrowser.getState().tabs).filter((t) => !!t.url);
  const same = url ? live.filter((t) => withoutHash(t.url) === withoutHash(url)).map((t) => t.id) : [];
  if (same.length) {
    await targetsOf(same);
    const hit = cachedTab(targetId);
    if (hit) return hit;
  }
  await targetsOf(live.filter((t) => !targetOfTab.has(t.id) && !same.includes(t.id)).map((t) => t.id));
  return cachedTab(targetId);
}

async function resolveAll() {
  const next: Record<string, string> = {};
  for (const { controller, targets } of announcements.values()) {
    for (const target of targets) {
      const tabId = await resolveTarget(target);
      if (tabId && (!next[tabId] || next[tabId] === DEFAULT_CONTROLLER)) next[tabId] = controller;
    }
  }
  resolved = next;
  listener();
}

export function refresh(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = resolveAll()
    .catch((error: unknown) => console.warn("[cli] couldn't match the controlled tabs", error))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void refresh();
      }
    });
  return running;
}

export function resetControlledForTests() {
  announcements.clear();
  targetOfTab.clear();
  resolved = {};
  running = null;
  again = false;
}
