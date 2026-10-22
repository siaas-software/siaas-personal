"use client";
import { useEffect, useRef, useState } from "react";
import { useInterfaceLanguage } from "./interface-language";
import { Table2, Zap, X } from "lucide-react";
import { shortcutPrompt } from "@/lib/shortcuts";
import type { ActionSkill } from "@/lib/actions";
import { useActions } from "./actions";
export function Shortcuts({
  disabled,
  onSend,
  onAction,
}: {
  disabled: boolean;
  onSend: (prompt: string) => void;
  onAction: (action: ActionSkill) => void;
}) {
  const italian = useInterfaceLanguage();
  const { actions, error, refresh } = useActions();
  const [table, setTable] = useState(false);
  const [details, setDetails] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (table) dialog.current?.showModal();
    else dialog.current?.close();
  }, [table]);
  return (
    <>
      <aside
        className="shortcut-sidebar"
        aria-label={italian ? "Scorciatoie" : "Shortcuts"}
      >
        <h3>{italian ? "Scorciatoie" : "Shortcuts"}</h3>
        <p>
          {italian
            ? "Dalle tue fonti, in chat"
            : "From your knowledge, in chat"}
        </p>
        <button
          className="shortcut-action shortcut-table"
          disabled={disabled}
          aria-label={italian ? "Tabella dati" : "Data table"}
          title="Data Cell"
          onClick={() => setTable(true)}
        >
          <Table2 size={19} />
          <span>{italian ? "Tabella dati" : "Data table"}</span>
        </button>
        <hr className="actions-divider" aria-label="Actions" />
        {actions.map((action) => (
          <button
            key={action.id}
            className="shortcut-action"
            disabled={disabled}
            aria-label={action.name}
            title={action.name}
            onClick={() => onAction(action)}
          >
            <Zap size={19} />
            <span>{action.name}</span>
          </button>
        ))}
        {error && (
          <p role="alert">
            {error}
            <button onClick={() => void refresh()}>
              {italian ? "Riprova" : "Retry"}
            </button>
          </p>
        )}
      </aside>
      <dialog ref={dialog} className="modal" onCancel={() => setTable(false)}>
        <div className="modal-heading">
          <h2>{italian ? "Crea una tabella dati" : "Create a data table"}</h2>
          <button
            className="icon-button"
            aria-label={italian ? "Chiudi tabella dati" : "Close data table"}
            onClick={() => setTable(false)}
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!details.trim() || disabled) return;
            setTable(false);
            onSend(shortcutPrompt("table", details));
            setDetails("");
          }}
        >
          <label htmlFor="table-description">
            {italian
              ? "Cosa vuoi inserire nella tabella?"
              : "What would you like in the table?"}
          </label>
          <textarea
            id="table-description"
            autoFocus
            required
            rows={5}
            maxLength={900}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Compare the products in my sources: name, features, price and source."
          />
          <p className="muted small">
            {italian
              ? "Descrivi argomento, colonne ed eventuali filtri. Il risultato apparirà in chat."
              : "Describe the topic, columns and any filters. The result will appear in chat."}
          </p>
          <button
            className="button primary"
            disabled={disabled || !details.trim()}
          >
            {italian ? "Crea tabella" : "Create table"}
          </button>
        </form>
      </dialog>
    </>
  );
}
