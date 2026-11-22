// The part of node:crypto that src/server/auth.ts uses, for the device build.
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`The ${algorithm} hash is not available on this device.`);
  const hash = sha256.create();
  const api = {
    update(data: string) { hash.update(new TextEncoder().encode(data)); return api; },
    digest(encoding: 'hex') { return Buffer.from(hash.digest()).toString(encoding); },
  };
  return api;
}

export const randomBytes = (size: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(size)));

/** Node's default cost parameters (N = 16384, r = 8, p = 1), so hashes match the server's. */
export function scrypt(password: string, salt: Uint8Array, keylen: number, callback: (err: Error | null, key?: Buffer) => void) {
  scryptAsync(password, salt, { N: 16384, r: 8, p: 1, dkLen: keylen }).then((key) => callback(null, Buffer.from(key)), (err: Error) => callback(err));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
