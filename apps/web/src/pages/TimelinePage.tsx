import { useTranslation } from "react-i18next";

export function TimelinePage(): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="page">
      <h1 className="pageTitle">{t("page.timeline.title")}</h1>
      <p className="placeholder">{t("page.timeline.placeholder")}</p>
    </section>
  );
}

