import type { Peer } from "../src/peer.ts";

export class FakeClock {
  t = 1000;
  readonly now = () => this.t;
}

export interface LinkSim {
  fps: number;
  grid: number;
  mtu: number;
  /** Probability a displayed QR is never decoded. */
  loss: number;
  /** Probability a decoded QR is decoded again from the next camera frame. */
  dup?: number;
  delayMs: number;
  /** Optional blackout window (camera covered), in sim ms. */
  blackout?: { from: number; to: number };
}

interface Delivery {
  at: number;
  to: Peer;
  bytes: Uint8Array;
}

/** Deterministic PRNG so failing runs reproduce. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Drives two peers over a simulated optical link on a fake clock until `until`
 * returns true or `maxMs` elapses. Returns the simulated time spent.
 */
export function runLink(
  a: Peer,
  b: Peer,
  clock: FakeClock,
  sim: LinkSim,
  maxMs: number,
  until: () => boolean = () => false,
  seed = 1,
): number {
  const rand = rng(seed);
  const queue: Delivery[] = [];
  const step = 1000 / sim.fps;
  const start = clock.t;
  let nextTick = clock.t;
  while (clock.t - start < maxMs) {
    if (clock.t >= nextTick) {
      nextTick += step;
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        for (let i = 0; i < sim.grid; i++) {
          const f = from.nextFrame(sim.mtu);
          if (!f) continue;
          const rel = clock.t - start;
          if (sim.blackout && rel >= sim.blackout.from && rel < sim.blackout.to) continue;
          if (rand() < sim.loss) continue;
          const jitter = rand() * step;
          queue.push({ at: clock.t + sim.delayMs + jitter, to, bytes: f });
          if (rand() < (sim.dup ?? 0.3)) queue.push({ at: clock.t + sim.delayMs + jitter + 33, to, bytes: f });
        }
      }
    }
    queue.sort((x, y) => x.at - y.at);
    while (queue.length && queue[0]!.at <= clock.t) {
      const d = queue.shift()!;
      d.to.onFrame(d.bytes);
    }
    a.tick();
    b.tick();
    if (until()) break;
    clock.t += 5;
  }
  return clock.t - start;
}
