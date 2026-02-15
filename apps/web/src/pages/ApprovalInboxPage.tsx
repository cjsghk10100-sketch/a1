import { useTranslation } from "react-i18next";

export function ApprovalInboxPage(): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="page">
      <h1 className="pageTitle">{t("page.approvals.title")}</h1>
      <p className="placeholder">{t("page.approvals.placeholder")}</p>
    </section>
  );
}

