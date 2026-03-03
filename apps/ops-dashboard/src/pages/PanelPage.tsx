import { Suspense } from "react";

import type { PanelDefinition } from "../panels/registry";
import { LoadingSkele } from "../shared/LoadingSkele";

export function PanelPage({ panel }: { panel: PanelDefinition }): JSX.Element {
  const Component = panel.component;

  return (
    <section className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-800">{panel.label}</h1>
      <Suspense fallback={<LoadingSkele lines={10} />}>
        <Component mode="full" />
      </Suspense>
    </section>
  );
}
