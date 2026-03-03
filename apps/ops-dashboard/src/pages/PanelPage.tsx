import { Suspense } from "react";

import { useI18n } from "../i18n/useI18n";
import type { PanelDefinition } from "../panels/registry";
import { LoadingSkele } from "../shared/LoadingSkele";

export function PanelPage({ panel }: { panel: PanelDefinition }): JSX.Element {
  const { t } = useI18n();
  const Component = panel.component;

  return (
    <section className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-800">{t(panel.labelKey)}</h1>
      <Suspense fallback={<LoadingSkele lines={10} />}>
        <Component mode="full" />
      </Suspense>
    </section>
  );
}
