importScripts("config.js");

const ports = new Map();
let socket = null;

function send(event) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function open(session) {
  const port = chrome.runtime.connectNative("com.apple.passwordmanager");
  ports.set(session, port);
  port.onMessage.addListener((message) => send({ s: session, t: "msg", m: message }));
  port.onDisconnect.addListener(() => {
    if (ports.get(session) !== port) return;
    ports.delete(session);
    send({ s: session, t: "closed", error: chrome.runtime.lastError?.message ?? null });
  });
}

function close(session) {
  const port = ports.get(session);
  ports.delete(session);
  port?.disconnect();
}

function closeAll() {
  for (const session of [...ports.keys()]) close(session);
}

function connect() {
  socket = new WebSocket(self.BRIDGE_URL);
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.t === "open") open(event.s);
    else if (event.t === "msg") ports.get(event.s)?.postMessage(event.m);
    else if (event.t === "close") close(event.s);
  };
  socket.onclose = () => {
    closeAll();
    setTimeout(connect, 1000);
  };
  socket.onerror = () => socket.close();
}

connect();
