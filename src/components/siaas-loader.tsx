import { SiaasMark } from "./siaas-mark";

export function SiaasLoader({
  label = "Loading…",
  compact = false,
  iconOnly = false,
  size = 19,
}: {
  label?: string;
  compact?: boolean;
  iconOnly?: boolean;
  size?: number;
}) {
  if (iconOnly) {
    return (
      <span
        className="siaas-loader-icon"
        role="status"
        style={{ width: size, height: size }}
      >
        <SiaasMark />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <div
      className={`siaas-loader${compact ? " siaas-loader-compact" : ""}`}
      role="status"
    >
      <SiaasMark />
      <span>{label}</span>
    </div>
  );
}
