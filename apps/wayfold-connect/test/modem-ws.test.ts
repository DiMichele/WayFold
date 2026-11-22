import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import type { Peer } from "../src/peer.ts";
import { startServer } from "../src/server.ts";

function fakePeer(): Peer {
  return {
    framesIn: 0,
    log: [],
    status: () => ({ role: "gateway", name: "gw", state: "offering", pending: null, client: null, session: null }),
    onFrame: () => undefined,
    nextFrame: () => null,
  } as unknown as Peer;
}

function nextMessage(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const msg = JSON.parse(String(data));
      if (msg.t !== type) return;
      ws.off("message", onMessage);
      resolve(msg);
    };
    ws.on("message", onMessage);
  });
}

test("the modem page can run the panel actions over its WebSocket", async () => {
  const port = 17_000 + Math.floor(Math.random() * 2000);
  const calls: string[] = [];
  const server = await startServer({
    peer: fakePeer(),
    port,
    relayDist: null,
    modemOrigins: ["https://transfer.wayfold.xyz"],
    extraStatus: () => ({}),
    onAction: (action) => {
      calls.push(action);
      return action === "authorize";
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/modem-ws`, { origin: "https://transfer.wayfold.xyz" });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  ws.send(JSON.stringify({ t: "action", action: "authorize" }));
  assert.deepEqual(await nextMessage(ws, "action"), { t: "action", action: "authorize", ok: true });

  ws.send(JSON.stringify({ t: "action", action: "reject" }));
  assert.deepEqual(await nextMessage(ws, "action"), { t: "action", action: "reject", ok: false });

  ws.send(JSON.stringify({ t: "action", action: "shutdown" }));
  ws.send(JSON.stringify({ t: "action", action: "disconnect" }));
  await nextMessage(ws, "action");
  assert.deepEqual(calls, ["authorize", "reject", "disconnect"], "unknown actions never reach the helper");

  ws.close();
  server.close();
});
