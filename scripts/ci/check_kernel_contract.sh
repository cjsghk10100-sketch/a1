#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# STEP 0: Fetch base branch first (required before any git show calls)
# ─────────────────────────────────────────────────────────────────────────────
BASE_REF="${BASE_REF:-${GITHUB_BASE_REF:-main}}"

git fetch origin "${BASE_REF}" --depth=1 2>/dev/null \
  || git fetch --unshallow 2>/dev/null \
  || true

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: Bootstrap guard
# PR-0 creates KERNEL_CHANGE_PROTOCOL.md for the first time.
# If the file does not exist on base, skip all checks so PR-0 doesn't
# block itself.
# ─────────────────────────────────────────────────────────────────────────────
if ! git show "origin/${BASE_REF}:docs/KERNEL_CHANGE_PROTOCOL.md" \
     > /dev/null 2>&1; then
  echo "ℹ️  Bootstrap PR: docs/KERNEL_CHANGE_PROTOCOL.md not on base '${BASE_REF}'. Skipping kernel checks."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: Collect changed files (Added, Copied, Modified, Renamed)
# ─────────────────────────────────────────────────────────────────────────────
CHANGED="$(git diff --name-only --diff-filter=ACMR \
           "origin/${BASE_REF}...HEAD")"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: Detect kernel-touch
# docs/KERNEL_CHANGE_PROTOCOL.md itself is included so that editing
# the protocol doc cannot bypass the tag + log requirements.
# ─────────────────────────────────────────────────────────────────────────────
KERNEL_TOUCHED=""
while IFS= read -r f; do
  case "$f" in
    docs/KERNEL_CHANGE_PROTOCOL.md)              KERNEL_TOUCHED="${KERNEL_TOUCHED} ${f}" ;;
    apps/api/src/contracts/*)                    KERNEL_TOUCHED="${KERNEL_TOUCHED} ${f}" ;;
    apps/api/migrations/*)                       KERNEL_TOUCHED="${KERNEL_TOUCHED} ${f}" ;;
    .github/workflows/kernel_contract_check.yml) KERNEL_TOUCHED="${KERNEL_TOUCHED} ${f}" ;;
    scripts/ci/check_kernel_contract.sh)         KERNEL_TOUCHED="${KERNEL_TOUCHED} ${f}" ;;
  esac
done <<< "$CHANGED"

if [ -z "${KERNEL_TOUCHED}" ]; then
  echo "✅ No kernel-touch files changed. Skipping."
  exit 0
fi

echo "🔍 Kernel-touch files detected:${KERNEL_TOUCHED}"

ERRORS=""

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1: PR title must contain [KERNEL-MAJOR|MINOR|PATCH]
# ─────────────────────────────────────────────────────────────────────────────
TAG_TYPE=""
if echo "${PR_TITLE:-}" | grep -qE '\[KERNEL-MAJOR\]';  then TAG_TYPE="MAJOR"
elif echo "${PR_TITLE:-}" | grep -qE '\[KERNEL-MINOR\]'; then TAG_TYPE="MINOR"
elif echo "${PR_TITLE:-}" | grep -qE '\[KERNEL-PATCH\]'; then TAG_TYPE="PATCH"
fi

if [ -z "$TAG_TYPE" ]; then
  ERRORS="${ERRORS}\n❌ CHECK 1 FAIL: PR 제목에 [KERNEL-MAJOR|MINOR|PATCH] 태그 없음\n   현재 제목 : \"${PR_TITLE:-<empty>}\"\n   수정 방법 : PR 제목을 \"[KERNEL-MINOR] your description\" 형식으로 변경"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2: docs/KERNEL_CHANGE_PROTOCOL.md must be modified in this PR
# ─────────────────────────────────────────────────────────────────────────────
if ! echo "$CHANGED" | grep -q "docs/KERNEL_CHANGE_PROTOCOL.md"; then
  ERRORS="${ERRORS}\n❌ CHECK 2 FAIL: docs/KERNEL_CHANGE_PROTOCOL.md 미갱신\n   수정 방법 : 파일 하단 Kernel Change Log 테이블에 한 줄 추가 후 커밋"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3: schemaVersion.ts bump required for MAJOR or MINOR
# ─────────────────────────────────────────────────────────────────────────────
# CHECK X: PATCH tag must not touch contracts/migrations
if [ "$TAG_TYPE" = "PATCH" ]; then
  if echo "$CHANGED" | grep -q "apps/api/src/contracts/" || echo "$CHANGED" | grep -q "apps/api/migrations/"; then
    ERRORS="${ERRORS}\n❌ CHECK FAIL: [KERNEL-PATCH]인데 contracts/migrations가 변경됨\n   수정: 태그를 [KERNEL-MINOR] 또는 [KERNEL-MAJOR]로 변경하고 schemaVersion.ts 및 Change Log를 업데이트"
  fi
fi

if [ "$TAG_TYPE" = "MAJOR" ] || [ "$TAG_TYPE" = "MINOR" ]; then

  CONTRACTS_CHANGED=""
  MIGRATIONS_CHANGED=""
  echo "$CHANGED" | grep -q "apps/api/src/contracts/" && CONTRACTS_CHANGED="yes" || true
  echo "$CHANGED" | grep -q "apps/api/migrations/"    && MIGRATIONS_CHANGED="yes" || true

  if [ -n "$CONTRACTS_CHANGED" ] || [ -n "$MIGRATIONS_CHANGED" ]; then

    if ! echo "$CHANGED" | grep -q "apps/api/src/contracts/schemaVersion.ts"; then
      ERRORS="${ERRORS}\n❌ CHECK 3 FAIL: MINOR/MAJOR 변경이지만 schemaVersion.ts 미수정\n   수정 방법 : SCHEMA_VERSION 및 SUPPORTED_VERSIONS 업데이트"
    else
      # ── Validate SUPPORTED_VERSIONS contains both old and new versions ──
      NEW_VER="$(grep -E '^export const SCHEMA_VERSION' \
                   apps/api/src/contracts/schemaVersion.ts \
                 | grep -oE '"[^"]+"' | tr -d '"' | head -1)"

      OLD_VER="$(git show "origin/${BASE_REF}:apps/api/src/contracts/schemaVersion.ts" \
                 | grep -E '^export const SCHEMA_VERSION' \
                 | grep -oE '"[^"]+"' | tr -d '"' | head -1)"

      SUPPORTED_LINE="$(grep 'SUPPORTED_VERSIONS' \
                         apps/api/src/contracts/schemaVersion.ts | head -1)"

      if [ -n "$OLD_VER" ] && ! echo "$SUPPORTED_LINE" | grep -q "\"${OLD_VER}\""; then
        ERRORS="${ERRORS}\n❌ CHECK 3 FAIL: SUPPORTED_VERSIONS에 이전 버전(${OLD_VER}) 없음\n   원칙: 현재 + 직전 1개 동시 수용 필요"
      fi
      if [ -n "$NEW_VER" ] && ! echo "$SUPPORTED_LINE" | grep -q "\"${NEW_VER}\""; then
        ERRORS="${ERRORS}\n❌ CHECK 3 FAIL: SUPPORTED_VERSIONS에 신규 버전(${NEW_VER}) 없음"
      fi
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Result
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "$ERRORS" ]; then
  echo ""
  echo "══════════════════════════════════════════"
  echo "  KERNEL CONTRACT VIOLATION"
  echo "══════════════════════════════════════════"
  printf "%b\n" "$ERRORS"
  echo ""
  echo "Base ref    : ${BASE_REF}"
  echo "PR title    : ${PR_TITLE:-<empty>}"
  echo "Touch files :${KERNEL_TOUCHED}"
  exit 1
fi

echo ""
echo "✅ Kernel contract check passed."
echo "   Base: ${BASE_REF} | Tag: [KERNEL-${TAG_TYPE}]"
echo "   Touch files:${KERNEL_TOUCHED}"
