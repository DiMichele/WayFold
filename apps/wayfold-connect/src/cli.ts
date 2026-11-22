import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Egress } from "./egress.ts";
import { CLOSE_SHUTDOWN } from "./mux.ts";
import { ClientPeer, GatewayPeer, type Peer } from "./peer.ts";
import { DEFAULT_POLICY, parseList, type GatewayPolicy } from "./policy.ts";
import { ClientProxy } from "./proxy.ts";
import { DEFAULT_MODEM_ORIGINS, startServer } from "./server.ts";

const USAGE = `Wayfold Connect (PoC)

  node src/cli.ts gateway [opzioni]   PC con Internet
  node src/cli.ts client  [opzioni]   PC che naviga attraverso il gateway

Comuni:
  --port <n>          pannello e WebSocket del modem (gateway 7701, client 7702)
  --name <testo>      nome mostrato all'altro lato (default: hostname)
  --relay-dist <dir>  build di wayfold-relay da servire su /modem/
  --modem-origin <u>  altre origini https della pagina modem (default: https://transfer.wayfold.xyz)
  --idle <min>        disconnessione per inattivita' (default 15)
  --max-session <min> durata massima della sessione (default 120)

Gateway:
  --allow <a,b>       domini consentiti (suffisso; default: tutti)
  --deny <a,b>        domini bloccati (prevale su --allow)
  --ports <80,443>    porte di destinazione consentite (vuoto = tutte)
  --allow-private     consente LAN, loopback e indirizzi privati
  --max-streams <n>   connessioni contemporanee (default 48)

Client:
  --socks <n>         porta SOCKS5 locale (default 1080)
  --http <n>          porta proxy HTTP locale (default 8080, 0 = disattivo)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string" },
    name: { type: "string" },
    "relay-dist": { type: "string" },
    "modem-origin": { type: "string", multiple: true },
    idle: { type: "string" },
    "max-session": { type: "string" },
    allow: { type: "string" },
    deny: { type: "string" },
    ports: { type: "string" },
    "allow-private": { type: "boolean" },
    "max-streams": { type: "string" },
    socks: { type: "string" },
    http: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const role = positionals[0];
if (values.help || (role !== "gateway" && role !== "client")) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

function num(raw: string | undefined, def: number): number {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Valore non valido: ${raw}`);
    process.exit(1);
  }
  return n;
}

const port = num(values.port, role === "gateway" ? 7701 : 7702);
const name = (values.name ?? hostname()).slice(0, 40);
const timers = {
  idleMs: num(values.idle, 15) * 60_000,
  maxSessionMs: num(values["max-session"], 120) * 60_000,
};
const defaultDist = fileURLToPath(new URL("../../wayfold-relay/dist", import.meta.url));
const relayDist = values["relay-dist"] ?? (existsSync(defaultDist) ? defaultDist : null);

const stamp = () => new Date().toLocaleTimeString("it-IT");
const log = (level: string, msg: string) => console.log(`${stamp()} [${level}] ${msg}`);

let peer: Peer;
let extraStatus: () => Record<string, unknown>;
let onAction: (action: string) => boolean;
let shutdown: () => void;

if (role === "gateway") {
  const policy: GatewayPolicy = {
    ...DEFAULT_POLICY,
    allow: parseList(values.allow),
    deny: parseList(values.deny),
    blockPrivate: !values["allow-private"],
    ports: values.ports !== undefined ? parseList(values.ports).map(Number).filter((n) => n > 0 && n < 65536) : DEFAULT_POLICY.ports,
    maxStreams: num(values["max-streams"], DEFAULT_POLICY.maxStreams),
  };
  const egress = new Egress(policy, (level, msg) => g.note(level, msg));
  const g = new GatewayPeer({ name, host: egress, timers });
  peer = g;
  extraStatus = () => ({ policy, streamsList: egress.list(), opened: egress.opened, refused: egress.refused });
  onAction = (a) => {
    if (a === "authorize") return g.authorize();
    if (a === "reject") return g.reject();
    if (a === "disconnect") return g.disconnect(), true;
    return false;
  };
  shutdown = () => g.disconnect(CLOSE_SHUTDOWN);
} else {
  const proxy = new ClientProxy((level, msg) => c.note(level, msg));
  const c = new ClientPeer({ name, host: proxy, timers });
  peer = c;
  const socksPort = num(values.socks, 1080);
  const httpPort = num(values.http, 8080);
  await proxy.listenSocks(socksPort);
  if (httpPort) await proxy.listenHttp(httpPort);
  extraStatus = () => ({ proxy: { socks: socksPort, http: httpPort || null }, streamsList: proxy.list(), opened: proxy.opened, failed: proxy.failed });
  onAction = (a) => {
    if (a === "disconnect") return c.disconnect(), true;
    if (a === "reconnect") return c.reconnect(), true;
    return false;
  };
  shutdown = () => {
    c.disconnect(CLOSE_SHUTDOWN);
    proxy.close();
  };
}

peer.on("log", (e: { level: string; msg: string }) => log(e.level, e.msg));
setInterval(() => peer.tick(), 500).unref();

const modemOrigins = [...DEFAULT_MODEM_ORIGINS, ...(values["modem-origin"] ?? []).map((o) => o.replace(/\/+$/, ""))];
await startServer({ peer, port, relayDist, modemOrigins, extraStatus, onAction });

const base = `http://127.0.0.1:${port}`;
const wsUrl = encodeURIComponent(`ws://127.0.0.1:${port}/modem-ws`);
console.log(`\nWayfold Connect - ${role === "gateway" ? "GATEWAY" : "CLIENT"} "${name}"`);
console.log(`  Pannello:      ${base}/`);
console.log(`  Pagina modem:  https://transfer.wayfold.xyz/modem/?ws=${wsUrl}`);
if (relayDist) console.log(`                 (offline: ${base}/modem/)`);
if (role === "client") {
  const s = (extraStatus().proxy as { socks: number; http: number | null });
  console.log(`  Proxy SOCKS5:  127.0.0.1:${s.socks}${s.http ? `   HTTP: 127.0.0.1:${s.http}` : ""}`);
  console.log(`  Browser:       chrome --user-data-dir=%TEMP%\\wayfold-connect --proxy-server="socks5://127.0.0.1:${s.socks}"`);
}
console.log("");

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(0);
  stopping = true;
  shutdown();
  setTimeout(() => process.exit(0), 1500);
});
