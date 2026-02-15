export const SUPPORTED_LANGUAGES = ["en", "ko"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const resources = {
  en: {
    translation: {
      "app.title": "Agent OS",
      "nav.timeline": "Timeline",
      "nav.approvals": "Approval Inbox",
      "nav.inspector": "Inspector",
      "lang.en": "EN",
      "lang.ko": "KO",
      "common.loading": "Loading…",
      "error.load_failed": "Failed to load. (code: {{code}})",
      "page.not_found": "Not found.",
      "page.timeline.title": "Timeline",
      "page.timeline.placeholder": "UI coming soon. This will consume the room SSE feed.",
      "page.approvals.title": "Approval Inbox",
      "page.inspector.title": "Inspector",
      "page.inspector.placeholder": "UI coming soon. This will consume /v1/events and related read APIs.",

      "approval.status.pending": "Pending",
      "approval.status.held": "Held",
      "approval.status.approved": "Approved",
      "approval.status.denied": "Denied",
      "approval.status.all": "All",

      "approval.empty": "No approvals found.",
      "approval.select_prompt": "Select an approval to review.",

      "approval.fields.approval_id": "Approval ID",
      "approval.fields.action": "Action",
      "approval.fields.room_id": "Room",
      "approval.fields.run_id": "Run",
      "approval.fields.requested_at": "Requested",
      "approval.fields.decided_at": "Decided",
      "approval.fields.reason": "Decision reason (optional)",
      "approval.fields.request": "Request",
      "approval.fields.context": "Context",
      "approval.fields.scope": "Scope",

      "approval.reason_placeholder": "Why?",
      "approval.decide.approve": "Approve",
      "approval.decide.deny": "Deny",
      "approval.decide.hold": "Hold",
    },
  },
  ko: {
    translation: {
      "app.title": "에이전트 OS",
      "nav.timeline": "타임라인",
      "nav.approvals": "승인함",
      "nav.inspector": "인스펙터",
      "lang.en": "EN",
      "lang.ko": "KO",
      "common.loading": "불러오는 중…",
      "error.load_failed": "불러오기에 실패했습니다. (code: {{code}})",
      "page.not_found": "페이지를 찾을 수 없습니다.",
      "page.timeline.title": "타임라인",
      "page.timeline.placeholder": "UI는 곧 추가됩니다. room SSE 피드를 소비합니다.",
      "page.approvals.title": "승인함",
      "page.inspector.title": "인스펙터",
      "page.inspector.placeholder": "UI는 곧 추가됩니다. /v1/events 및 관련 read API를 소비합니다.",

      "approval.status.pending": "대기",
      "approval.status.held": "보류",
      "approval.status.approved": "승인",
      "approval.status.denied": "거절",
      "approval.status.all": "전체",

      "approval.empty": "표시할 승인 요청이 없습니다.",
      "approval.select_prompt": "검토할 승인 요청을 선택하세요.",

      "approval.fields.approval_id": "승인 ID",
      "approval.fields.action": "액션",
      "approval.fields.room_id": "룸",
      "approval.fields.run_id": "런",
      "approval.fields.requested_at": "요청 시각",
      "approval.fields.decided_at": "결정 시각",
      "approval.fields.reason": "결정 사유(선택)",
      "approval.fields.request": "요청",
      "approval.fields.context": "컨텍스트",
      "approval.fields.scope": "범위",

      "approval.reason_placeholder": "왜 이렇게 결정하나요?",
      "approval.decide.approve": "승인",
      "approval.decide.deny": "거절",
      "approval.decide.hold": "보류",
    },
  },
} as const;
