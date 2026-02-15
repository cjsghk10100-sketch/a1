import { useTranslation } from "react-i18next";

export function InspectorPage(): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="page">
      <h1 className="pageTitle">{t("page.inspector.title")}</h1>
      <p className="placeholder">{t("page.inspector.placeholder")}</p>
    </section>
  );
}

