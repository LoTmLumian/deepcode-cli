import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ENCRYPTED_PREFIX,
  decryptSecret,
  encryptSecret,
  isEncryptedValue,
  loadOrCreateSecretKey,
} from "../common/key-cipher";
import { resolveSettingsSources } from "../settings";

function makeTempKeyPath(): { dir: string; keyPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-keycipher-"));
  return { dir, keyPath: path.join(dir, ".secret") };
}

// ── isEncryptedValue ──────────────────────────────────────────────────────────

test("isEncryptedValue detects the enc: prefix", () => {
  assert.equal(isEncryptedValue("enc:abc"), true);
  assert.equal(isEncryptedValue("sk-123"), false);
  assert.equal(isEncryptedValue(""), false);
  assert.equal(isEncryptedValue("ENC:abc"), false); // prefix is case-sensitive
});

// ── loadOrCreateSecretKey ─────────────────────────────────────────────────────

test("loadOrCreateSecretKey creates a 32-byte key file on first use", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const key = loadOrCreateSecretKey(keyPath);
    assert.ok(key);
    assert.equal(key.length, 32);
    assert.ok(fs.existsSync(keyPath));
    assert.equal(fs.readFileSync(keyPath).length, 32);

    // Loading again returns the same persisted key.
    const again = loadOrCreateSecretKey(keyPath);
    assert.ok(again);
    assert.ok(again.equals(key));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadOrCreateSecretKey returns null for a corrupt (wrong-size) key file", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    fs.writeFileSync(keyPath, Buffer.alloc(16, 7));
    assert.equal(loadOrCreateSecretKey(keyPath), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── encryptSecret / decryptSecret round-trip ──────────────────────────────────

test("encryptSecret then decryptSecret round-trips the plaintext", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const plaintext = "sk-test-secret-12345";
    const encrypted = encryptSecret(plaintext, keyPath);
    assert.ok(encrypted);
    assert.ok(encrypted.startsWith(ENCRYPTED_PREFIX));
    assert.ok(!encrypted.includes(plaintext)); // plaintext must not appear
    assert.equal(decryptSecret(encrypted, keyPath), plaintext);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("encryptSecret produces different ciphertext for the same plaintext (random IV)", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const a = encryptSecret("same-secret", keyPath);
    const b = encryptSecret("same-secret", keyPath);
    assert.ok(a && b);
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a, keyPath), "same-secret");
    assert.equal(decryptSecret(b, keyPath), "same-secret");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("decryptSecret returns null when the key file is missing", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const encrypted = encryptSecret("sk-abc", keyPath);
    assert.ok(encrypted);
    // Drop the key file — decryption must fail closed.
    fs.rmSync(keyPath);
    assert.equal(decryptSecret(encrypted, keyPath), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("decryptSecret returns null for a tampered ciphertext (GCM auth)", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const encrypted = encryptSecret("sk-abc", keyPath);
    assert.ok(encrypted);
    // Flip a byte in the middle of the base64 payload (away from any trailing
    // "=" padding) so the decoded bytes actually change.
    const payloadStart = ENCRYPTED_PREFIX.length;
    const mid = payloadStart + Math.floor((encrypted.length - payloadStart) / 2);
    const flipped = encrypted[mid] === "A" ? "B" : "A";
    const tampered = encrypted.slice(0, mid) + flipped + encrypted.slice(mid + 1);
    assert.equal(decryptSecret(tampered, keyPath), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("decryptSecret returns null for a malformed (non-base64) value", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const key = loadOrCreateSecretKey(keyPath);
    assert.ok(key);
    assert.equal(decryptSecret("enc:!!!not-base64!!!", keyPath), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("decryptSecret fails to decrypt a value encrypted with a different key", () => {
  const { dir, keyPath } = makeTempKeyPath();
  const { dir: dir2, keyPath: keyPath2 } = makeTempKeyPath();
  try {
    const encrypted = encryptSecret("sk-abc", keyPath);
    assert.ok(encrypted);
    // A fresh key path (different key) must not decrypt it.
    assert.equal(decryptSecret(encrypted, keyPath2), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

// ── settings integration: automatic decryption ────────────────────────────────

test("resolveSettingsSources decrypts an enc: API_KEY automatically", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const plaintext = "sk-integration-secret";
    const encrypted = encryptSecret(plaintext, keyPath);
    assert.ok(encrypted);

    const resolved = resolveSettingsSources(
      { env: { API_KEY: encrypted, MODEL: "deepseek-v4-pro" } },
      null,
      { model: "default-model", baseURL: "https://default.example.com" },
      {},
      keyPath
    );
    assert.equal(resolved.apiKey, plaintext);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveSettingsSources leaves a plain API_KEY untouched", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    const resolved = resolveSettingsSources(
      { env: { API_KEY: "sk-plain", MODEL: "deepseek-v4-pro" } },
      null,
      { model: "default-model", baseURL: "https://default.example.com" },
      {},
      keyPath
    );
    assert.equal(resolved.apiKey, "sk-plain");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveSettingsSources throws when an enc: API_KEY cannot be decrypted", () => {
  const { dir, keyPath } = makeTempKeyPath();
  try {
    assert.throws(
      () =>
        resolveSettingsSources(
          { env: { API_KEY: "enc:not-a-real-ciphertext" } },
          null,
          { model: "default-model", baseURL: "https://default.example.com" },
          {},
          keyPath
        ),
      /Failed to decrypt API_KEY/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
