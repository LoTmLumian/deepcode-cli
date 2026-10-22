import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runConfigCommand } from "../config-command";
import { decryptSecret, getSecretKeyPath } from "@vegamo/deepcode-core";

/**
 * Point os.homedir() at a throwaway directory so config writes never touch the
 * real ~/.deepcode. os.homedir() resolves USERPROFILE lazily on Windows.
 */
function withFakeHome(fn: (home: string) => Promise<void>): Promise<void> {
  const original = process.env.USERPROFILE;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-config-home-"));
  process.env.USERPROFILE = home;
  return fn(home).finally(() => {
    if (original === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = original;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
}

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return fn()
    .finally(() => {
      process.stdout.write = original;
    })
    .then((code) => ({ code, out: chunks.join("") }));
}

// ── runConfigCommand: unknown action ───────────────────────────────────────────

test("runConfigCommand returns 1 for an unknown action", async () => {
  const code = await runConfigCommand("bogus" as never);
  assert.equal(code, 1);
});

// ── runConfigCommand encrypt: --value ──────────────────────────────────────────

test("runConfigCommand encrypt writes an encrypted API_KEY to settings.json", async () => {
  await withFakeHome(async (home) => {
    const { code, out } = await captureStdout(() => runConfigCommand("encrypt", "sk-my-secret"));
    assert.equal(code, 0);
    assert.match(out, /encrypted/);

    const settingsPath = path.join(home, ".deepcode", "settings.json");
    assert.ok(fs.existsSync(settingsPath));
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const stored = settings.env.API_KEY as string;
    assert.ok(stored.startsWith("enc:"), "stored value must be ciphertext");
    assert.ok(!stored.includes("sk-my-secret"), "plaintext must not appear in settings");
    // Decrypting with the generated secret key recovers the original value.
    assert.equal(decryptSecret(stored, getSecretKeyPath()), "sk-my-secret");
  });
});

test("runConfigCommand encrypt preserves existing settings fields", async () => {
  await withFakeHome(async (home) => {
    const settingsPath = path.join(home, ".deepcode", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ env: { MODEL: "deepseek-v4-pro" } }));

    await runConfigCommand("encrypt", "sk-keep-model");

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(settings.env.MODEL, "deepseek-v4-pro");
    assert.ok(settings.env.API_KEY.startsWith("enc:"));
  });
});

test("runConfigCommand encrypt rejects an empty value", async () => {
  const code = await runConfigCommand("encrypt", "   ");
  assert.equal(code, 1);
});

test("runConfigCommand encrypt returns 1 when --value is not a string", async () => {
  const code = await runConfigCommand("encrypt", true as never);
  assert.equal(code, 1);
});
