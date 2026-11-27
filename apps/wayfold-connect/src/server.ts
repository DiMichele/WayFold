import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { clampMtu } from "./wire.ts";
import type { Peer } from "./peer.ts";

const MAX_BATCH = 4;
const STATUS_PUSH_MS = 500;
/** The panel buttons, also reachable from the modem page: whoever runs the frames can approve the link. */
const MODEM_ACTIONS = new Set(["authorize", "reject", "disconnect", "reconnect"]);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export interface ServerOptions {
  peer: Peer;
  port: number;
  /** Built wayfold-relay (for /modem/). Optional: the modem can also run from the Vite dev server. */
  relayDist: string | null;
  /** Non-local origins allowed on /modem-ws (the admin API stays loopback-only). */
  modemOrigins: string[];
  extraStatus: () => Record<string, unknown>;
  onAction: (action: string) => boolean;
}

/** Hosted copies of the modem page that may drive the local helper. */
export const DEFAULT_MODEM_ORIGINS = ["https://transfer.wayfold.xyz"];

function localOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

class Rates {
  private last = { t: performance.now(), dataIn: 0, dataOut: 0, frames: 0 };
  inBps = 0;
  outBps = 0;
  framesPerSec = 0;

  update(dataIn: number, dataOut: number, frames: number): void {
    const now = performance.now();
    const dt = (now - this.last.t) / 1000;
    if (dt < 0.9) return;
    const d = (a: number, b: number) => Math.max(0, a - b);
    this.inBps = d(dataIn, this.last.dataIn) / dt;
    this.outBps = d(dataOut, this.last.dataOut) / dt;
    this.framesPerSec = d(frames, this.last.frames) / dt;
    this.last = { t: now, dataIn, dataOut, frames };
  }
}

export function startServer(opts: ServerOptions): Promise<{ close: () => void }> {
  const { peer } = opts;
  const adminHtml = readFileSync(new URL("./admin.html", import.meta.url), "utf8");
  const rates = new Rates();
  let modem: WebSocket | null = null;
  let modemInfo: { mtu: number; grid: number; fps: number } | null = null;
  let modemStats: Record<string, unknown> = {};

  const fullStatus = () => {
    const st = peer.status();
    const s = st.session;
    rates.update(s?.dataIn ?? 0, s?.dataOut ?? 0, peer.framesIn);
    return {
      ...st,
      rates: { inBps: rates.inBps, outBps: rates.outBps, framesInPerSec: rates.framesPerSec },
      modem: modem ? { ...modemInfo, ...modemStats } : null,
      log: peer.log.slice(-80),
      ...opts.extraStatus(),
    };
  };

  const http = createServer((req, res) => void route(req, res));

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://local");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": TYPES[".html"]!, "cache-control": "no-store" });
      res.end(adminHtml);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      res.writeHead(200, { "content-type": TYPES[".json"]!, "cache-control": "no-store" });
      res.end(JSON.stringify(fullStatus()));
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      if (!localOrigin(req.headers.origin) || req.headers["x-wayfold"] !== "1") {
        res.writeHead(403).end();
        return;
      }
      const ok = opts.onAction(url.pathname.slice(5));
      res.writeHead(ok ? 200 : 409, { "content-type": TYPES[".json"]! });
      res.end(JSON.stringify({ ok }));
      return;
    }
    if (req.method === "GET" && opts.relayDist) {
      serveStatic(opts.relayDist, url.pathname, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Non trovato");
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    const origin = req.headers.origin;
    const allowed = localOrigin(origin) || (!!origin && opts.modemOrigins.includes(origin));
    if (url.pathname !== "/modem-ws" || !allowed) {
      if (url.pathname === "/modem-ws") console.log(`[modem] origine rifiutata: ${origin}`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachModem(ws));
  });

  function attachModem(ws: WebSocket): void {
    if (modem) modem.close(4000, "sostituito da una nuova pagina modem");
    modem = ws;
    modemInfo = null;
    modemStats = {};
    ws.binaryType = "nodebuffer";
    console.log("[modem] pagina modem collegata");
    const push = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      const st = peer.status();
      ws.send(
        JSON.stringify({
          t: "status",
          role: st.role,
          name: st.name,
          state: st.state,
          code: "code" in st ? st.code : st.pending?.sas ?? st.client?.sas ?? "",
          awaiting: "awaitingApproval" in st ? st.awaitingApproval : !!st.pending,
          linkUp: !!st.session?.linkUp,
          rttMs: st.session?.rttMs ?? 0,
          inBps: rates.inBps,
          outBps: rates.outBps,
        }),
      );
    }, STATUS_PUSH_MS);

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        peer.onFrame(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        return;
      }
      let msg: { t?: string; n?: number; mtu?: number; grid?: number; fps?: number; action?: string; stats?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.t === "hello") {
        modemInfo = { mtu: clampMtu(Number(msg.mtu)), grid: Number(msg.grid) || 1, fps: Number(msg.fps) || 0 };
        console.log(`[modem] mtu ${modemInfo.mtu}, griglia ${modemInfo.grid}, ${modemInfo.fps} fps`);
      } else if (msg.t === "pull" && modemInfo) {
        const n = Math.max(1, Math.min(MAX_BATCH, Number(msg.n) || 1));
        const frames: Uint8Array[] = [];
        for (let i = 0; i < n; i++) {
          const f = peer.nextFrame(modemInfo.mtu);
          if (f) frames.push(f);
        }
        ws.send(packBatch(frames));
      } else if (msg.t === "stats" && msg.stats) {
        modemStats = msg.stats;
      } else if (msg.t === "action" && typeof msg.action === "string" && MODEM_ACTIONS.has(msg.action)) {
        const ok = opts.onAction(msg.action);
        console.log(`[modem] azione ${msg.action}: ${ok ? "eseguita" : "non applicabile"}`);
        ws.send(JSON.stringify({ t: "action", action: msg.action, ok }));
      }
    });
    ws.on("close", () => {
      clearInterval(push);
      if (modem === ws) {
        modem = null;
        console.log("[modem] pagina modem scollegata");
      }
    });
  }

  return new Promise((resolveListen, reject) => {
    http.once("error", reject);
    http.listen(opts.port, "127.0.0.1", () =>
      resolveListen({
        close: () => {
          for (const client of wss.clients) client.terminate();
          http.close();
        },
      }),
    );
  });
}

/** count u8, then per frame len u16 + bytes. */
function packBatch(frames: Uint8Array[]): Buffer {
  let total = 1;
  for (const f of frames) total += 2 + f.length;
  const out = Buffer.alloc(total);
  out[0] = frames.length;
  let off = 1;
  for (const f of frames) {
    out.writeUInt16BE(f.length, off);
    out.set(f, off + 2);
    off += 2 + f.length;
  }
  return out;
}

function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const base = resolve(root);
  let file = normalize(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!pathname.endsWith("/")) {
      res.writeHead(301, { location: pathname + "/" }).end();
      return;
    }
    file = join(file, "index.html");
  }
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Non trovato");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}
