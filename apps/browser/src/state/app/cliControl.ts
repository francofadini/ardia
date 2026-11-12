import {
  cliControlStatus,
  installCli,
  installedCliVersion,
  onCliControlChanged,
  onCliInstallLine,
  setCliActiveTab,
  setAgentWindows,
  setCliControl,
  type CliControlStatus,
  type CliInstallResult,
} from "../../platform/cli";
import { readDocument, writeDocument } from "../../platform/documents";
import { systemInfo } from "../../platform/app";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../browser/store";
import { hasPage } from "../tabs/pageSession";
import { shownPageId } from "../peek/peek";
import { isTabReady, pageOf, usePages } from "../tabs/pageState";
import { isInternalTab } from "../pages/urls";
import { afterFirstWindow } from "../../lib/afterFirstWindow";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { errorText } from "../../lib/errors";
import { focusedWindowOf } from "../windows/ui";
import { familyKeyOf } from "../browser/model";
import { controlledTabs, isAnnouncing, onControlledChanged, type ControlledTabs } from "./cliControlled";

const DOC = "ardia-cli.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };
const SCHEMA_FIELD = "schemaVersion";
const UPGRADE_DELAY_MS = 8000;
const INDICATOR_HOLD_MS = 3000;
const UNANNOUNCED_GRACE_MS = 1500;

type Saved = { binPath?: string | null; version?: string | null; error?: string | null; at?: number };

export type CliInstallReason = "onboarding" | "settings" | "upgrade";

type CliState = {
  server: CliControlStatus | null;
  installing: CliInstallReason | null;
  step: string | null;
  installedVersion: string | null;
  binPath: string | null;
  error: string | null;
};

function readSaved(): Saved {
  try {
    return (parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS, SCHEMA_FIELD) as Saved | null) ?? {};
  } catch {
    return {};
  }
}

function save(patch: Saved) {
  try {
    writeDocument(DOC, versionedJson({ ...readSaved(), ...patch, at: Date.now() }, DOC_VERSION, SCHEMA_FIELD));
  } catch (error) {
    console.warn("[cli] couldn't save the install status", error);
  }
}

const saved = readSaved();

export const useCli = create<CliState>()(() => ({
  server: null,
  installing: null,
  step: null,
  installedVersion: installedCliVersion(),
  binPath: saved.binPath ?? null,
  error: saved.error ?? null,
}));

export type CliIndicator = { shown: boolean; tabs: ControlledTabs; families: ControlledTabs };

export const useCliIndicator = create<CliIndicator>()(() => ({ shown: false, tabs: {}, families: {} }));

function familiesOf(tabs: ControlledTabs): ControlledTabs {
  const all = useBrowser.getState().tabs;
  const out: Record<string, string> = {};
  for (const [tabId, controller] of Object.entries(tabs)) {
    const tab = all[tabId];
    if (tab) out[familyKeyOf(tab)] = controller;
  }
  return out;
}

export function useTabController(tabId: string): string | null {
  const family = useBrowser((s) => {
    const tab = s.tabs[tabId];
    return tab ? familyKeyOf(tab) : null;
  });
  return useCliIndicator((s) => s.tabs[tabId] ?? (family ? s.families[family] : undefined) ?? null);
}

let indicatorHide: ReturnType<typeof setTimeout> | null = null;
let unannouncedCheck: ReturnType<typeof setTimeout> | null = null;
let unannouncedSince: number | null = null;
const tabHides = new Map<string, ReturnType<typeof setTimeout>>();
let socketRuns = 0;
let socketServing = false;

const controlOn = ({ server }: CliState) => server?.state === "on" || socketServing;

function updateIndicator(cli: CliState) {
  const server = cli.server;
  const on = controlOn(cli);
  const unannounced = server?.state === "on" && server.connections > 0 && !isAnnouncing();
  if (!unannounced) unannouncedSince = null;
  else if (unannouncedSince === null) unannouncedSince = Date.now();
  const graceLeft = unannouncedSince === null ? 0 : unannouncedSince + UNANNOUNCED_GRACE_MS - Date.now();
  if (unannouncedCheck) clearTimeout(unannouncedCheck);
  unannouncedCheck = graceLeft > 0 ? setTimeout(() => updateIndicator(useCli.getState()), graceLeft) : null;
  const connected = on && ((unannounced && graceLeft <= 0) || socketRuns > 0);
  if (connected || !on) {
    if (indicatorHide) clearTimeout(indicatorHide);
    indicatorHide = null;
    if (useCliIndicator.getState().shown !== connected) useCliIndicator.setState({ shown: connected });
  } else if (useCliIndicator.getState().shown && !indicatorHide) {
    indicatorHide = setTimeout(() => {
      indicatorHide = null;
      useCliIndicator.setState({ shown: false });
    }, INDICATOR_HOLD_MS);
  }
  updateTabs(on);
}

function updateTabs(on: boolean) {
  const live = on ? controlledTabs() : {};
  const shown = useCliIndicator.getState().tabs;
  const next: Record<string, string> = { ...live };
  for (const tabId of Object.keys(live)) {
    const hide = tabHides.get(tabId);
    if (hide) clearTimeout(hide);
    tabHides.delete(tabId);
  }
  for (const [tabId, controller] of Object.entries(shown)) {
    if (live[tabId]) continue;
    if (!on) {
      const hide = tabHides.get(tabId);
      if (hide) clearTimeout(hide);
      tabHides.delete(tabId);
      continue;
    }
    next[tabId] = controller;
    if (tabHides.has(tabId)) continue;
    tabHides.set(
      tabId,
      setTimeout(() => {
        tabHides.delete(tabId);
        const { [tabId]: _gone, ...rest } = useCliIndicator.getState().tabs;
        useCliIndicator.setState({ tabs: rest, families: familiesOf(rest) });
      }, INDICATOR_HOLD_MS),
    );
  }
  const same = Object.keys(next).length === Object.keys(shown).length && Object.entries(next).every(([id, c]) => shown[id] === c);
  if (!same) useCliIndicator.setState({ tabs: next, families: familiesOf(next) });
}

useCli.subscribe(updateIndicator);
onControlledChanged(() => updateIndicator(useCli.getState()));

let sentAgentWindows = "";

export function agentWindowsOf(tabs: ControlledTabs, all: BrowserState["tabs"]): string[] {
  return [...new Set(Object.keys(tabs).map((id) => all[id]?.windowId).filter((id): id is string => !!id))].sort();
}

function pushAgentWindows() {
  const windows = agentWindowsOf(useCliIndicator.getState().tabs, useBrowser.getState().tabs);
  const key = windows.join("\u0001");
  if (key === sentAgentWindows) return;
  sentAgentWindows = key;
  void setAgentWindows(windows).catch(() => {});
}

useCliIndicator.subscribe(pushAgentWindows);

export function noteSocketRun(delta: 1 | -1) {
  socketRuns = Math.max(0, socketRuns + delta);
  updateIndicator(useCli.getState());
}

export function noteSocketServing(serving: boolean) {
  socketServing = serving;
  updateIndicator(useCli.getState());
}

let running: Promise<CliInstallResult> | null = null;

export function installCliInBackground(reason: CliInstallReason): Promise<CliInstallResult> {
  if (running) return running;
  useCli.setState({ installing: reason, step: null });
  const lines = onCliInstallLine((line) => {
    const step = /^step (\S+)/.exec(line)?.[1];
    if (step) useCli.setState({ step });
  });
  running = installCli()
    .catch((e: unknown): CliInstallResult => ({ ok: false, appVersion: "", error: errorText(e), lines: [] }))
    .then((result) => {
      lines.remove();
      running = null;
      const installedVersion = installedCliVersion();
      if (result.ok) {
        save({ binPath: result.binPath ?? null, version: result.version ?? installedVersion, error: null });
        useCli.setState({ installing: null, step: null, installedVersion, binPath: result.binPath ?? null, error: null });
      } else {
        const error = result.error ?? "The installer stopped.";
        save({ error });
        useCli.setState({ installing: null, step: null, installedVersion, error });
      }
      return result;
    });
  return running;
}

export function describeCliInstall(state: Pick<CliState, "installing" | "step" | "installedVersion" | "binPath" | "error">): string {
  if (state.installing) return state.step ? `Installing (${state.step})…` : "Installing…";
  if (state.error) return state.error;
  if (state.installedVersion) return state.binPath ? `Installed at ${state.binPath}` : `Version ${state.installedVersion} is installed.`;
  return "Not installed.";
}

let sentActive: string | null | undefined;

function shownReadyTab(s: BrowserState): string | null {
  const windowId = focusedWindowOf(s);
  const id = windowId ? shownPageId(s, windowId) : undefined;
  const tab = id ? s.tabs[id] : undefined;
  if (!id || !tab?.url || pageOf(id).newTabShown || !hasPage(tab) || isInternalTab(tab)) return null;
  return isTabReady(id) ? id : null;
}

function pushActiveTab() {
  const state = useCli.getState().server?.state;
  if (state !== "on" && state !== "starting") {
    sentActive = undefined;
    return;
  }
  const active = shownReadyTab(useBrowser.getState());
  if (active === sentActive) return;
  sentActive = active;
  void setCliActiveTab(active).catch(() => {});
}

export function noteTabReady(tabId: string) {
  if (sentActive === tabId) sentActive = undefined;
  pushActiveTab();
}

export const stopCliControl = () => useBrowser.getState().updateSettings({ cliControl: false });

function upgradeIfBehind() {
  const installed = installedCliVersion();
  useCli.setState({ installedVersion: installed });
  const app = systemInfo().appVersion;
  if (!installed || !app || installed === app) return;
  void installCliInBackground("upgrade");
}

let started = false;

export function startCliControl() {
  if (started) return;
  started = true;
  let latest = 0;
  let inFlight = 0;
  let newest = 0;
  const apply = (server: CliControlStatus, mayReconcile: boolean) => {
    const generation = server.state === "external" ? newest : server.generation;
    if (generation < newest) return;
    newest = generation;
    useCli.setState({ server });
    const stoppedItself = server.state === "off" && !!server.reason;
    if (mayReconcile && stoppedItself && useBrowser.getState().settings.cliControl) useBrowser.getState().updateSettings({ cliControl: false });
  };
  onCliControlChanged((server) => apply(server, inFlight === 0));
  let applied: boolean | null = null;
  const sync = () => {
    const on = useBrowser.getState().settings.cliControl;
    if (on === applied) return;
    const first = applied === null;
    applied = on;
    const request = ++latest;
    inFlight++;
    const settle = (server: CliControlStatus) => {
      inFlight--;
      if (request === latest) apply(server, true);
    };
    const call = first && !on ? cliControlStatus() : setCliControl(on);
    void call.then(settle, (e: unknown) =>
      settle({ state: "off", connections: 0, generation: newest, file: "", reason: errorText(e) }),
    );
  };
  sync();
  useBrowser.subscribe(() => {
    sync();
    pushActiveTab();
    pushAgentWindows();
  });
  useCli.subscribe(pushActiveTab);
  usePages.subscribe(pushActiveTab);
  afterFirstWindow(() => setTimeout(upgradeIfBehind, UPGRADE_DELAY_MS));
}

if (__DEV__) (globalThis as { acCli?: unknown }).acCli = { store: useCli, indicator: useCliIndicator, install: installCliInBackground, upgradeIfBehind };
