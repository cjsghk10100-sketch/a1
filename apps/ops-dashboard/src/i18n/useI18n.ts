import { useMemo } from "react";

import { detectLocale, translate, type I18nKey } from "./messages";

export function useI18n(): {
  locale: "en" | "ko";
  t: (key: I18nKey, values?: Record<string, string | number>) => string;
} {
  const locale = detectLocale();
  return useMemo(
    () => ({
      locale,
      t: (key: I18nKey, values?: Record<string, string | number>) => translate(key, values, locale),
    }),
    [locale],
  );
}

