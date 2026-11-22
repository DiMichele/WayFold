import assert from "node:assert/strict";
import test from "node:test";
import { sha256Bytes } from "../shared/sha256.ts";

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("sha256 matches the known vectors and crypto.subtle", async () => {
  assert.equal(hex(sha256Bytes(new Uint8Array())), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(
    hex(sha256Bytes(new TextEncoder().encode("abc"))),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );

  const longer = new Uint8Array(300_000);
  for (let i = 0; i < longer.length; i++) longer[i] = i & 0xff;
  const subtle = new Uint8Array(await crypto.subtle.digest("SHA-256", longer));
  assert.deepEqual(sha256Bytes(longer), subtle);

  const view = longer.subarray(10, 70_000);
  const subtleView = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(view)));
  assert.deepEqual(sha256Bytes(view), subtleView);
});
