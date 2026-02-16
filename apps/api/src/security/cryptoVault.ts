import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedSecretValue {
  algorithm: "aes-256-gcm";
  nonce_b64: string;
  ciphertext_b64: string;
  auth_tag_b64: string;
}

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;

function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey, "utf8").digest();
}

export function getSecretsMasterKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.SECRETS_MASTER_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function encryptSecretValue(masterKey: string, plaintext: string): EncryptedSecretValue {
  const key = deriveKey(masterKey);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: ALGORITHM,
    nonce_b64: nonce.toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
    auth_tag_b64: authTag.toString("base64"),
  };
}

export function decryptSecretValue(masterKey: string, payload: EncryptedSecretValue): string {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error("unsupported_secret_algorithm");
  }

  const key = deriveKey(masterKey);
  const nonce = Buffer.from(payload.nonce_b64, "base64");
  const ciphertext = Buffer.from(payload.ciphertext_b64, "base64");
  const authTag = Buffer.from(payload.auth_tag_b64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
