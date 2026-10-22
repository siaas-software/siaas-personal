"use client";
import { useEffect, useState } from "react";
import { agentStatusText, type AgentEligibility } from "@/lib/agent-policy";

export function AgentStatus({ model }: { model: string | null }) {
  const [result, setResult] = useState<{
    model: string;
    status?: AgentEligibility;
  }>();
  useEffect(() => {
    if (!model) return;
    const controller = new AbortController();
    fetch(`/api/local/models?model=${encodeURIComponent(model)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Model unavailable");
        const status: AgentEligibility = await response.json();
        if (!controller.signal.aborted) setResult({ model, status });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ model });
      });
    return () => controller.abort();
  }, [model]);
  if (!model) return null;
  return (
    <p className="notice small" role="status">
      {result?.model === model
        ? agentStatusText(result.status)
        : "Checking agent mode…"}
    </p>
  );
}
