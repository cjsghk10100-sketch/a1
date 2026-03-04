import { Link, useLocation } from "react-router-dom";

export function DeepLink({
  to,
  incidentId,
  label,
  className,
}: {
  to: "/health" | "/decision/timeline";
  incidentId: string;
  label: string;
  className?: string;
}): JSX.Element {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("highlight", incidentId);
  return (
    <Link to={`${to}?${params.toString()}`} className={className}>
      {label}
    </Link>
  );
}
