import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { i18nStorageKey, normalizeLanguage } from "./i18n/i18n";
import type { SupportedLanguage } from "./i18n/resources";
import { ApprovalInboxPage } from "./pages/ApprovalInboxPage";
import { AgentProfilePage } from "./pages/AgentProfilePage";
import { InspectorPage } from "./pages/InspectorPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { TimelinePage } from "./pages/TimelinePage";

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

export function App(): JSX.Element {
  const { t, i18n } = useTranslation();

  const current = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "en";

  useEffect(() => {
    document.title = t("app.title");
  }, [t, i18n.resolvedLanguage]);

  useEffect(() => {
    document.documentElement.lang = current;
  }, [current]);

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appTitle">{t("app.title")}</div>
        <nav className="appNav">
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
          <Route path="/" element={<Navigate to="/timeline" replace />} />
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
