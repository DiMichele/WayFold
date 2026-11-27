/** Minimal perf HUD: rates + copy JSON. Shown only when `perf` is on. */

import { getOptFlags } from "./opt-flags.ts";
import { optTrace } from "./opt-trace.ts";
import { formatKiBps } from "./throughput.ts";

export function ensureOptHud(host: HTMLElement | null): HTMLElement | null {
  if (!host || !getOptFlags().perf) return null;
  let panel = host.querySelector<HTMLElement>("[data-opt-hud]");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.dataset.optHud = "1";
  panel.className = "opt-hud";
  panel.innerHTML =
    `<pre data-opt-body></pre>` +
    `<button type="button" data-opt-copy class="btn-ghost">Copia JSON</button>`;
  host.append(panel);
  panel.querySelector("[data-opt-copy]")?.addEventListener("click", () => {
    void navigator.clipboard?.writeText(optTrace.toJson()).catch(() => undefined);
  });
  return panel;
}

export function renderOptHud(host: HTMLElement | null): void {
  if (!getOptFlags().perf) return;
  const panel = ensureOptHud(host);
  const body = panel?.querySelector("[data-opt-body]");
  if (!body) return;
  const s = optTrace.snapshot();
  const lines = [
    `cfg ${s.fps.configured.toFixed(0)} · neg ${s.fps.negotiated.toFixed(1)} · obs ${s.fps.observed.toFixed(1)} · proc ${s.fps.processed.toFixed(1)}`,
    `QR/s ${s.goodput.uniqueQrPerSec.toFixed(1)} · ottico ${formatKiBps(s.goodput.opticalBps)} · fountain ${formatKiBps(s.goodput.fountainBps)}`,
    `file ${formatKiBps(s.goodput.fileBps)} · worker ${s.busyWorkers}/${s.workerCount}` +
      (s.heapMiB != null ? ` · heap ${s.heapMiB.toFixed(0)} MiB` : "") +
      (s.sharpness != null ? ` · sharp ${s.sharpness.toFixed(0)}` : ""),
  ];
  if (s.grabs.frames > 0 && s.grabs.last) {
    const mean = s.grabs.pixels / s.grabs.frames;
    lines.push(
      `grab ${s.grabs.last.full ? "full" : "crop"} ×${s.grabs.last.jobs} · media ${(mean / 1e6).toFixed(2)} Mpx · full ${s.grabs.fullFrames}/${s.grabs.frames}`,
    );
  }
  if (s.exposure && (s.exposure.intent !== "off" || s.exposure.mode)) {
    const time = s.exposure.timeS != null ? ` ${(s.exposure.timeS * 1000).toFixed(1)} ms` : "";
    lines.push(
      `exp ${s.exposure.intent} · ${s.exposure.mode ?? "n/d"}${time}` +
        (s.exposure.applied ? "" : " · non applicata"),
    );
  }
  if (s.arqRttMs != null) {
    lines.push(
      `ARQ RTT ${s.arqRttMs.toFixed(0)} ms` +
        (s.txWaitMs != null ? ` · txWait ${s.txWaitMs.toFixed(0)}` : "") +
        (s.rxWaitMs != null ? ` · rxWait ${s.rxWaitMs.toFixed(0)}` : "") +
        (s.jitterMs != null ? ` · jitter ${s.jitterMs.toFixed(0)}` : ""),
    );
  }
  body.textContent = lines.join("\n");
}

export function removeOptHud(host: HTMLElement | null): void {
  host?.querySelector("[data-opt-hud]")?.remove();
}
