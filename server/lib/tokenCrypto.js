import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, hexToBytes, utf8ToBytes, managedNonce } from '@noble/ciphers/utils.js';
import { subtle } from 'node:crypto'
import { TextEncoder } from 'node:util';
const KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY;
if (!KEY_HEX || hexToBytes(KEY_HEX).length !== 32) {
  throw new Error('TOKEN_ENCRYPTION_KEY must be set to 64 hex chars (32 bytes)');
}

export async function encryptToken(plaintext) {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(KEY_HEX);
    const KEY = await subtle.digest('SHA-256', data);
    const cipher = managedNonce(xchacha20poly1305)(new Uint8Array(KEY)); // 24 bytes
    const msgBytes = utf8ToBytes(plaintext);
    const ciphertext = cipher.encrypt(msgBytes);

    return bytesToHex(ciphertext)
  } catch (e) {
    console.error('Token encryption failed', e);
    throw new Error('Token encryption failed');
  }
}

export async function decryptToken(ciphertext) {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(KEY_HEX);
    const KEY = await subtle.digest('SHA-256', data);
    const ct = hexToBytes(ciphertext);
    const cipher = managedNonce(xchacha20poly1305)(new Uint8Array(KEY));
    const plaintext = cipher.decrypt(ct);
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    console.error('Token decryption failed', e);
    throw new Error('Token decryption failed');
  }
}
