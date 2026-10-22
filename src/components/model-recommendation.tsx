export function ModelHardwareNote({
  model,
}: {
  model?: { fits: boolean; label: string };
}) {
  if (!model) return null;
  return (
    <p
      className={`model-hardware-note ${model.fits ? "muted" : "hardware-warning"}`}
    >
      {model.label}
    </p>
  );
}
