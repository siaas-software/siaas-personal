"use client";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Download, Upload, Settings2 } from "lucide-react";

export function ProjectActions({
  disabled,
  canImport,
  onExport,
  onImport,
  onConfigure,
}: {
  disabled: boolean;
  canImport: boolean;
  onExport: () => void;
  onImport: () => void;
  onConfigure: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
    function outside(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function act(action: () => void) {
    close();
    action();
  }
  return (
    <div
      className="project-actions"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="icon-button project-actions-trigger"
        aria-label="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={24} />
      </button>
      {open && (
        <div
          className="project-actions-menu"
          role="menu"
          aria-label="Project actions"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
              ),
            ];
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                    items.length;
            items[next]?.focus();
          }}
        >
          <button role="menuitem" onClick={() => act(onExport)}>
            <Download size={17} />
            Export
          </button>
          <button
            role="menuitem"
            disabled={!canImport}
            title={
              canImport
                ? "Import a JSON template into the project"
                : "Import is available for projects without assistants"
            }
            onClick={() => act(onImport)}
          >
            <Upload size={17} />
            Import
          </button>
          {!canImport && (
            <small>Import is available for empty projects.</small>
          )}
          <button role="menuitem" onClick={() => act(onConfigure)}>
            <Settings2 size={17} />
            Configuration
          </button>
        </div>
      )}
    </div>
  );
}
