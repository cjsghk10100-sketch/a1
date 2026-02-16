import { randomUUID } from "node:crypto";

import type { EventEnvelopeV1, StreamRefV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { scanForSecrets, type SecretDlpMatch } from "../security/dlp.js";
import { computeEventHashV1 } from "../security/hashChain.js";
import { ensurePrincipalForLegacyActor } from "../security/principals.js";
import { allocateStreamSeq } from "./allocateSeq.js";
import { type EnvelopeWithSeq, appendEvent } from "./appendEvent.js";

type StreamWithSeq = StreamRefV1 & { stream_seq: number };
const DLP_DETECTOR_VERSION = "dlp_v1";

type AppendToStreamOptions = {
  skipDlp?: boolean;
};

async function previousEventHash(
  tx: DbClient,
  stream_type: string,
  stream_id: string,
  stream_seq: number,
): Promise<string | null> {
  if (stream_seq <= 1) return null;
  const res = await tx.query<{ event_hash: string | null }>(
    `SELECT event_hash
     FROM evt_events
     WHERE stream_type = $1
       AND stream_id = $2
       AND stream_seq = $3
     LIMIT 1`,
    [stream_type, stream_id, stream_seq - 1],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0].event_hash ?? null;
}

function newRedactionLogId(): string {
  return `srd_${randomUUID().replaceAll("-", "")}`;
}

function summarizeRuleIds(matches: SecretDlpMatch[]): string[] {
  return [...new Set(matches.map((m) => m.rule_id))].sort((a, b) => a.localeCompare(b));
}

async function appendSingleEvent(tx: DbClient, envelope: EventEnvelopeV1): Promise<EnvelopeWithSeq> {
  const stream_seq = await allocateStreamSeq(tx, envelope.stream.stream_type, envelope.stream.stream_id);

  const actor_principal_id =
    envelope.actor_principal_id ??
    (await ensurePrincipalForLegacyActor(tx, envelope.actor.actor_type, envelope.actor.actor_id));
  const zone = envelope.zone ?? "supervised";

  const withSeq: EnvelopeWithSeq = {
    ...(envelope as EventEnvelopeV1),
    actor_principal_id,
    zone,
    stream: {
      ...(envelope.stream as StreamRefV1),
      stream_seq,
    } as StreamWithSeq,
  };

  const prev_event_hash = await previousEventHash(
    tx,
    withSeq.stream.stream_type,
    withSeq.stream.stream_id,
    withSeq.stream.stream_seq,
  );
  const event_hash = computeEventHashV1(withSeq, prev_event_hash);

  await appendEvent(tx, { ...withSeq, prev_event_hash, event_hash });
  return { ...withSeq, prev_event_hash, event_hash };
}

async function recordDlpFindings(
  tx: DbClient,
  event: EnvelopeWithSeq,
  matches: SecretDlpMatch[],
  scanned_bytes: number,
): Promise<void> {
  for (const match of matches) {
    await tx.query(
      `INSERT INTO sec_redaction_log (
         redaction_log_id,
         workspace_id,
         event_id,
         event_type,
         stream_type,
         stream_id,
         rule_id,
         match_preview,
         detector_version,
         action,
         details
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb
       )`,
      [
        newRedactionLogId(),
        event.workspace_id,
        event.event_id,
        event.event_type,
        event.stream.stream_type,
        event.stream.stream_id,
        match.rule_id,
        match.match_preview,
        DLP_DETECTOR_VERSION,
        "shadow_flagged",
        JSON.stringify({ scanned_bytes }),
      ],
    );
  }
}

async function appendDlpDetectedEvent(
  tx: DbClient,
  source: EnvelopeWithSeq,
  matches: SecretDlpMatch[],
): Promise<EnvelopeWithSeq> {
  const dlp_actor_principal_id = await ensurePrincipalForLegacyActor(tx, "service", "dlp");
  const occurred_at = new Date().toISOString();

  return appendSingleEvent(tx, {
    event_id: randomUUID(),
    event_type: "secret.leaked.detected",
    event_version: 1,
    occurred_at,
    workspace_id: source.workspace_id,
    mission_id: source.mission_id,
    room_id: source.room_id,
    thread_id: source.thread_id,
    run_id: source.run_id,
    step_id: source.step_id,
    actor: { actor_type: "service", actor_id: "dlp" },
    actor_principal_id: dlp_actor_principal_id,
    zone: source.zone,
    stream: {
      stream_type: source.stream.stream_type,
      stream_id: source.stream.stream_id,
    },
    correlation_id: source.correlation_id,
    causation_id: source.event_id,
    contains_secrets: true,
    data: {
      source_event_id: source.event_id,
      source_event_type: source.event_type,
      scanner_version: DLP_DETECTOR_VERSION,
      match_count: matches.length,
      rule_ids: summarizeRuleIds(matches),
      matches,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });
}

export async function appendToStream(
  pool: DbPool,
  envelope: EventEnvelopeV1,
  options: AppendToStreamOptions = {},
): Promise<EnvelopeWithSeq> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const dlpResult = options.skipDlp ? null : scanForSecrets(envelope.data);
    const shouldMarkContainsSecrets = Boolean(dlpResult?.contains_secrets);

    const baseEnvelope: EventEnvelopeV1 = {
      ...envelope,
      contains_secrets: envelope.contains_secrets ?? shouldMarkContainsSecrets,
    };

    const appended = await appendSingleEvent(client, baseEnvelope);

    if (!options.skipDlp && dlpResult?.contains_secrets) {
      await recordDlpFindings(client, appended, dlpResult.matches, dlpResult.scanned_bytes);

      if (appended.event_type !== "secret.leaked.detected") {
        const dlpEvent = await appendDlpDetectedEvent(client, appended, dlpResult.matches);
        await client.query(
          `INSERT INTO sec_redaction_log (
             redaction_log_id,
             workspace_id,
             event_id,
             event_type,
             stream_type,
             stream_id,
             rule_id,
             match_preview,
             detector_version,
             action,
             details
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb
           )`,
          [
            newRedactionLogId(),
            appended.workspace_id,
            dlpEvent.event_id,
            dlpEvent.event_type,
            dlpEvent.stream.stream_type,
            dlpEvent.stream.stream_id,
            "secret_leak_summary",
            `source:${appended.event_id}`,
            DLP_DETECTOR_VERSION,
            "event_emitted",
            JSON.stringify({
              source_event_id: appended.event_id,
              source_event_type: appended.event_type,
              match_count: dlpResult.matches.length,
            }),
          ],
        );
      }
    }

    await client.query("COMMIT");
    return appended;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
