/** Minimal perf HUD: rates + copy JSON. Shown only when `perf` is on. */

import { resetOpticsClock } from "../receive/optics-metrics.ts";
import { getOptFlags } from "./opt-flags.ts";
import { optTrace, type OptSnapshot } from "./opt-trace.ts";
import { formatBitrate, formatKBps } from "./throughput.ts";

export type HudProfile = "file" | "link";

/** New capture session. Clears windows from the previous mode. */
export function beginOptSession(configuredFps = 0): void {
  resetOpticsClock();
  optTrace.reset();
  optTrace.configuredFps = configuredFps;
}

/** Leaving a mode. A suspended Transfer send does not call this. */
export function endOptSession(): void {
  resetOpticsClock();
  optTrace.reset();
}

function rate(bytesPerSec: number, unit: "kB" | "bit"): string {
  return (unit === "bit" ? formatBitrate : formatKBps)(bytesPerSec);
}

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "n/d";
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

function formatTotal(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "n/d";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function wasmStats(samples: OptSnapshot["samples"]): { last: number | null; mean: number | null } {
  const xs = samples.filter((s) => s.phase === "wasm").map((s) => s.dt);
  if (!xs.length) return { last: null, mean: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { last: xs[xs.length - 1] ?? null, mean };
}

/** Lines for the HUD and for tests. `link` is the bidirectional modem: no fountain, no file. */
export function hudLines(s: OptSnapshot, unit: "kB" | "bit" = "kB", profile: HudProfile = "file"): string[] {
  const fmt = (n: number) => rate(n, unit);
  const lines = [
    `cfg ${s.fps.configured.toFixed(0)} · neg ${s.fps.negotiated.toFixed(1)} · obs ${s.fps.observed.toFixed(1)} · proc ${s.fps.processed.toFixed(1)}`,
    `letti ${s.goodput.decodedPerSec.toFixed(1)}/s · nuovi ${s.goodput.uniqueQrPerSec.toFixed(1)}/s`,
    `ottico ist ${fmt(s.goodput.optical.instantBps)} · sess ${fmt(s.goodput.optical.sessionBps)} · fin ${fmt(s.goodput.optical.finalBps)} (mis)`,
  ];
  if (profile === "file") {
    lines.push(
      `fountain ist ${fmt(s.goodput.fountain.instantBps)} · sess ${fmt(s.goodput.fountain.sessionBps)} · fin ${fmt(s.goodput.fountain.finalBps)} (mis)`,
      `file fin ${fmt(s.goodput.file.finalBps)} · sess ${fmt(s.goodput.file.sessionBps)} (mis) · barra = stima`,
    );
  }
  lines.push(
    `worker ${s.busyWorkers}/${s.workerCount}` +
      (s.heapMiB != null ? ` · heap ${s.heapMiB.toFixed(0)} MiB` : "") +
      (s.sharpness != null ? ` · sharp ${s.sharpness.toFixed(0)}` : ""),
  );
  if (s.quality) {
    const ppm = s.ppm != null ? s.ppm.toFixed(2) : "n/d";
    lines.push(
      `lum ${s.quality.brightness.toFixed(0)} · con ${s.quality.contrast.toFixed(0)} · sat ${(s.quality.saturated * 100).toFixed(1)}% · span ${num(s.symbolPx)} px · ppm ${ppm} (mis)`,
    );
  }
  if (s.grabs.frames > 0 && s.grabs.last) {
    const mean = s.grabs.pixels / s.grabs.frames;
    lines.push(
      `grab ${s.grabs.last.full ? "full" : "crop"} ×${s.grabs.last.jobs} · media ${(mean / 1e6).toFixed(2)} Mpx · full ${s.grabs.fullFrames}/${s.grabs.frames}`,
    );
  }
  if (s.exposure && (s.exposure.intent !== "off" || s.exposure.mode || s.exposure.timeS != null)) {
    const time = s.exposure.timeS != null ? ` ${(s.exposure.timeS * 1000).toFixed(1)} ms` : "";
    const mark =
      s.exposure.intent === "off"
        ? ""
        : s.exposure.detected
          ? " · rilevata"
          : s.exposure.fallback
            ? " · fallback"
            : s.exposure.accepted
              ? " · non confermata"
              : " · non accettata";
    lines.push(`exp ${s.exposure.intent} · ${s.exposure.mode ?? "n/d"}${time}${mark}`);
  }
  if (s.tx) {
    const div = s.tx.integerDivisor == null ? "rAF n/d" : s.tx.integerDivisor ? "divisore rAF sì" : "divisore rAF no";
    lines.push(
      `tx ${s.tx.configuredFps} fps · rAF ${s.tx.rafHz ?? "–"} Hz · pannello n/d · ${div} · gap ${s.tx.medianGapMs ?? "–"} ms · late ${s.tx.late} · hold ${s.tx.starved} · skip ${s.tx.skipped}`,
    );
  }
  if (profile === "link") {
    const n = s.net;
    const decode = wasmStats(s.samples);
    lines.push(
      `RX app ${n?.appRxBps != null ? fmt(n.appRxBps) : "n/d"} · TX app ${n?.appTxBps != null ? fmt(n.appTxBps) : "n/d"} (der)`,
      `goodput ↓ ${formatTotal(n?.appRxBytes)} · ↑ ${formatTotal(n?.appTxBytes)} cumulati (mis)`,
      `capacità ${n ? fmt(n.capacityBps) : "n/d"} (teo) · frame ${n ? n.shownPerSec.toFixed(1) : "n/d"}/s (mis)`,
      `SRTT ${num(n?.srttMs ?? null)} ms (mis) · RTT campione n/d · jitter simboli ${num(s.jitterMs, 0)} ms (mis)`,
      `ARQ ritx ${num(n?.retransmits ?? null)} · dup ${num(n?.duplicates ?? null)} · in volo ${num(n?.outstanding ?? null)} · flussi ${num(n?.streams ?? null)} (mis)`,
      `ACK ${formatTotal(n?.bytesAcked)} cumulati (mis) · decode ${num(decode.last, 0)} ms ultimo · ${num(decode.mean, 0)} ms medio (mis)`,
    );
  } else if (s.arqRttMs != null) {
    lines.push(
      `ARQ RTT ${s.arqRttMs.toFixed(0)} ms` +
        (s.txWaitMs != null ? ` · txWait ${s.txWaitMs.toFixed(0)}` : "") +
        (s.rxWaitMs != null ? ` · rxWait ${s.rxWaitMs.toFixed(0)}` : "") +
        (s.jitterMs != null ? ` · jitter ${s.jitterMs.toFixed(0)}` : ""),
    );
  }
  return lines;
}

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

export function renderOptHud(host: HTMLElement | null, unit: "kB" | "bit" = "kB", profile: HudProfile = "file"): void {
  if (!getOptFlags().perf) return;
  const panel = ensureOptHud(host);
  const body = panel?.querySelector("[data-opt-body]");
  if (!body) return;
  body.textContent = hudLines(optTrace.snapshot(), unit, profile).join("\n");
}

export function removeOptHud(host: HTMLElement | null): void {
  host?.querySelector("[data-opt-hud]")?.remove();
}
