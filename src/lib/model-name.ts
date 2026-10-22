// Accept local model names, never URLs, remote registries or cloud variants.
export function isLocalModelName(value: string) {
  return (
    value.length <= 150 &&
    /^(?:[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(
      value,
    ) &&
    !/(?:^|[-:/])cloud(?:$|[-:])/i.test(value)
  );
}
export function isLocalModelId(value: string) {
  return value.startsWith("ollama/") && isLocalModelName(value.slice(7));
}
export function canonicalModelName(value: string) {
  return value.includes(":") ? value : value + ":latest";
}
