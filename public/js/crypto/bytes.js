/** Utility byte / base64 condivise dai moduli crypto. */

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    const b = p instanceof Uint8Array ? p : new Uint8Array(p);
    out.set(b, off);
    off += b.length;
  }
  return out;
}

export async function sha256Bytes(data) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const hash = await sha256Bytes(bytes);
  return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
}
