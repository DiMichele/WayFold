import { DEFAULT_POLICY, type DiodePolicy } from "./policy.ts";
import type { LogLevel } from "./store.ts";

export const LOG_EVENT = "wf:diode-log";
export const POLICY_EVENT = "wf:diode-policy";

let activePolicy: DiodePolicy = DEFAULT_POLICY;

export function currentPolicy(): DiodePolicy {
  return activePolicy;
}

export function setCurrentPolicy(policy: DiodePolicy): void {
  activePolicy = policy;
  window.dispatchEvent(new Event(POLICY_EVENT));
}

export function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

export function showBanner(id: string, message: string | null): void {
  const box = el(id);
  if (!box) return;
  box.hidden = !message;
  box.textContent = message ?? "";
}

/** Transfers are not recorded. The signature stays so callers do not keep a side channel. */
export function logEvent(_level: LogLevel, _key: string, _params: Record<string, string | number> = {}): void {}

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};

export class ScreenWake {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;

  acquire(): void {
    this.wanted = true;
    if (this.sentinel || document.hidden) return;
    void (navigator as WakeLockNavigator).wakeLock
      ?.request("screen")
      .then((s) => {
        if (this.wanted) this.sentinel = s;
        else void s.release();
      })
      .catch(() => undefined);
  }

  /** The browser drops the lock when the page is hidden; call on visibility return. */
  refresh(): void {
    this.sentinel = null;
    if (this.wanted) this.acquire();
  }

  release(): void {
    this.wanted = false;
    void this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
  }
}
