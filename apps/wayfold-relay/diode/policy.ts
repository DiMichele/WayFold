import { MAX_ORIGINAL_FILE_LEN, MIB } from "../shared/limits.ts";

/** What the page uses. Every type, up to the hard size limit. Timing is chosen per lap, not here. */

export interface DiodePolicy {
  /** Largest original file (bytes) TX will queue and RX will accept. */
  maxBytes: number;
  /** Lowercase extensions without the dot; empty means every type is allowed. */
  allowedExtensions: string[];
  /** Frames on air per object, as a multiple of its source block count k. */
  repeatFactor: number;
  /** Minimum time an object stays on air before the carousel moves on. */
  minDwellMs: number;
}

export const MIN_POLICY_BYTES = 1024;
export const MIN_REPEAT_FACTOR = 1.05;
export const MAX_REPEAT_FACTOR = 5;
export const MIN_DWELL_MS = 2_000;
export const MAX_DWELL_MS = 120_000;
const MAX_EXTENSIONS = 64;
const MAX_EXTENSION_LEN = 16;

export const DEFAULT_POLICY: DiodePolicy = {
  maxBytes: 8 * MIB,
  allowedExtensions: [],
  repeatFactor: 1.25,
  minDwellMs: 8_000,
};

export const AUTOMATIC_POLICY: DiodePolicy = {
  maxBytes: MAX_ORIGINAL_FILE_LEN,
  allowedExtensions: [],
  repeatFactor: 1.15,
  minDwellMs: 2_000,
};

export type PolicyPresetId = "standard" | "documents" | "large" | "steady";

/** Ready-made policies. The numbers stay here so the page never asks for them. */
export const POLICY_PRESETS: readonly { id: PolicyPresetId; policy: DiodePolicy }[] = [
  { id: "standard", policy: DEFAULT_POLICY },
  {
    id: "documents",
    policy: {
      maxBytes: 8 * MIB,
      allowedExtensions: ["pdf", "txt", "png", "jpg", "jpeg", "webp", "doc", "docx"],
      repeatFactor: 1.25,
      minDwellMs: 8_000,
    },
  },
  {
    id: "large",
    policy: { maxBytes: 32 * MIB, allowedExtensions: [], repeatFactor: 1.25, minDwellMs: 8_000 },
  },
  {
    id: "steady",
    policy: { maxBytes: 8 * MIB, allowedExtensions: [], repeatFactor: 2, minDwellMs: 15_000 },
  },
];

export function presetPolicy(id: PolicyPresetId): DiodePolicy {
  const found = POLICY_PRESETS.find((preset) => preset.id === id);
  return normalizePolicy(found?.policy ?? DEFAULT_POLICY);
}

export function matchPreset(policy: DiodePolicy): PolicyPresetId | null {
  const current = normalizePolicy(policy);
  const same = (other: DiodePolicy) =>
    other.maxBytes === current.maxBytes &&
    other.repeatFactor === current.repeatFactor &&
    other.minDwellMs === current.minDwellMs &&
    other.allowedExtensions.join("\0") === current.allowedExtensions.join("\0");
  return POLICY_PRESETS.find((preset) => same(normalizePolicy(preset.policy)))?.id ?? null;
}

export type PolicyVerdict = { ok: true } | { ok: false; reason: "size" | "type" };

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function parseExtensionList(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const ext = raw.trim().toLowerCase().replace(/^\*?\.+/, "");
    if (!ext || ext.length > MAX_EXTENSION_LEN || !/^[a-z0-9_+-]+$/.test(ext)) continue;
    out.add(ext);
    if (out.size >= MAX_EXTENSIONS) break;
  }
  return [...out];
}

export function normalizePolicy(input: Partial<DiodePolicy> | null | undefined): DiodePolicy {
  const src = input ?? {};
  const extensions = Array.isArray(src.allowedExtensions)
    ? parseExtensionList(src.allowedExtensions.join(" "))
    : DEFAULT_POLICY.allowedExtensions;
  return {
    maxBytes: Math.round(
      clamp(Number(src.maxBytes), MIN_POLICY_BYTES, MAX_ORIGINAL_FILE_LEN, DEFAULT_POLICY.maxBytes),
    ),
    allowedExtensions: extensions,
    repeatFactor: clamp(
      Number(src.repeatFactor),
      MIN_REPEAT_FACTOR,
      MAX_REPEAT_FACTOR,
      DEFAULT_POLICY.repeatFactor,
    ),
    minDwellMs: Math.round(
      clamp(Number(src.minDwellMs), MIN_DWELL_MS, MAX_DWELL_MS, DEFAULT_POLICY.minDwellMs),
    ),
  };
}

export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function checkPolicy(policy: DiodePolicy, file: { filename: string; size: number }): PolicyVerdict {
  if (!(file.size > 0) || file.size > policy.maxBytes) return { ok: false, reason: "size" };
  if (policy.allowedExtensions.length > 0) {
    const ext = fileExtension(file.filename);
    if (!ext || !policy.allowedExtensions.includes(ext)) return { ok: false, reason: "type" };
  }
  return { ok: true };
}
