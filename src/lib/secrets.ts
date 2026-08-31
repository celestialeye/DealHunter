import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function dataDirectory() {
  return process.env.DEALHUNTER_DATA_DIR
    ? path.resolve(process.env.DEALHUNTER_DATA_DIR)
    : path.join(process.cwd(), ".dealhunter");
}

function getEncryptionKey() {
  const configured = process.env.DEALHUNTER_SECRET_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) {
      throw new Error("DEALHUNTER_SECRET_KEY must be a 32-byte base64 value.");
    }
    return key;
  }

  const directory = dataDirectory();
  const keyPath = path.join(directory, ".dealhunter.secret");
  mkdirSync(directory, { recursive: true });
  if (!existsSync(keyPath)) {
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
  }
  return readFileSync(keyPath);
}

export function sealSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function openSecret(value: string) {
  const packed = Buffer.from(value, "base64");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
