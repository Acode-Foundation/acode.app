import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, hexToBytes, utf8ToBytes, managedNonce } from '@noble/ciphers/utils.js';

const KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY;
if (!KEY_HEX || hexToBytes(KEY_HEX).length !== 32) {
  throw new Error('TOKEN_ENCRYPTION_KEY must be set to 64 hex chars (32 bytes)');
}
const KEY = hexToBytes(KEY_HEX);

export function encryptToken(plaintext) {
  try {
    const nonce = managedNonce(); // 24 bytes
    const msgBytes = utf8ToBytes(plaintext);
    const cipher = xchacha20poly1305(KEY, nonce);
    const ciphertext = cipher.encrypt(msgBytes);
    return {
      ciphertext: bytesToHex(ciphertext),
      nonce: bytesToHex(nonce)
    };
  } catch (e) {
    throw new Error('Token encryption failed');
  }
}

export function decryptToken({ ciphertext, nonce }) {
  try {
    const ct = hexToBytes(ciphertext);
    const n = hexToBytes(nonce);
    const cipher = xchacha20poly1305(KEY, n);
    const plaintext = cipher.decrypt(ct);
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    throw new Error('Token decryption failed');
  }
}
