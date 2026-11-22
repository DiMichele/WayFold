import assert from "node:assert/strict";
import test from "node:test";
import { fileMime } from "../shared/envelope.ts";
import { isReadFailure, readBlobBytes } from "../shared/read-blob.ts";

function notReadable() {
  const error = new Error("The I/O read operation failed.");
  error.name = "NotReadableError";
  return error;
}

test("readBlobBytes returns the blob bytes", async () => {
  const payload = new Uint8Array([1, 2, 3, 9, 8, 7]);
  assert.deepEqual(await readBlobBytes(new Blob([payload])), payload);
  assert.equal((await readBlobBytes(new Blob([]))).length, 0);
});

test("a failed whole-file read falls back to slices", async () => {
  const size = 256 * 1024 + 17;
  const payload = new Uint8Array(size);
  for (let i = 0; i < size; i++) payload[i] = i & 0xff;
  const blob = new Blob([payload]);
  blob.arrayBuffer = () => Promise.reject(notReadable());

  const previous = globalThis.FileReader;
  class FailingReader {
    readAsArrayBuffer() {
      this.error = notReadable();
      queueMicrotask(() => this.onerror?.());
    }
  }
  globalThis.FileReader = FailingReader;
  try {
    assert.deepEqual(await readBlobBytes(blob), payload);
  } finally {
    if (previous) globalThis.FileReader = previous;
    else delete globalThis.FileReader;
  }
});

test("isReadFailure recognizes the iOS message", () => {
  assert.equal(isReadFailure(notReadable()), true);
  assert.equal(isReadFailure(new Error("nope")), false);
});

test("empty photo type is inferred from the filename", () => {
  assert.equal(fileMime("72E00D1A-2A33-4838-AE97-9A00B65CCFB0.jpeg", ""), "image/jpeg");
  assert.equal(fileMime("notes.txt", "text/plain"), "text/plain");
});
