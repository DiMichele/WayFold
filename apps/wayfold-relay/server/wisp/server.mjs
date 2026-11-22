import http from "node:http";
import { logging, server as wisp } from "@mercuryworkshop/wisp-js/server";

/**
 * Exit point for the Network page: the sharing PC forwards the browsing PC's
 * Wisp messages here. Only pages served by WayFold may connect; the link is
 * already end-to-end TLS between the browsing PC and the site.
 */

const PORT = Number(process.env.PORT ?? 7900);
const HOST = process.env.HOST ?? "127.0.0.1";
const ORIGINS = new Set((process.env.ALLOWED_ORIGINS ?? "https://transfer.wayfold.xyz").split(",").map((o) => o.trim()).filter(Boolean));
const PORTABLE_KEY = process.env.PORTABLE_WISP_KEY ?? "";
const MAX_PER_IP = Number(process.env.MAX_PER_IP ?? 4);

logging.set_level(logging.WARN);
Object.assign(wisp.options, {
  allow_private_ips: false,
  allow_loopback_ips: false,
  allow_udp_streams: false,
  // Outbound mail is the classic abuse of open proxies.
  port_blacklist: [25, 465, 587, 2525],
  stream_limit_total: 96,
  parse_real_ip: true,
  parse_real_ip_from: ["127.0.0.1", "::1", "172.17.0.1"],
  dns_result_order: "ipv4first",
});

const perIp = new Map();

function clientIp(req) {
  const real = req.headers["x-real-ip"];
  return (typeof real === "string" && real) || req.socket.remoteAddress || "?";
}

const srv = http.createServer((req, res) => {
  res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "text/plain" }).end(req.url === "/health" ? "ok" : "");
});

function portableFile(req) {
  if (!PORTABLE_KEY) return false;
  const origin = req.headers.origin;
  if (origin && origin !== "null") return false;
  try {
    return new URL(req.url ?? "/", "http://wisp").searchParams.get("k") === PORTABLE_KEY;
  } catch {
    return false;
  }
}

srv.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin ?? "";
  const ip = clientIp(req);
  if (!(ORIGINS.has(origin) || portableFile(req)) || !req.url?.startsWith("/wisp/")) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const open = perIp.get(ip) ?? 0;
  if (open >= MAX_PER_IP) {
    socket.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    return;
  }
  perIp.set(ip, open + 1);
  socket.once("close", () => {
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
  });
  wisp.routeRequest(req, socket, head);
});

srv.listen(PORT, HOST, () => console.log(`wayfold wisp on ${HOST}:${PORT}, origins: ${[...ORIGINS].join(" ")}`));
