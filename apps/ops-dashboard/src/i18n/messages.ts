export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

const DEFAULT_LOCALE: Locale = "en";

const DICT = {
  en: {
    "layout.sidebar.panels": "Panels",
    "layout.sidebar.overview": "Overview",
    "overview.open": "Open",
    "header.workspace": "workspace",
    "header.polling": "polling",
    "header.refreshAll": "Refresh All",
    "layout.globalError.title": "Dashboard cannot reach any API endpoint.",
    "layout.globalError.baseUrl": "apiBaseUrl: {value}",
    "layout.globalError.retry": "Retry Now",
    "panel.health.label": "System Health",
    "panel.finance.label": "Finance",
    "statusHero.systemStatus": "System status",
    "statusHero.noReasons": "no active reasons",
    "signals.title": "Signals",
    "signals.cron": "Cron",
    "signals.projection": "Projection",
    "signals.dlq": "DLQ",
    "signals.incidents": "Incidents",
    "signals.flood": "Flood",
    "signals.yes": "yes",
    "signals.no": "no",
    "topIssues.title": "Top issues",
    "topIssues.empty": "No active issues",
    "drilldown.title": "Drilldown: {kind}",
    "drilldown.refresh": "Refresh",
    "drilldown.back": "← Back",
    "drilldown.empty": "No drilldown rows.",
    "drilldown.col.entityId": "entity_id",
    "drilldown.col.updatedAt": "updated_at",
    "drilldown.col.age": "age",
    "drilldown.col.details": "details",
    "drilldown.loadMore": "Load more",
    "timeline.title": "Status transitions",
    "timeline.empty": "No transitions yet",
    "timeline.noReasons": "no reasons",
    "finance.warnings.title": "Warnings",
    "finance.warning.top_models_unsupported": "Top-models breakdown is not available in this environment.",
    "finance.warning.top_models_error": "Top-models query failed. Showing base finance data only.",
    "finance.warning.finance_source_not_found": "Finance projection source was not found.",
    "finance.warning.finance_db_error": "Finance projection query failed. Retrying automatically.",
    "finance.totals.empty": "No finance totals available.",
    "finance.totals.title": "Totals",
    "finance.totals.estimatedCost": "Estimated Cost",
    "finance.totals.promptTokens": "Prompt Tokens",
    "finance.totals.completionTokens": "Completion Tokens",
    "finance.totals.totalTokens": "Total Tokens",
    "finance.topModels.title": "Top models",
    "finance.topModels.empty": "No model data.",
    "finance.chart.empty": "No cost data for this period",
    "finance.chart.costLegend": "Cost",
    "export.copyJson": "Copy JSON",
    "export.downloadJson": "Download JSON",
    "error.auth": "Authentication failed (401/403). Token may be expired. Update config.json and reload.",
    "error.network": "Cannot reach API server. Check network connection.",
    "error.server": "API returned server error. Will retry automatically.",
    "error.timeout": "Request timed out after 15s. Will retry.",
    "error.other": "API rejected request. Check dashboard version/contract.",
    "error.showingDataFrom": "Showing data from {value}",
    "statusAlerts.baseTitle": "Ops Dashboard",
    "statusAlerts.title.down": "⚠ DOWN — {base}",
    "statusAlerts.title.degraded": "⚠ DEGRADED — {base}",
    "statusAlerts.notify.title": "System status changed to {status}",
    "statusAlerts.notify.body.reasons": "Reasons: {value}",
    "statusAlerts.notify.body.empty": "No reason details",
    "bootstrap.failed": "Failed to boot dashboard: {value}",
    "format.na": "N/A",
    "format.ago.seconds": "{value}s ago",
    "format.ago.minutes": "{value}m ago",
    "format.ago.hours": "{value}h ago",
  },
  ko: {
    "layout.sidebar.panels": "패널",
    "layout.sidebar.overview": "개요",
    "overview.open": "열기",
    "header.workspace": "워크스페이스",
    "header.polling": "폴링",
    "header.refreshAll": "전체 새로고침",
    "layout.globalError.title": "대시보드가 어떤 API 엔드포인트에도 연결되지 않습니다.",
    "layout.globalError.baseUrl": "apiBaseUrl: {value}",
    "layout.globalError.retry": "지금 재시도",
    "panel.health.label": "시스템 상태",
    "panel.finance.label": "재무",
    "statusHero.systemStatus": "시스템 상태",
    "statusHero.noReasons": "활성 원인이 없습니다",
    "signals.title": "신호",
    "signals.cron": "크론",
    "signals.projection": "프로젝션",
    "signals.dlq": "DLQ",
    "signals.incidents": "인시던트",
    "signals.flood": "홍수",
    "signals.yes": "예",
    "signals.no": "아니오",
    "topIssues.title": "주요 이슈",
    "topIssues.empty": "활성 이슈가 없습니다",
    "drilldown.title": "드릴다운: {kind}",
    "drilldown.refresh": "새로고침",
    "drilldown.back": "← 뒤로",
    "drilldown.empty": "드릴다운 행이 없습니다.",
    "drilldown.col.entityId": "entity_id",
    "drilldown.col.updatedAt": "updated_at",
    "drilldown.col.age": "경과",
    "drilldown.col.details": "세부정보",
    "drilldown.loadMore": "더 보기",
    "timeline.title": "상태 전이",
    "timeline.empty": "아직 전이 이력이 없습니다",
    "timeline.noReasons": "원인 없음",
    "finance.warnings.title": "경고",
    "finance.warning.top_models_unsupported": "현재 환경에서는 상위 모델 분해가 지원되지 않습니다.",
    "finance.warning.top_models_error": "상위 모델 조회에 실패했습니다. 기본 재무 데이터만 표시합니다.",
    "finance.warning.finance_source_not_found": "재무 프로젝션 소스를 찾지 못했습니다.",
    "finance.warning.finance_db_error": "재무 프로젝션 조회에 실패했습니다. 자동으로 재시도합니다.",
    "finance.totals.empty": "사용 가능한 재무 합계가 없습니다.",
    "finance.totals.title": "합계",
    "finance.totals.estimatedCost": "예상 비용",
    "finance.totals.promptTokens": "프롬프트 토큰",
    "finance.totals.completionTokens": "완료 토큰",
    "finance.totals.totalTokens": "전체 토큰",
    "finance.topModels.title": "상위 모델",
    "finance.topModels.empty": "모델 데이터가 없습니다.",
    "finance.chart.empty": "이 기간의 비용 데이터가 없습니다",
    "finance.chart.costLegend": "비용",
    "export.copyJson": "JSON 복사",
    "export.downloadJson": "JSON 다운로드",
    "error.auth": "인증에 실패했습니다(401/403). 토큰이 만료되었을 수 있습니다. config.json을 갱신하고 다시 로드하세요.",
    "error.network": "API 서버에 연결할 수 없습니다. 네트워크를 확인하세요.",
    "error.server": "API 서버 오류가 발생했습니다. 자동 재시도합니다.",
    "error.timeout": "요청이 15초 후 시간 초과되었습니다. 재시도합니다.",
    "error.other": "API 요청이 거부되었습니다. 대시보드 버전/계약을 확인하세요.",
    "error.showingDataFrom": "{value} 시점 데이터를 표시 중입니다",
    "statusAlerts.baseTitle": "운영 대시보드",
    "statusAlerts.title.down": "⚠ DOWN — {base}",
    "statusAlerts.title.degraded": "⚠ DEGRADED — {base}",
    "statusAlerts.notify.title": "시스템 상태가 {status}(으)로 변경되었습니다",
    "statusAlerts.notify.body.reasons": "원인: {value}",
    "statusAlerts.notify.body.empty": "원인 세부정보 없음",
    "bootstrap.failed": "대시보드 부팅 실패: {value}",
    "format.na": "없음",
    "format.ago.seconds": "{value}초 전",
    "format.ago.minutes": "{value}분 전",
    "format.ago.hours": "{value}시간 전",
  },
} as const;

export type I18nKey = keyof (typeof DICT)["en"];

function normalizeLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const value = raw.trim().toLowerCase();
  if (value.startsWith("ko")) return "ko";
  if (value.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

function localeFromSearch(search: string): Locale | null {
  try {
    const params = new URLSearchParams(search);
    const value = params.get("lang");
    return value ? normalizeLocale(value) : null;
  } catch {
    return null;
  }
}

export function detectLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const fromQuery = localeFromSearch(window.location.search);
  if (fromQuery) return fromQuery;
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  return normalizeLocale(navigator.language);
}

export function renderMessage(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, name: string) => {
    if (!(name in values)) return `{${name}}`;
    return String(values[name]);
  });
}

export function translate(
  key: I18nKey,
  values?: Record<string, string | number>,
  locale?: Locale,
): string {
  const resolvedLocale = locale ?? detectLocale();
  const template = DICT[resolvedLocale][key] ?? DICT[DEFAULT_LOCALE][key];
  return renderMessage(template, values);
}
