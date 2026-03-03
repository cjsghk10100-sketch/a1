import type { FinanceWarning } from "../../api/types";

function warningKind(warning: FinanceWarning): string {
  if (typeof warning === "string") return warning;
  return warning.kind;
}

export function WarningsBanner({ warnings }: { warnings: FinanceWarning[] }): JSX.Element | null {
  if (warnings.length === 0) return null;

  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="font-medium">Warnings</div>
      <ul className="mt-1 list-inside list-disc">
        {warnings.map((warning, index) => (
          <li key={`${warningKind(warning)}:${index}`}>{warningKind(warning)}</li>
        ))}
      </ul>
    </div>
  );
}
