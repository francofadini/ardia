import { spawn, spawnSync } from "node:child_process";
import { createConnection, createServer, type Socket } from "node:net";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const home = join(homedir(), "Library/Application Support/ardia-icloud-bridge");
const socketPath = join(home, "daemon.sock");
const chromeProfile = join(home, "chrome-profile");
const chromeExtension = join(home, "chrome-extension");
const logPath = join(home, "bridge.log");
const chromeBinary = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appleHostManifest = "/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json";
const launchAgentLabel = "com.franco.ardia-icloud-bridge";
const idleExitMs = 120_000;
const keepAliveMs = 20_000;

function log(line: string) {
  try {
    writeFileSync(logPath, `${new Date().toISOString()} ${line}\n`, { flag: "a" });
  } catch {}
}

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function lineReader(onLine: (line: string) => void) {
  let pending = "";
  return (chunk: Buffer | string) => {
    pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line) onLine(line);
    }
  };
}

function connectToDaemon(deadline: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let kicked = false;
    const attempt = () => {
      const socket = createConnection(socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", () => {
        if (Date.now() > deadline) return reject(new Error("daemon unreachable"));
        if (!kicked) {
          kicked = true;
          spawnSync("launchctl", ["kickstart", `gui/${process.getuid!()}/${launchAgentLabel}`]);
        }
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

async function runHost() {
  const queued: unknown[] = [];
  let daemon: Socket | null = null;
  let input = Buffer.alloc(0);
  const forward = (message: unknown) => {
    if (daemon) daemon.write(JSON.stringify(message) + "\n");
    else queued.push(message);
  };
  process.stdin.on("data", (chunk: Buffer) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 4) {
      const length = input.readUInt32LE(0);
      if (input.length < 4 + length) break;
      forward(JSON.parse(input.subarray(4, 4 + length).toString()));
      input = input.subarray(4 + length);
    }
  });
  process.stdin.on("end", () => process.exit(0));
  try {
    daemon = await connectToDaemon(Date.now() + 20_000);
  } catch (error) {
    log(`host: ${error}`);
    process.exit(1);
  }
  daemon.on(
    "data",
    lineReader((line) => {
      const event = JSON.parse(line);
      if (event.t === "msg") process.stdout.write(frame(event.m));
      if (event.t === "closed") process.exit(0);
    }),
  );
  daemon.on("close", () => process.exit(0));
  for (const message of queued.splice(0)) daemon.write(JSON.stringify(message) + "\n");
}

async function debuggerUrl(chrome: ReturnType<typeof spawn>): Promise<string> {
  const portFile = join(chromeProfile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt++) {
    if (chrome.exitCode !== null) throw new Error("Chrome exited at launch");
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, "utf8").split("\n");
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    }
    await Bun.sleep(250);
  }
  throw new Error("Chrome's DevTools port never appeared");
}

async function loadExtension(url: string) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Extensions.loadUnpacked timed out")), 15_000);
    socket.onerror = () => reject(new Error("DevTools connection failed"));
    socket.onopen = () =>
      socket.send(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: chromeExtension } }));
    socket.onmessage = (event) => {
      const reply = JSON.parse(String(event.data));
      if (reply.id !== 1) return;
      clearTimeout(timer);
      reply.error ? reject(new Error(reply.error.message)) : resolve();
    };
  });
  socket.close();
}

async function runDaemon() {
  mkdirSync(home, { recursive: true });
  rmSync(socketPath, { force: true });
  const token = randomBytes(24).toString("hex");
  const sessions = new Map<number, Socket>();
  const waiting: string[] = [];
  let extension: Bun.ServerWebSocket<unknown> | null = null;
  let nextSession = 1;
  let idleTimer: Timer | null = null;
  let chrome: ReturnType<typeof spawn> | null = null;

  const shutdown = (code: number) => {
    chrome?.kill("SIGTERM");
    rmSync(socketPath, { force: true });
    process.exit(code);
  };
  const toExtension = (event: object) => {
    const text = JSON.stringify(event);
    if (extension) extension.send(text);
    else waiting.push(text);
  };
  const armIdleExit = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = sessions.size === 0 ? setTimeout(() => (log("daemon: idle, exiting"), shutdown(0)), idleExitMs) : null;
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, bunServer) {
      if (new URL(request.url).searchParams.get("token") !== token) return new Response("no", { status: 403 });
      return bunServer.upgrade(request) ? undefined : new Response("upgrade", { status: 400 });
    },
    websocket: {
      open(socket) {
        extension?.close();
        extension = socket;
        log("daemon: Chrome extension connected");
        for (const text of waiting.splice(0)) socket.send(text);
      },
      message(_socket, data) {
        const event = JSON.parse(String(data));
        const session = sessions.get(event.s);
        if (!session) return;
        if (event.t === "msg") session.write(JSON.stringify({ t: "msg", m: event.m }) + "\n");
        if (event.t === "closed") {
          if (event.error) log(`daemon: session ${event.s} closed by Apple's helper: ${event.error}`);
          session.end(JSON.stringify({ t: "closed" }) + "\n");
        }
      },
      close(socket) {
        if (extension !== socket) return;
        extension = null;
        log("daemon: Chrome extension disconnected");
        for (const session of sessions.values()) session.end(JSON.stringify({ t: "closed" }) + "\n");
      },
    },
  });

  if (!existsSync(join(chromeExtension, "manifest.json"))) {
    log("daemon: the Chrome extension isn't installed, run ardia-icloud-instalar");
    shutdown(1);
  }
  writeFileSync(
    join(chromeExtension, "config.js"),
    `self.BRIDGE_URL = ${JSON.stringify(`ws://127.0.0.1:${server.port}/?token=${token}`)};\n`,
  );

  rmSync(chromeProfile, { recursive: true, force: true });
  mkdirSync(join(chromeProfile, "NativeMessagingHosts"), { recursive: true });
  copyFileSync(appleHostManifest, join(chromeProfile, "NativeMessagingHosts/com.apple.passwordmanager.json"));
  chrome = spawn(
    chromeBinary,
    [
      `--user-data-dir=${chromeProfile}`,
      "--remote-debugging-port=0",
      "--enable-unsafe-extension-debugging",
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-default-apps",
      "--no-pings",
      "--mute-audio",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  chrome.on("exit", (code) => {
    log(`daemon: Chrome exited (${code})`);
    shutdown(1);
  });
  try {
    await loadExtension(await debuggerUrl(chrome));
  } catch (error) {
    log(`daemon: ${error}`);
    shutdown(1);
  }

  setInterval(() => toExtension({ t: "ping" }), keepAliveMs);

  createServer((socket) => {
    const id = nextSession++;
    sessions.set(id, socket);
    armIdleExit();
    toExtension({ s: id, t: "open" });
    socket.on(
      "data",
      lineReader((line) => toExtension({ s: id, t: "msg", m: JSON.parse(line) })),
    );
    socket.on("close", () => {
      if (!sessions.delete(id)) return;
      toExtension({ s: id, t: "close" });
      armIdleExit();
    });
    socket.on("error", () => {});
  }).listen(socketPath, () => log(`daemon: listening, Chrome pid ${chrome?.pid}`));
  armIdleExit();

  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
}

const mode = process.argv[2];
if (mode === "daemon") await runDaemon();
else await runHost();
