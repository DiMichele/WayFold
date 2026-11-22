import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { GCM_TAG_LEN } from "./wire.ts";

/** Same bytes in Node and in the browser, so a helper and a web page can share one link. */

export interface KeyPair {
  privateKey: Uint8Array;
  pub: Uint8Array;
}

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function newKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, pub: x25519.getPublicKey(privateKey) };
}

export interface LinkKeys {
  /** gateway -> client */
  down: Uint8Array;
  /** client -> gateway */
  up: Uint8Array;
}

/** Both sides call this with their own private key and the peer's public key. */
export function deriveKeys(own: KeyPair, peerPub: Uint8Array, gatewayPub: Uint8Array, clientPub: Uint8Array, linkId: number): LinkKeys {
  const shared = x25519.getSharedSecret(own.privateKey, peerPub);
  const info = concat(enc.encode("wayfold-connect/wfl1"), gatewayPub, clientPub);
  const okm = hkdf(sha256, shared, u32(linkId), info, 64);
  return { down: okm.slice(0, 32), up: okm.slice(32, 64) };
}

export function hash8(pub: Uint8Array): Uint8Array {
  return sha256(pub).slice(0, 8);
}

export function fingerprint(pub: Uint8Array): string {
  return hex(hash8(pub)).toUpperCase().match(/.{4}/g)!.join("-");
}

/** Short code both screens show; the gateway operator compares it before authorizing. */
export function sas(gatewayPub: Uint8Array, clientPub: Uint8Array, linkId: number): string {
  const d = sha256(concat(enc.encode("wfl1-sas"), gatewayPub, clientPub, u32(linkId)));
  const n = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

function nonce(dir: number, seq: number): Uint8Array {
  const n = new Uint8Array(12);
  n[0] = dir;
  new DataView(n.buffer).setUint32(8, seq >>> 0);
  return n;
}

export function seal(key: Uint8Array, dir: number, seq: number, aad: Uint8Array, plain: Uint8Array): Uint8Array {
  return gcm(key, nonce(dir, seq), aad).encrypt(plain);
}

export function open(key: Uint8Array, dir: number, seq: number, aad: Uint8Array, sealed: Uint8Array): Uint8Array | null {
  if (sealed.length < GCM_TAG_LEN) return null;
  try {
    return gcm(key, nonce(dir, seq), aad).decrypt(sealed);
  } catch {
    return null;
  }
}

export function randomU32(): number {
  const b = randomBytes(4);
  return new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
}
