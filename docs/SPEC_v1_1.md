# MIN_ORG Agent Activity App — SPEC v1.1

## 1. Objective
Build a lightweight, agent-first collaboration workspace with:
- event-sourced observability
- policy + approval gates
- learning enforcement (RCA + Learning Ledger)
- sustain/sunset decision support
- bilingual UX (English/Korean)

## 2. Core Principles
1. Security first
2. Request != Execute
3. Learn or Die
4. Sustain or Sunset

## 3. System Modules
- **Web App (`apps/web`)**: operator UX, approvals, timeline, learning ledger views
- **API (`apps/api`)**: policy checks, event append APIs, approval orchestration
- **Shared (`packages/shared`)**: event types, payload schemas, common constants
- **Infra (`infra`)**: local docker dependencies

## 4. Non-Functional Requirements
- Append-only audit/event log
- No secrets in logs
- Explicit approval required for risky external writes
- i18n by key, EN+KO required for user-facing text
