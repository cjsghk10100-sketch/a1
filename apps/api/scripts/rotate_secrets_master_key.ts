import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { decryptSecretValue, encryptSecretValue } from "../src/security/cryptoVault.js";

interface SecretRow {
  secret_id: string;
  workspace_id: string;
  algorithm: "aes-256-gcm";
  nonce_b64: string;
  ciphertext_b64: string;
  auth_tag_b64: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalWorkspace(): string | null {
  const value = process.env.WORKSPACE_ID?.trim();
  return value && value.length ? value : null;
}

async function main(): Promise<void> {
  const currentMasterKey = requireEnv("CURRENT_SECRETS_MASTER_KEY");
  const nextMasterKey = requireEnv("NEXT_SECRETS_MASTER_KEY");
  if (currentMasterKey === nextMasterKey) {
    throw new Error("CURRENT_SECRETS_MASTER_KEY and NEXT_SECRETS_MASTER_KEY must differ");
  }

  const workspace_id = optionalWorkspace();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const rows = await client.query<SecretRow>(
      `SELECT
         secret_id,
         workspace_id,
         algorithm,
         nonce_b64,
         ciphertext_b64,
         auth_tag_b64
       FROM sec_secrets
       WHERE ($1::text IS NULL OR workspace_id = $1)
       ORDER BY created_at ASC`,
      [workspace_id],
    );

    for (const row of rows.rows) {
      const plain = decryptSecretValue(currentMasterKey, {
        algorithm: row.algorithm,
        nonce_b64: row.nonce_b64,
        ciphertext_b64: row.ciphertext_b64,
        auth_tag_b64: row.auth_tag_b64,
      });

      const nextEncrypted = encryptSecretValue(nextMasterKey, plain);
      await client.query(
        `UPDATE sec_secrets
         SET
           algorithm = $2,
           nonce_b64 = $3,
           ciphertext_b64 = $4,
           auth_tag_b64 = $5,
           updated_at = now()
         WHERE secret_id = $1`,
        [
          row.secret_id,
          nextEncrypted.algorithm,
          nextEncrypted.nonce_b64,
          nextEncrypted.ciphertext_b64,
          nextEncrypted.auth_tag_b64,
        ],
      );
    }

    await client.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          rotated: rows.rowCount ?? rows.rows.length,
          workspace_id: workspace_id ?? "*",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
