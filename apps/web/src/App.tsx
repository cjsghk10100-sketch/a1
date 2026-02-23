import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { i18nStorageKey, normalizeLanguage } from "./i18n/i18n";
import type { SupportedLanguage } from "./i18n/resources";
import { ApprovalInboxPage } from "./pages/ApprovalInboxPage";
import { AgentProfilePage } from "./pages/AgentProfilePage";
import { DesktopBootstrapPage } from "./pages/DesktopBootstrapPage";
import { InspectorPage } from "./pages/InspectorPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { TimelinePage } from "./pages/TimelinePage";
import { WorkPage } from "./pages/WorkPage";

function LangButton(props: { lang: SupportedLanguage; current: SupportedLanguage; label: string }) {
  const { i18n } = useTranslation();

  const isActive = props.lang === props.current;
  return (
    <button
      className={isActive ? "langButton langButtonActive" : "langButton"}
      type="button"
      onClick={() => {
        void i18n.changeLanguage(props.lang);
        localStorage.setItem(i18nStorageKey, props.lang);
      }}
      aria-pressed={isActive}
    >
      {props.label}
    </button>
  );
}

function runtimeBadgeClass(phase: string): string {
  if (phase === "healthy") return "runtimeBadge runtimeBadgeHealthy";
  if (phase === "degraded" || phase === "starting") return "runtimeBadge runtimeBadgeDegraded";
  if (phase === "fatal") return "runtimeBadge runtimeBadgeFatal";
  return "runtimeBadge runtimeBadgeStopped";
}

export function App(): JSX.Element {
  const { t, i18n } = useTranslation();

  const current = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "en";
  const [desktopRuntimeAvailable, setDesktopRuntimeAvailable] = useState(false);
  const [desktopRuntimeStatus, setDesktopRuntimeStatus] = useState<DesktopRuntimeStatus | null>(null);

  useEffect(() => {
    document.title = t("app.title");
  }, [t, i18n.resolvedLanguage]);

  useEffect(() => {
    document.documentElement.lang = current;
  }, [current]);

  useEffect(() => {
    const bridge = window.desktopRuntime;
    if (!bridge) return;

    setDesktopRuntimeAvailable(true);
    let disposed = false;

    void bridge
      .getStatus()
      .then((status) => {
        if (disposed) return;
        setDesktopRuntimeStatus(status);
      })
      .catch(() => {
        if (disposed) return;
      });

    const unsubscribe = bridge.subscribe((status) => {
      if (disposed) return;
      setDesktopRuntimeStatus(status);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const runtimePhase = desktopRuntimeStatus?.phase ?? "starting";
  const runtimeBadgeTitle = useMemo(() => {
    if (!desktopRuntimeStatus) return t("desktop.runtime.badge.starting");
    const parts = [t(`desktop.runtime.badge.${desktopRuntimeStatus.phase}`)];
    if (desktopRuntimeStatus.degraded_component) {
      parts.push(`${t("desktop.runtime.degraded_component")}: ${desktopRuntimeStatus.degraded_component}`);
    }
    if (desktopRuntimeStatus.fatal_component) {
      parts.push(`${t("desktop.runtime.fatal_component")}: ${desktopRuntimeStatus.fatal_component}`);
    }
    if (desktopRuntimeStatus.last_error_code) {
      parts.push(`${t("desktop.runtime.last_error")}: ${desktopRuntimeStatus.last_error_code}`);
    }
    parts.push(`${t("desktop.runtime.restart_attempts")}: ${desktopRuntimeStatus.restart_attempts_total}`);
    return parts.join(" | ");
  }, [desktopRuntimeStatus, t]);

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appTitleWrap">
          <div className="appTitle">{t("app.title")}</div>
          {desktopRuntimeAvailable ? (
            <span className={runtimeBadgeClass(runtimePhase)} title={runtimeBadgeTitle}>
              {t(`desktop.runtime.badge.${runtimePhase}`)}
            </span>
          ) : null}
        </div>
        <nav className="appNav">
          <NavLink className={({ isActive }) => (isActive ? "navLink navLinkActive" : "navLink")} to="/work">
            {t("nav.work")}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? "navLink navLinkActive" : "navLink")} to="/timeline">
            {t("nav.timeline")}
          </NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? "navLink navLinkActive" : "navLink")}
            to="/notifications"
          >
            {t("nav.notifications")}
          </NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? "navLink navLinkActive" : "navLink")}
            to="/approvals"
          >
            {t("nav.approvals")}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? "navLink navLinkActive" : "navLink")} to="/agents">
            {t("nav.agents")}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? "navLink navLinkActive" : "navLink")} to="/inspector">
            {t("nav.inspector")}
          </NavLink>
        </nav>
        <div className="appLang">
          <LangButton lang="en" current={current} label={t("lang.en")} />
          <LangButton lang="ko" current={current} label={t("lang.ko")} />
        </div>
      </header>
      <main className="appMain">
        <Routes>
          <Route path="/desktop-bootstrap" element={<DesktopBootstrapPage />} />
          <Route path="/" element={<Navigate to="/timeline" replace />} />
          <Route path="/work" element={<WorkPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/approvals" element={<ApprovalInboxPage />} />
          <Route path="/agents" element={<AgentProfilePage />} />
          <Route path="/inspector" element={<InspectorPage />} />
          <Route path="*" element={<div className="placeholder">{t("page.not_found")}</div>} />
        </Routes>
      </main>
    </div>
  );
}
