import { isIP } from "node:net";

export interface GatewayPolicy {
  /** Domain suffixes; empty or "*" means every domain. */
  allow: string[];
  /** Domain suffixes, checked before `allow`. */
  deny: string[];
  /** Refuse loopback, private, link-local and CGNAT targets. */
  blockPrivate: boolean;
  /** Empty means every port. */
  ports: number[];
  maxStreams: number;
}

export const DEFAULT_POLICY: GatewayPolicy = {
  allow: [],
  deny: [],
  blockPrivate: true,
  ports: [80, 443],
  maxStreams: 48,
};

export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, ""))
    .filter(Boolean);
}

function suffixMatch(host: string, rule: string): boolean {
  return host === rule || host.endsWith("." + rule);
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export type HostVerdict = { ok: true } | { ok: false; reason: string };

export function checkHost(policy: GatewayPolicy, rawHost: string, port: number): HostVerdict {
  const host = normalizeHost(rawHost);
  if (!host || host.length > 253) return { ok: false, reason: "host non valido" };
  if (policy.ports.length && !policy.ports.includes(port)) return { ok: false, reason: `porta ${port} non consentita` };
  if (policy.deny.some((r) => r === "*" || suffixMatch(host, r))) return { ok: false, reason: "dominio bloccato" };
  const allowAll = policy.allow.length === 0 || policy.allow.includes("*");
  if (!allowAll && !policy.allow.some((r) => suffixMatch(host, r))) return { ok: false, reason: "dominio fuori dall'elenco consentito" };
  if (policy.blockPrivate && isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "indirizzo privato bloccato" };
  if (policy.blockPrivate && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))) {
    return { ok: false, reason: "nome locale bloccato" };
  }
  return { ok: true };
}

function v4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  const [a, b] = [p[0]!, p[1]!];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return v4Private(ip);
  if (v !== 6) return true;
  const x = ip.toLowerCase();
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Private(mapped[1]!);
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
}
