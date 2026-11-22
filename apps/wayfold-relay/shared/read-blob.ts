/**
 * iOS Safari throws NotReadableError ("The I/O read operation failed.") when
 * `Blob.arrayBuffer()` reads a photo picked from a local HTML file. The read
 * has to start inside the change/drop turn, and files around 1–2 MiB only come
 * back if they are read in slices.
 */

const CHUNK = 256 * 1024;
const cache = new WeakMap<Blob, Promise<Uint8Array>>();

function readError(): Error {
  const error = new Error("The I/O read operation failed.");
  error.name = "NotReadableError";
  return error;
}

export function isReadFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "NotReadableError" || name === "NotFoundError" || /I\/O read operation failed/i.test(message);
}

function isIos(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;
  const ua = nav.userAgent || "";
  if (/iP(hone|ad|od)/.test(ua)) return true;
  return nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function viaFileReader(blob: Blob): Promise<Uint8Array> | null {
  if (typeof FileReader === "undefined") return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer) || (blob.size > 0 && result.byteLength !== blob.size)) {
        reject(readError());
        return;
      }
      resolve(new Uint8Array(result));
    };
    reader.onerror = () => reject(reader.error ?? readError());
    try {
      reader.readAsArrayBuffer(blob);
    } catch (error) {
      reject(error);
    }
  });
}

function viaArrayBuffer(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => {
    if (blob.size > 0 && buffer.byteLength !== blob.size) throw readError();
    return new Uint8Array(buffer);
  });
}

function methods(): Array<(blob: Blob) => Promise<Uint8Array> | null> {
  return isIos() ? [viaFileReader, viaArrayBuffer] : [viaArrayBuffer, viaFileReader];
}

/** First attempt is started before this function awaits, so the caller can stay in the input event. */
async function readSlice(slice: Blob): Promise<Uint8Array> {
  let last: unknown = readError();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await delay(120 * attempt);
    for (const method of methods()) {
      const pending = method(slice);
      if (!pending) continue;
      try {
        return await pending;
      } catch (error) {
        last = error;
        if (!isReadFailure(error)) throw error;
      }
    }
  }
  throw last instanceof Error ? last : readError();
}

function viaChunks(blob: Blob): Promise<Uint8Array> {
  const out = new Uint8Array(blob.size);
  const firstEnd = Math.min(CHUNK, blob.size);
  const first = readSlice(blob.slice(0, firstEnd));
  return (async () => {
    out.set(await first, 0);
    for (let offset = firstEnd; offset < blob.size; offset += CHUNK) {
      const end = Math.min(offset + CHUNK, blob.size);
      out.set(await readSlice(blob.slice(offset, end)), offset);
    }
    return out;
  })();
}

async function viaObjectUrl(blob: Blob): Promise<Uint8Array> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw readError();
  const url = URL.createObjectURL(blob);
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    if (blob.size > 0 && buffer.byteLength !== blob.size) throw readError();
    return new Uint8Array(buffer);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readFresh(blob: Blob): Promise<Uint8Array> {
  if (blob.size === 0) return Promise.resolve(new Uint8Array());
  // On iPhone, start a sliced FileReader immediately. A single arrayBuffer()
  // of the photo is what throws on WayFold Transfer.html.
  const primary = isIos() ? viaChunks(blob) : viaArrayBuffer(blob);
  return primary.catch(async (error: unknown) => {
    if (!isReadFailure(error)) throw error;
    const steps: Array<() => Promise<Uint8Array> | null> = isIos()
      ? [() => viaArrayBuffer(blob), () => viaFileReader(blob), () => viaObjectUrl(blob)]
      : [() => viaFileReader(blob), () => viaChunks(blob), () => viaObjectUrl(blob)];
    let last: unknown = error;
    for (const step of steps) {
      const pending = step();
      if (!pending) continue;
      try {
        return await pending;
      } catch (err) {
        last = err;
      }
    }
    // The photo library often finishes exporting the JPEG a moment later.
    await delay(400);
    try {
      return await (isIos() ? viaChunks(blob) : viaArrayBuffer(blob));
    } catch (err) {
      throw err instanceof Error ? err : last instanceof Error ? last : readError();
    }
  });
}

/** Call synchronously from the file input's change/drop handler. */
export function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  const hit = cache.get(blob);
  if (hit) return hit;
  const promise = readFresh(blob);
  cache.set(blob, promise);
  promise.catch(() => {
    if (cache.get(blob) === promise) cache.delete(blob);
  });
  return promise;
}
