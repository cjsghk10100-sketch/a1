import { redactUnknown } from "../utils/redact";

export function JsonView(props: { value: unknown }): JSX.Element {
  const redacted = redactUnknown(props.value);

  return (
    <pre className="jsonBlock">
      {JSON.stringify(redacted, null, 2)}
    </pre>
  );
}

