import { formatCost, formatTokens } from "../../utils/format";

export function TotalsSummary({
  totals,
}: {
  totals: {
    estimated_cost_units: string | null;
    prompt_tokens: string | null;
    completion_tokens: string | null;
    total_tokens: string | null;
  } | null;
}): JSX.Element {
  if (!totals) {
    return <div className="text-sm text-slate-500">No finance totals available.</div>;
  }

  const rows = [
    ["Estimated Cost", formatCost(totals.estimated_cost_units)],
    ["Prompt Tokens", formatTokens(totals.prompt_tokens)],
    ["Completion Tokens", formatTokens(totals.completion_tokens)],
    ["Total Tokens", formatTokens(totals.total_tokens)],
  ] as const;

  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-semibold">Totals</div>
      <ul className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <li key={label} className="flex items-center justify-between">
            <span>{label}</span>
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
