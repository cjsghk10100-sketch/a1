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
      "page.not_found": "Not found.",
      "page.timeline.title": "Timeline",
      "page.timeline.placeholder": "UI coming soon. This will consume the room SSE feed.",
      "page.approvals.title": "Approval Inbox",
      "page.approvals.placeholder": "UI coming soon. This will consume /v1/approvals.",
      "page.inspector.title": "Inspector",
      "page.inspector.placeholder": "UI coming soon. This will consume /v1/events and related read APIs.",
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
      "page.not_found": "페이지를 찾을 수 없습니다.",
      "page.timeline.title": "타임라인",
      "page.timeline.placeholder": "UI는 곧 추가됩니다. room SSE 피드를 소비합니다.",
      "page.approvals.title": "승인함",
      "page.approvals.placeholder": "UI는 곧 추가됩니다. /v1/approvals 를 소비합니다.",
      "page.inspector.title": "인스펙터",
      "page.inspector.placeholder": "UI는 곧 추가됩니다. /v1/events 및 관련 read API를 소비합니다.",
    },
  },
} as const;

