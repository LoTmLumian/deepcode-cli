// `deepcode config` subcommand handling.

import * as fs from "fs";
import {
  encryptSecret,
  getSecretKeyPath,
  readSettings,
  writeSettings,
  type DeepcodingSettings,
} from "@vegamo/deepcode-core";
import { writeStdoutLine, writeStderrLine } from "./utils/stdio-helpers";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Run `deepcode config encrypt`. Reads the plaintext API_KEY either from the
 * --value flag or from stdin, encrypts it, and writes the ciphertext into the
 * user-level settings.json under env.API_KEY.
 */
export async function runConfigEncrypt(value?: unknown): Promise<number> {
  let plaintext = typeof value === "string" ? value : undefined;
  if (value !== undefined && plaintext === undefined) {
    // A value was supplied but it is not a string (e.g. boolean from a flag
    // alias collision). Fail fast instead of silently reading stdin.
    writeStderrLine("Invalid value. Provide the API key as a string via --value or stdin.");
    return 1;
  }
  if (plaintext === undefined) {
    if (process.stdin.isTTY) {
      writeStderrLine(
        "No value provided. Pipe the API key into stdin, e.g.:\n  echo 'sk-...' | deepcode config encrypt\nor pass it inline:\n  deepcode config encrypt --value 'sk-...'"
      );
      return 1;
    }
    plaintext = (await readStdin()).trim();
  }
  plaintext = plaintext.trim();
  if (!plaintext) {
    writeStderrLine("Empty value. Provide a non-empty API key to encrypt.");
    return 1;
  }

  const encrypted = encryptSecret(plaintext);
  if (encrypted === null) {
    writeStderrLine(`Failed to encrypt. Could not create/read the secret file at ${getSecretKeyPath()}.`);
    return 1;
  }

  // Merge into existing user settings (preserve other fields).
  const existing = readSettings() ?? ({} as DeepcodingSettings);
  const env = { ...(existing.env ?? {}) };
  env.API_KEY = encrypted;
  existing.env = env;
  writeSettings(existing);

  writeStdoutLine("API_KEY encrypted and written to ~/.deepcode/settings.json");
  writeStdoutLine(`Secret file: ${getSecretKeyPath()} (keep it safe; losing it loses the key)`);
  return 0;
}

/**
 * Dispatch the `config` subcommand. Returns the process exit code.
 */
export async function runConfigCommand(action: string | undefined, value?: string): Promise<number> {
  if (action === "encrypt") {
    return runConfigEncrypt(value);
  }
  writeStderrLine(`Unknown config action: "${action}". Supported actions: encrypt`);
  return 1;
}
