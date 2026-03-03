export type PollingDotState = "active" | "idle" | "error" | "paused";

export function PollingDot({ state }: { state: PollingDotState }): JSX.Element {
  const base = "inline-block h-2.5 w-2.5 rounded-full";
  if (state === "active") return <span className={`${base} bg-green-500 animate-pulse`} aria-label="polling-active" />;
  if (state === "error") return <span className={`${base} bg-red-500`} aria-label="polling-error" />;
  if (state === "paused") return <span className={`${base} bg-gray-400`} aria-label="polling-paused" />;
  return <span className={`${base} bg-green-500`} aria-label="polling-idle" />;
}
