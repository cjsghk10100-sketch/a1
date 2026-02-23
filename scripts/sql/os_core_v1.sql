-- OS Core v1 (concept-to-schema baseline)
-- Objects: approval_queue, execution_runs, evidence_bundles

create extension if not exists pgcrypto;

create table if not exists approval_queue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  requester_agent text,
  action_type text not null,
  payload jsonb not null,
  risk_level text not null default 'L1',
  budget_cap numeric,
  status text not null default 'PENDING', -- PENDING/APPROVED/REJECTED/EXPIRED/CANCELLED
  approved_by uuid,
  decided_at timestamptz,
  decision_reason text,
  correlation_id uuid
);

create table if not exists execution_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  approval_id uuid references approval_queue(id),
  agent text not null,
  playbook text,
  status text not null default 'RUNNING', -- RUNNING/SUCCEEDED/FAILED/CANCELLED
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  error_code text,
  error_message text,
  parent_run_id uuid,
  attempt int not null default 1,
  evidence_id uuid,
  correlation_id uuid
);

create table if not exists evidence_bundles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid not null references execution_runs(id) on delete cascade,
  manifest jsonb not null, -- tool_calls/logs/artifacts/checks/metrics pointers
  integrity_sha256 text,
  summary text
);

create index if not exists idx_approval_queue_status on approval_queue(status);
create index if not exists idx_execution_runs_status on execution_runs(status);
create index if not exists idx_execution_runs_approval_id on execution_runs(approval_id);
create index if not exists idx_evidence_bundles_run_id on evidence_bundles(run_id);
