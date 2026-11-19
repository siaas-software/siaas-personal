"use client";

import { ArrowUp } from "lucide-react";
import type { FormEvent } from "react";
import { SiaasLoader } from "./siaas-loader";

/** Common UI entry point; execution, storage and authorization stay with callers. */
export function ChatComposer({
  id,
  label,
  value,
  onChange,
  onSubmit,
  busy = false,
  disabled = false,
  placeholder,
  busyLabel = "Preparing response…",
  onCancel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder: string;
  busyLabel?: string;
  onCancel?: () => void;
}) {
  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!disabled && !busy && value.trim()) event.currentTarget.form?.requestSubmit();
          }
        }}
        rows={2}
        maxLength={1800}
        placeholder={placeholder}
        disabled={disabled || busy}
      />
      <button
        type="submit"
        className="send-button"
        aria-busy={busy}
        aria-label={busy ? busyLabel : label}
        disabled={disabled || busy || !value.trim()}
      >
        {busy ? <SiaasLoader iconOnly label={busyLabel} /> : <ArrowUp size={20} />}
      </button>
      {busy && onCancel && (
        <button type="button" className="button compact" onClick={onCancel}>
          Annulla
        </button>
      )}
    </form>
  );
}
