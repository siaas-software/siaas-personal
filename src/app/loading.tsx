import { SiaasLoader } from "@/components/siaas-loader";

export default function Loading() {
  return (
    <main className="loading-page">
      <span className="wordmark">
        SIAAS Personal<span> / </span>
      </span>
      <SiaasLoader label="Loading project…" />
    </main>
  );
}
