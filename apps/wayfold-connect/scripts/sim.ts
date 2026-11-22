/**
 * Gateway + client in one process, joined by a simulated optical link
 * (frame rate, QR grid, loss, latency). The real egress and the real local
 * proxies are used, so you can browse through it without any webcam:
 *
 *   node scripts/sim.ts --loss 0.15 --fps 24 --grid 2 --mtu 1400
 *   curl -x socks5h://127.0.0.1:1080 https://example.com
 */
import { parseArgs } from "node:util";
import { Egress } from "../src/egress.ts";
import { ClientPeer, GatewayPeer, type Peer } from "../src/peer.ts";
import { DEFAULT_POLICY } from "../src/policy.ts";
import { ClientProxy } from "../src/proxy.ts";
import { rng } from "../test/harness.ts";

const { values } = parseArgs({
  options: {
    fps: { type: "string", default: "24" },
    grid: { type: "string", default: "2" },
    mtu: { type: "string", default: "1400" },
    loss: { type: "string", default: "0.15" },
    delay: { type: "string", default: "150" },
    socks: { type: "string", default: "1080" },
    http: { type: "string", default: "8080" },
  },
});

const fps = Number(values.fps);
const grid = Number(values.grid);
const mtu = Number(values.mtu);
const loss = Number(values.loss);
const delayMs = Number(values.delay);
const rand = rng(Date.now());

const log = (who: string) => (e: { level: string; msg: string }) => console.log(`[${who}] ${e.msg}`);
const egress = new Egress(DEFAULT_POLICY, (level, msg) => gw.note(level, msg));
const gw = new GatewayPeer({ name: "sim-gateway", host: egress });
const proxy = new ClientProxy((level, msg) => cl.note(level, msg));
const cl = new ClientPeer({ name: "sim-client", host: proxy });
gw.on("log", log("gateway"));
cl.on("log", log("client"));
gw.on("change", () => {
  if (gw.pending) gw.authorize();
});

await proxy.listenSocks(Number(values.socks));
if (Number(values.http)) await proxy.listenHttp(Number(values.http));

function pump(from: Peer, to: Peer): void {
  for (let i = 0; i < grid; i++) {
    const f = from.nextFrame(mtu);
    if (!f || rand() < loss) continue;
    setTimeout(() => to.onFrame(f), delayMs + rand() * (1000 / fps));
  }
}

setInterval(() => {
  pump(gw, cl);
  pump(cl, gw);
}, 1000 / fps);

let last = { t: performance.now(), d: 0, u: 0 };
setInterval(() => {
  const s = cl.session;
  if (!s) return;
  const now = performance.now();
  const dt = (now - last.t) / 1000;
  const d = s.mux.dataIn;
  const u = s.mux.dataOut;
  if (d !== last.d || u !== last.u) {
    console.log(
      `[link] giu ${((d - last.d) / 1024 / dt).toFixed(1)} KB/s, su ${((u - last.u) / 1024 / dt).toFixed(1)} KB/s, RTT ${Math.round(s.sender.srtt)} ms, stream ${proxy.openCount()}`,
    );
  }
  last = { t: now, d, u };
}, 2000);

const cap = ((grid * fps * (mtu - 52)) / 1024).toFixed(0);
console.log(`Simulazione: ${grid} QR x ${fps} fps x ${mtu} B (max ~${cap} KB/s per verso), perdita ${loss * 100}%, ritardo ${delayMs} ms`);
console.log(`SOCKS5 127.0.0.1:${values.socks}  HTTP 127.0.0.1:${values.http}`);
