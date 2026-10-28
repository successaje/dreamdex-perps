/** Does the documented WebSocket endpoint connect and deliver? */
import WebSocket from "ws";
import { WS_URL } from "../src/config.js";

console.log(`connecting to ${WS_URL}`);
const started = Date.now();
const ws = new WebSocket(WS_URL);
let opened = false;
let frames = 0;

const lap = () => `${String(Date.now() - started).padStart(6)}ms`;

ws.on("open", () => {
  opened = true;
  console.log(`${lap()}  open`);
  // Standard eth subscription over a node websocket.
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
  console.log(`${lap()}  sent eth_subscribe newHeads`);
});

ws.on("message", (d: Buffer) => {
  frames++;
  const text = d.toString();
  if (frames <= 3) console.log(`${lap()}  frame ${frames}: ${text.slice(0, 150)}`);
});

ws.on("error", (e: Error) => console.log(`${lap()}  ERROR ${e.message}`));
ws.on("close", (c: number, r: Buffer) => console.log(`${lap()}  closed code=${c} reason=${r.toString() || "(none)"}`));

setTimeout(() => {
  console.log(`\nopened=${opened}  frames=${frames}`);
  console.log(
    !opened ? "never connected"
      : frames === 0 ? "connected but delivered nothing in 15s"
      : `delivering (${frames} frames)`,
  );
  ws.close();
  process.exit(0);
}, 15_000);
