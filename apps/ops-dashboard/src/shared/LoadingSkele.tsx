export function LoadingSkele({ lines = 3 }: { lines?: number }): JSX.Element {
  return (
    <div className="space-y-2" aria-label="loading-skeleton">
      {Array.from({ length: lines }).map((_, idx) => (
        <div key={idx} className="h-4 animate-pulse rounded bg-slate-200" />
      ))}
    </div>
  );
}
