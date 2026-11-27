/** Feature flags for optical-path experiments. All default off. */

export type OptFlag =
  | "perf"
  | "roi"
  | "mem"
  | "fast"
  | "latest"
  | "native";

export type OptSchedule = "drop" | "latest" | "pool";

export interface OptFlags {
  perf: boolean;
  roi: boolean;
  mem: boolean;
  fast: boolean;
  latest: boolean;
  native: boolean;
  /** Multiplier of observed camera period for the per-frame decode budget. */
  budget: 0.5 | 1 | 1.5 | 2;
  /** Latest-frame strategy when `latest` is on. */
  schedule: OptSchedule;
}

const STORAGE_KEY = "wf-opt";
const ALL: OptFlag[] = ["perf", "roi", "mem", "fast", "latest", "native"];

const DEFAULTS: OptFlags = {
  perf: false,
  roi: false,
  mem: false,
  fast: false,
  latest: false,
  native: false,
  budget: 1,
  schedule: "drop",
};

let cached: OptFlags | null = null;

function parseBudget(raw: string | undefined): OptFlags["budget"] {
  const n = Number(raw);
  if (n === 0.5 || n === 1 || n === 1.5 || n === 2) return n;
  return 1;
}

function parseSchedule(raw: string | undefined): OptSchedule {
  if (raw === "latest" || raw === "pool") return raw;
  return "drop";
}

/** Parse a comma-separated `wfopt` token list. Exported for unit tests. */
export function parseOptList(raw: string | null): OptFlags {
  const out: OptFlags = { ...DEFAULTS };
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    if (token.startsWith("budget:")) {
      out.budget = parseBudget(token.slice("budget:".length));
      continue;
    }
    if (token.startsWith("sched:")) {
      out.schedule = parseSchedule(token.slice("sched:".length));
      if (out.schedule !== "drop") out.latest = true;
      continue;
    }
    if ((ALL as string[]).includes(token)) {
      out[token as OptFlag] = true;
    }
  }
  if (out.latest && out.schedule === "drop") out.schedule = "latest";
  return out;
}

function readQuery(): string | null {
  try {
    return new URLSearchParams(location.search).get("wfopt");
  } catch {
    return null;
  }
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Resolve once per page load. Query wins over localStorage. */
export function getOptFlags(): OptFlags {
  if (cached) return cached;
  const fromQuery = readQuery();
  cached = parseOptList(fromQuery ?? readStorage());
  return cached;
}

/** Test helper: replace the resolved flags without touching storage. */
export function setOptFlagsForTest(next: Partial<OptFlags> | null): void {
  cached = next ? { ...DEFAULTS, ...next } : null;
}

export function optFlagsSnapshot(): OptFlags {
  return { ...getOptFlags() };
}
