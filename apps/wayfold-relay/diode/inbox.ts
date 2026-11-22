import { MIB } from "../shared/limits.ts";

export const INBOX_MAX_ITEMS = 20;
export const INBOX_MAX_BYTES = 100 * MIB;

export interface InboxMeta {
  sha: string;
  size: number;
  receivedAt: number;
}

export type InboxPlan = { duplicate: true } | { duplicate: false; evict: string[] };

/**
 * Same content (same SHA-256) is stored once. Otherwise the oldest entries
 * are evicted until the newcomer fits both the item and the byte budget.
 */
export function planInboxInsert(
  existing: readonly InboxMeta[],
  incoming: InboxMeta,
  maxItems = INBOX_MAX_ITEMS,
  maxBytes = INBOX_MAX_BYTES,
): InboxPlan {
  if (existing.some((item) => item.sha === incoming.sha)) return { duplicate: true };
  const oldestFirst = [...existing].sort((a, b) => a.receivedAt - b.receivedAt);
  let count = oldestFirst.length;
  let bytes = oldestFirst.reduce((sum, item) => sum + item.size, 0);
  const evict: string[] = [];
  for (const item of oldestFirst) {
    if (count + 1 <= maxItems && bytes + incoming.size <= maxBytes) break;
    evict.push(item.sha);
    count--;
    bytes -= item.size;
  }
  return { duplicate: false, evict };
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}
