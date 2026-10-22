// Symmetric encryption for secrets stored in settings files.
//
// Design:
//   - AES-256-GCM (authenticated encryption, detects tampering).
//   - The master key lives in a dedicated file (~/.deepcode/.secret) alongside
//     settings.json, protected by OS file permissions (icacls on Windows,
//     chmod 600 on Unix). The key file never leaves the machine.
//   - Encrypted values are persisted as `enc:<base64( iv | authTag | ciphertext )>`
//     and are transparently decrypted when settings are resolved.

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

/** Prefix marking an encrypted value inside settings files. */
export const ENCRYPTED_PREFIX = "enc:";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // 256-bit
const IV_BYTES = 12; // GCM standard nonce size
const AUTH_TAG_BYTES = 16;

/** Where the master key file lives (same directory as user settings.json). */
export function getSecretKeyPath(): string {
  return path.join(os.homedir(), ".deepcode", ".secret");
}

/** Returns true when the value is an encrypted blob (enc:...). */
export function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Tighten file permissions so only the current user can read the file.
 *
 * - Windows: icacls grants explicit access to the current user and removes
 *   inherited permissions for Everyone / BUILTIN\Users.
 * - Unix: chmod 600 restricts to owner.
 */
function restrictFilePermissions(filePath: string): void {
  try {
    if (process.platform === "win32") {
      const user = process.env.USERNAME ?? os.userInfo().username;
      execFileSync("icacls", [filePath, "/inheritance:r", "/grant:r", `${user}:F`], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // Permission hardening is best-effort; encryption still protects the value.
  }
}

/**
 * Load the master key, generating and persisting a new random key on first use.
 * Returns null when the key file cannot be read or created.
 *
 * @param keyPath Override the key file location (used by tests). Defaults to
 *                the user-level secret file.
 */
export function loadOrCreateSecretKey(keyPath: string = getSecretKeyPath()): Buffer | null {
  try {
    if (fs.existsSync(keyPath)) {
      const key = fs.readFileSync(keyPath);
      if (key.length === KEY_BYTES) {
        return key;
      }
      return null; // Corrupt or wrong size — refuse to silently re-encrypt.
    }
    const dir = path.dirname(keyPath);
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.randomBytes(KEY_BYTES);
    fs.writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" });
    restrictFilePermissions(keyPath);
    return key;
  } catch {
    return null;
  }
}

/** Encrypt a plaintext secret; returns the `enc:`-prefixed string, or null on failure. */
export function encryptSecret(plaintext: string, keyPath: string = getSecretKeyPath()): string | null {
  const key = loadOrCreateSecretKey(keyPath);
  if (!key) {
    return null;
  }
  try {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return ENCRYPTED_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
  } catch {
    return null;
  }
}

/** Decrypt an `enc:`-prefixed value; returns the plaintext or null on failure. */
export function decryptSecret(encryptedValue: string, keyPath: string = getSecretKeyPath()): string | null {
  const key = loadOrCreateSecretKey(keyPath);
  if (!key) {
    return null;
  }
  try {
    const raw = Buffer.from(encryptedValue.slice(ENCRYPTED_PREFIX.length), "base64");
    const iv = raw.subarray(0, IV_BYTES);
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}
