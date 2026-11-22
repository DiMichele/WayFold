import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(process.argv[2] || path.join(here, "..", "dist"));
const certDir = path.join(here, "certs");
const PORT = Number(process.env.RELAY_PORT || 8443);
const LOCAL_PORT = Number(process.env.RELAY_LOCAL_PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function lanIpv4() {
  const out = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0] || "/");
  if (p.endsWith("/")) p += "index.html";
  const rel = p.replace(/^\//, "").replace(/\\/g, "/");
  if (rel.includes("..")) return null;
  const file = path.normalize(path.join(distRoot, rel));
  const rootNorm = path.normalize(distRoot);
  if (!file.startsWith(rootNorm)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  const index = path.join(path.dirname(file), "index.html");
  if (fs.existsSync(index) && fs.statSync(index).isFile()) return index;
  return null;
}

function serveStatic(req, res) {
  const file = safePath(new URL(req.url || "/", "https://local").pathname);
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(file).pipe(res);
}

/**
 * Network exit for the Rete page: the browsing device reaches whatever this PC
 * reaches, private addresses and intranet names included. Only this PC's own
 * browser may use it, otherwise anyone on the LAN would get an open proxy.
 */
async function loadWisp() {
  try {
    const { logging, server } = await import("@mercuryworkshop/wisp-js/server");
    logging.set_level(logging.WARN);
    Object.assign(server.options, {
      allow_private_ips: true,
      allow_loopback_ips: true,
      allow_udp_streams: false,
      port_blacklist: [],
      dns_result_order: "ipv4first",
    });
    return server;
  } catch (err) {
    console.warn(`Uscita Rete non disponibile: ${err.message}`);
    return null;
  }
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sameOrigin(req) {
  try {
    return new URL(req.headers.origin ?? "").host === req.headers.host;
  } catch {
    return false;
  }
}

function attachWisp(srv, wisp) {
  srv.on("upgrade", (req, socket, head) => {
    if (!wisp || !req.url?.startsWith("/wisp/") || !isLoopback(req.socket.remoteAddress) || !sameOrigin(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    wisp.routeRequest(req, socket, head);
  });
}

async function main() {
  if (!fs.existsSync(distRoot)) {
    console.error(`Cartella dist non trovata: ${distRoot}`);
    process.exit(1);
  }
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error("Certificati mancanti in offline/certs/. Ricostruisci il pacchetto offline.");
    process.exit(1);
  }

  const wisp = await loadWisp();
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);

  const secure = https.createServer({ key, cert }, serveStatic);
  attachWisp(secure, wisp);
  // localhost over plain HTTP is a secure context: service workers and camera work without certificate warnings.
  const local = http.createServer(serveStatic);
  attachWisp(local, wisp);

  await Promise.all([
    new Promise((resolve) => secure.listen(PORT, "0.0.0.0", resolve)),
    new Promise((resolve) => local.listen(LOCAL_PORT, "127.0.0.1", resolve)),
  ]);

  console.log("");
  console.log("WayFold Relay — server locale (offline)");
  console.log("=======================================");
  console.log("");
  console.log("Su questo PC (invio file e Rete):");
  console.log(`  http://localhost:${LOCAL_PORT}/`);
  console.log(`  Rete:  http://localhost:${LOCAL_PORT}/#net`);
  if (wisp) console.log("  Scegli Condividi: l'altro dispositivo naviga attraverso la rete di questo PC.");
  console.log("");
  console.log("Telefono ricevente (stessa rete del PC, senza internet):");
  const ips = lanIpv4();
  if (ips.length === 0) {
    console.log("  (collega Wi‑Fi o hotspot, poi riavvia se serve)");
  } else {
    for (const ip of ips) console.log(`  https://${ip}:${PORT}/receive/`);
  }
  console.log("  Prima visita: accetta l'avviso sul certificato (autofirmato), poi consenti la fotocamera.");
  console.log("");
  console.log("Ctrl+C per uscire.");
  console.log("");
}

main();
