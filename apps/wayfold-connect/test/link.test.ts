import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { ArqReceiver, ArqSender } from "../src/arq.ts";
import { deriveKeys, newKeyPair, open, sas, seal } from "../src/crypto.ts";
import { Mux, type MuxEvents } from "../src/mux.ts";
import { ClientPeer, GatewayPeer, type StreamHost } from "../src/peer.ts";
import { checkHost, DEFAULT_POLICY, isPrivateAddress, parseList } from "../src/policy.ts";
import {
  DIR_UP,
  KIND_SEALED,
  NO_ECHO,
  packSealedPlain,
  packWire,
  parseSealedPlain,
  parseWire,
} from "../src/wire.ts";
import { FakeClock, rng, runLink } from "./harness.ts";

test("wire frame round trip, padded to MTU", () => {
  const body = Uint8Array.from([1, 2, 3, 4]);
  const f = packWire({ kind: KIND_SEALED, dir: DIR_UP, linkId: 0xdeadbeef, seq: 7 }, body, 300);
  assert.equal(f.length, 300);
  const p = parseWire(f)!;
  assert.deepEqual(p.header, { kind: KIND_SEALED, dir: DIR_UP, linkId: 0xdeadbeef, seq: 7 });
  assert.deepEqual([...p.body], [1, 2, 3, 4]);
  assert.equal(parseWire(Uint8Array.from([0x44, 0x0c, 0, 0])), null);

  const plain = packSealedPlain({ nextExpected: 5, sackLo: 3, sackHi: 1 << 31, echoSeq: NO_ECHO, segNo: -1, segData: new Uint8Array(0) });
  const back = parseSealedPlain(plain)!;
  assert.equal(back.segNo, -1);
  assert.equal(back.sackHi >>> 0, 0x80000000);
});

test("both sides derive the same keys and the same verification code", () => {
  const gw = newKeyPair();
  const cl = newKeyPair();
  const a = deriveKeys(gw, cl.pub, gw.pub, cl.pub, 42);
  const b = deriveKeys(cl, gw.pub, gw.pub, cl.pub, 42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.up, a.down);
  assert.equal(sas(gw.pub, cl.pub, 42).length, 6);
  const aad = Uint8Array.of(9, 9);
  const ct = seal(a.up, 1, 3, aad, Uint8Array.of(1, 2, 3));
  assert.deepEqual([...open(b.up, 1, 3, aad, ct)!], [1, 2, 3]);
  assert.equal(open(b.up, 1, 4, aad, ct), null);
  ct[0]! ^= 1;
  assert.equal(open(b.up, 1, 3, aad, ct), null);
});

test("ARQ delivers every segment in order across 30% loss", () => {
  const data = randomBytes(200_000);
  let off = 0;
  const sender = new ArqSender((max) => {
    if (off >= data.length) return null;
    const out = data.subarray(off, off + max);
    off += out.length;
    return new Uint8Array(out);
  });
  const receiver = new ArqReceiver();
  const got: Uint8Array[] = [];
  const rand = rng(7);
  let now = 0;
  for (let tick = 0; tick < 20_000 && Buffer.concat(got).length < data.length; tick++) {
    now += 40;
    const seg = sender.pick(1000, now);
    if (seg && rand() > 0.3) got.push(...receiver.onSegment(seg.no, seg.data));
    if (rand() > 0.3) {
      const s = receiver.sack();
      sender.onAck(receiver.nextExpected, s.lo, s.hi);
    }
  }
  assert.ok(Buffer.concat(got).equals(data));
});

test("mux records survive arbitrary segment boundaries", () => {
  const tx = new Mux();
  const rx = new Mux();
  const seen: string[] = [];
  let body = Buffer.alloc(0);
  rx.events = {
    open: (id, host, port) => seen.push(`open ${id} ${host}:${port}`),
    data: (_id, b) => (body = Buffer.concat([body, b])),
    end: (id) => seen.push(`end ${id}`),
  } satisfies MuxEvents;
  const payload = randomBytes(20_000);
  tx.open(3, "example.org", 443);
  tx.send(3, payload);
  tx.end(3);
  for (let chunk = tx.pull(37); chunk; chunk = tx.pull(37 + (chunk.length % 300))) rx.feed(chunk);
  assert.deepEqual(seen, ["open 3 example.org:443", "end 3"]);
  assert.ok(body.equals(payload));
});

test("policy: suffix lists, ports, private targets", () => {
  const p = { ...DEFAULT_POLICY, allow: parseList("*.wikipedia.org, example.com"), deny: parseList("ads.example.com") };
  assert.ok(checkHost(p, "it.wikipedia.org", 443).ok);
  assert.ok(checkHost(p, "example.com", 80).ok);
  assert.equal(checkHost(p, "ads.example.com", 443).ok, false);
  assert.equal(checkHost(p, "evil.com", 443).ok, false);
  assert.equal(checkHost(p, "example.com", 22).ok, false);
  const open = { ...DEFAULT_POLICY };
  assert.equal(checkHost(open, "192.168.1.1", 443).ok, false);
  assert.equal(checkHost(open, "localhost", 80).ok, false);
  assert.ok(isPrivateAddress("::1") && isPrivateAddress("10.2.3.4") && isPrivateAddress("::ffff:127.0.0.1"));
  assert.ok(!isPrivateAddress("93.184.216.34") && !isPrivateAddress("2606:4700::1111"));
});

// --- end to end over the simulated optical link ---

class MemHost implements StreamHost {
  mux: Mux | null = null;
  open = new Set<number>();
  events: MuxEvents = {};
  ended = 0;
  lost = 0;
  sessionStart(mux: Mux) {
    this.mux = mux;
  }
  sessionEnd() {
    this.mux = null;
    this.ended++;
  }
  linkLost() {
    this.lost++;
    this.open.clear();
  }
  openCount() {
    return this.open.size;
  }
}

function pair(clock: FakeClock) {
  const gwHost = new MemHost();
  const clHost = new MemHost();
  const gw = new GatewayPeer({ name: "gw", host: gwHost, now: clock.now });
  const cl = new ClientPeer({ name: "pc", host: clHost, now: clock.now });
  return { gw, cl, gwHost, clHost };
}

const SIM = { fps: 24, grid: 2, mtu: 900, loss: 0.15, delayMs: 120 };

test("pairing needs explicit authorization and both sides show the same code", () => {
  const clock = new FakeClock();
  const { gw, cl } = pair(clock);
  runLink(gw, cl, clock, SIM, 10_000, () => gw.pending !== null && cl.awaitingApproval);
  assert.ok(gw.pending, "gateway sees the request");
  assert.equal(cl.state, "requesting");
  assert.equal(gw.pending!.sas, cl.code);
  runLink(gw, cl, clock, SIM, 3000);
  assert.equal(cl.state, "requesting", "nothing happens without authorization");
  assert.ok(gw.authorize());
  runLink(gw, cl, clock, SIM, 10_000, () => cl.state === "connected");
  assert.equal(cl.state, "connected");
});

test("rejected client is told so and stops", () => {
  const clock = new FakeClock();
  const { gw, cl } = pair(clock);
  runLink(gw, cl, clock, SIM, 10_000, () => gw.pending !== null);
  assert.ok(gw.reject());
  runLink(gw, cl, clock, SIM, 10_000, () => cl.state === "rejected");
  assert.equal(cl.state, "rejected");
  assert.equal(gw.pending, null);
});

test("bidirectional stream transfer with loss, duplicates and a short blackout", () => {
  const clock = new FakeClock();
  const { gw, cl, gwHost, clHost } = pair(clock);
  const upload = randomBytes(60_000);
  const download = randomBytes(250_000);
  let gotUp = Buffer.alloc(0);
  let gotDown = Buffer.alloc(0);
  let downEnded = false;

  gwHost.events = {
    open: (id, host, port) => {
      assert.equal(`${host}:${port}`, "example.com:443");
      gwHost.open.add(id);
      gwHost.mux!.openOk(id);
      gwHost.mux!.send(id, download);
      gwHost.mux!.end(id);
    },
    data: (_id, b) => (gotUp = Buffer.concat([gotUp, b])),
  };
  clHost.events = {
    openOk: (id) => {
      clHost.mux!.send(id, upload);
    },
    data: (_id, b) => (gotDown = Buffer.concat([gotDown, b])),
    end: () => (downEnded = true),
  };

  runLink(gw, cl, clock, SIM, 10_000, () => gw.pending !== null);
  gw.authorize();
  runLink(gw, cl, clock, SIM, 10_000, () => cl.state === "connected");
  clHost.open.add(1);
  clHost.mux!.open(1, "example.com", 443);
  const spent = runLink(
    gw,
    cl,
    clock,
    { ...SIM, blackout: { from: 2000, to: 6000 } },
    120_000,
    () => downEnded && gotUp.length >= upload.length,
    3,
  );
  assert.ok(gotDown.equals(download), "download intact");
  assert.ok(gotUp.equals(upload), "upload intact");
  assert.equal(gwHost.lost + clHost.lost, 0, "4 s blackout must not drop streams");
  const kbs = (download.length + upload.length) / 1024 / (spent / 1000);
  assert.ok(kbs > 5, `throughput too low: ${kbs.toFixed(1)} KB/s`);
});

test("disconnect from the client closes both sides; reconnect needs a new authorization", () => {
  const clock = new FakeClock();
  const { gw, cl, gwHost } = pair(clock);
  runLink(gw, cl, clock, SIM, 10_000, () => gw.pending !== null);
  gw.authorize();
  runLink(gw, cl, clock, SIM, 10_000, () => cl.state === "connected");
  cl.disconnect();
  runLink(gw, cl, clock, SIM, 10_000, () => gw.state === "offering" && cl.state === "closed");
  assert.equal(gw.state, "offering");
  assert.equal(cl.state, "closed");
  assert.equal(gwHost.ended, 1);
  cl.reconnect();
  runLink(gw, cl, clock, SIM, 10_000, () => gw.pending !== null);
  assert.ok(gw.pending, "new request after reconnect");
  assert.equal(cl.state, "requesting");
});

test("idle timeout disconnects an unused session", () => {
  const clock = new FakeClock();
  const gwHost = new MemHost();
  const clHost = new MemHost();
  const gw = new GatewayPeer({ name: "gw", host: gwHost, now: clock.now, timers: { idleMs: 5000 } });
  const cl = new ClientPeer({ name: "pc", host: clHost, now: clock.now });
  runLink(gw, cl, clock, SIM, 10_000, () => gw.pending !== null);
  gw.authorize();
  runLink(gw, cl, clock, SIM, 10_000, () => cl.state === "connected");
  runLink(gw, cl, clock, SIM, 20_000, () => cl.state === "closed" && gw.state === "offering");
  assert.equal(cl.state, "closed");
  assert.equal(gw.state, "offering");
});
