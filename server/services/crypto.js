import crypto from 'node:crypto';
import { env } from '../config/env.js';

const SALT = 'flussonic-crm-v3';
const key = crypto.scryptSync(env.ENCRYPTION_KEY, SALT, 32);
const PREFIX = 'enc:v1:';

/** Encrypt a plaintext string. Returns "enc:v1:<iv>:<tag>:<ciphertext>" (all base64). */
export function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Decrypt a value produced by encrypt(). Returns '' if the value cannot be decrypted. */
export function decrypt(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // legacy plaintext
  try {
    const [, , ivB64, tagB64, ctB64] = value.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomPassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const buf = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) out += alphabet[buf[i] % alphabet.length];
  return out;
}

/** Timing-safe string comparison. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
