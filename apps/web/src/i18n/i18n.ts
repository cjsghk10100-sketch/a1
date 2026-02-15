import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { resources, SUPPORTED_LANGUAGES, type SupportedLanguage } from "./resources";

export const i18nStorageKey = "agentapp.lang";

export function normalizeLanguage(raw: string | undefined | null): SupportedLanguage | null {
  const base = (raw ?? "").trim().split("-")[0]?.toLowerCase();
  return SUPPORTED_LANGUAGES.includes(base as SupportedLanguage) ? (base as SupportedLanguage) : null;
}

const fromStorage = normalizeLanguage(localStorage.getItem(i18nStorageKey));
const fromNavigator = normalizeLanguage(navigator.language);
const initial = fromStorage ?? fromNavigator ?? "en";

void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
