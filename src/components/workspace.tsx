"use client";
import { SiaasLoader } from "./siaas-loader";
import { ActionsPage, ActionsModelsPage } from "./actions";
import { actionRequest, type ActionSkill } from "@/lib/actions";
import { Shortcuts } from "./shortcuts";
import { AboutSettings } from "./about-settings";
import { AppVersion } from "./app-version";
import { useInterfaceLanguage } from "./interface-language";
import { shortcutDisplayPrompt } from "@/lib/shortcuts";
import { WebKnowledge } from "./web-knowledge";
import { ChatMarkdown } from "./chat-markdown";
import { LocalKnowledge, LocalStoragePanel } from "./local-knowledge";
import { ExperimentalFeaturesPanel } from "./experimental-features";
import { ResearchSettingsFields } from "./research-settings";
import {
  DEFAULT_PROJECT_COLOR,
  PROJECT_PALETTES,
  resolveProjectPalette,
  projectForeground,
} from "@/lib/project-colors";
import { AssistantMascot } from "./assistant-mascot";
import { Overview } from "./overview";
import { ProjectActions } from "./project-actions";
import type { ProjectTemplate } from "@/lib/templates";
import { DesktopUpdatesPanel } from "./desktop-updates";
import { QuoteDemo } from "./quote-demo";
import { agentToolLabel } from "@/lib/agent-steps";
import { AgentStatus } from "./agent-status";
import { LocalSetup } from "./local-setup";
import type { OllamaRuntime } from "@/lib/ollama";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Zap,
  ArrowUp,
  AudioLines,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  LayoutDashboard,
  FileText,
  FolderOpen,
  Layers3,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  DEFAULT_MODEL,
  needsReindex,
  MAX_FILE_BYTES,
  MODELS,
  type Assistant,
  type Project,
  type DocumentRecord,
  type Message,
  type Source,
} from "@/lib/catalog";

type WorkspaceData = {
  desktop?: boolean;
  version?: string;
  workspace: { id: string; name: string } | null;
  projects: Project[];
  assistants: Assistant[];
  models: OllamaRuntime["models"];
  tokens: number;
  aiReady: boolean;
  runtime: OllamaRuntime;
};
type ModalKind =
  "project" | "assistant" | "text" | "template" | "project-settings" | null;
async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Operation failed.");
  return data;
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={onClose}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const dates = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function Workspace() {
  const italian = useInterfaceLanguage();
  const [data, setData] = useState<WorkspaceData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [mode, setMode] = useState<
      | "assistants"
      | "templates"
      | "workspace"
      | "overview"
      | "actions"
      | "actions-models"
    >("assistants"),
    [selected, setSelected] = useState<Assistant | null>(null),
    [activeProject, setActiveProject] = useState<Project | null>(null),
    [tab, setTab] = useState<"chat" | "settings" | "models" | "quote">("chat");
  const [modal, setModal] = useState<ModalKind>(null),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [mobileNav, setMobileNav] = useState(false);
  const [docs, setDocs] = useState<DocumentRecord[]>([]),
    [docsLoading, setDocsLoading] = useState(false),
    [source, setSource] = useState<{
      title: string;
      content: string;
      url?: string;
      fetched_at?: string;
    } | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [knowledgeRevision, setKnowledgeRevision] = useState(0);
  const [removingDoc, setRemovingDoc] = useState<DocumentRecord | null>(null);
  const [deleteCopy, setDeleteCopy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectImportRef = useRef<HTMLInputElement>(null);
  const desktop = !!data?.desktop;
  const preview = data?.runtime.mode === "preview";
  const load = useCallback(async () => {
    try {
      const d = await api<WorkspaceData>("/api/workspace");
      setData(d);
      setTemplates(await api<ProjectTemplate[]>("/api/templates"));
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);
  useEffect(() => {
    void load().then((d) => {
      const params = new URLSearchParams(window.location.search);
      if (d?.desktop && params.get("view") === "overview") setMode("overview");
      if (d?.desktop && params.get("view") === "actions") setMode("actions");
      if (d?.desktop && params.get("view") === "actions-models")
        setMode("actions-models");
      const id = params.get("assistant");
      const a = d?.assistants.find((a) => a.id === id);
      const projectId = a?.project_id ?? params.get("project");
      const project = d?.projects.find((p) => p.id === projectId);
      if (project) setActiveProject(project);
      if (a) {
        setSelected(a);
        setTab("chat");
      }
    });
  }, [load]);
  const loadDocs = useCallback(async () => {
    if (!selected) return;
    setDocsLoading(true);
    try {
      setDocs(
        await api<DocumentRecord[]>(`/api/documents?assistant=${selected.id}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDocsLoading(false);
    }
  }, [selected]);
  useEffect(() => {
    setDocs([]);
    void loadDocs();
  }, [loadDocs]);
  const webSourcesWorking = docs.some(
    (d) =>
      d.source_url &&
      d.enabled !== false &&
      (d.status === "processing" || (d.status === "queued" && !d.error)),
  );
  useEffect(() => {
    if (!desktop || !webSourcesWorking) return;
    const timer = window.setInterval(() => void loadDocs(), 3000);
    return () => window.clearInterval(timer);
  }, [desktop, webSourcesWorking, loadDocs]);
  useEffect(() => {
    if (!desktop || !activeProject?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api<{
          queued: string[];
          unavailable: number;
          errors: string[];
        }>("/api/local/knowledge", {
          method: "POST",
          body: JSON.stringify({
            action: "refresh-project",
            project_id: activeProject.id,
          }),
        });
        if (cancelled) return;
        if (result.unavailable)
          setNotice(
            `${result.unavailable} folders unavailable: check their paths in Knowledge.`,
          );
        if (result.errors.length) setError(result.errors.join(" "));
        if (result.queued.length && !result.unavailable)
          setNotice(
            `${result.queued.length} documents waiting for indexing in linked folders. Open Knowledge and select Refresh now.`,
          );
        setKnowledgeRevision((v) => v + 1);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop, activeProject?.id]);
  useEffect(() => {
    if (knowledgeRevision) void loadDocs();
  }, [knowledgeRevision, loadDocs]);
  function choose(a: Assistant) {
    setSelected(a);
    setTab("chat");
    setMode("assistants");
    setError("");
    setActiveProject(
      data?.projects.find((p) => p.id === a.project_id) ?? activeProject,
    );
    window.history.replaceState(
      {},
      "",
      `/?project=${a.project_id}&assistant=${a.id}`,
    );
  }
  function home() {
    setSelected(null);
    setActiveProject(null);
    setMode("assistants");
    window.history.replaceState({}, "", "/");
  }
  function projectHome() {
    if (!activeProject) return home();
    setSelected(null);
    setMode("assistants");
    window.history.replaceState({}, "", "/?project=" + activeProject.id);
  }
  function openProject(project: Project) {
    setActiveProject(project);
    setSelected(null);
    setMode("assistants");
    setMobileNav(false);
    window.history.replaceState({}, "", `/?project=${project.id}`);
  }
  async function removeProject(project: Project) {
    if (
      !window.confirm(
        `Delete “${project.name}”? Its assistants, documents and conversations will also be deleted. Saved templates will remain available.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      if (activeProject?.id === project.id) {
        setModal(null);
        home();
      }
      await load();
      setNotice("Project deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeAssistant(assistant: Assistant) {
    if (
      !window.confirm(
        `Delete “${assistant.name}” and all its documents and conversations?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/assistants/${assistant.id}`, { method: "DELETE" });
      if (selected?.id === assistant.id) {
        setDocs([]);
        setSource(null);
        projectHome();
      }
      await load();
      setNotice("Assistant deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeTemplate(template: ProjectTemplate) {
    if (
      !window.confirm(
        `Delete template “${template.name}”? Existing projects will remain available.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/templates/${encodeURIComponent(template.id)}`, {
        method: "DELETE",
      });
      setTemplates(await api<ProjectTemplate[]>("/api/templates"));
      setNotice("Template deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importTemplate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 512_000)
        throw new Error("The JSON file exceeds the 500 KB limit.");
      const raw = await file.text();
      JSON.parse(raw);
      await api("/api/templates", { method: "POST", body: raw });
      setTemplates(await api<ProjectTemplate[]>("/api/templates"));
      setNotice("Template imported. You can now use it to create a project.");
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "The file does not contain valid JSON."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const project = await api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name") || undefined,
          template_id: f.get("template_id") || null,
        }),
      });
      const refreshed = await load();
      const current =
        refreshed?.projects.find((p) => p.id === project.id) ?? project;
      setModal(null);
      openProject(current);
      setNotice(
        project.template_id
          ? "Project created. Web sources are registered and indexing runs locally. Choose the recommended assistant models."
          : "Project created.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importIntoProject(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeProject) return;
    const projectId = activeProject.id;
    setBusy(true);
    setError("");
    try {
      if (file.size > 512_000)
        throw new Error("The JSON file exceeds the 500 KB limit.");
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (
        parsed?.format !== "siaas-project-v1" ||
        !Array.isArray(parsed.project?.assistants)
      )
        throw new Error("This file is not a valid SIAAS Personal template.");
      if (
        !window.confirm(
          `Import template “${parsed.project.name}” into “${activeProject.name}”? The name, color and assistant settings will be applied.`,
        )
      )
        return;
      await api(`/api/project/import?project=${projectId}`, {
        method: "POST",
        body: raw,
      });
      const refreshed = await load();
      const project = refreshed?.projects.find((p) => p.id === projectId);
      if (project) openProject(project);
      setNotice(
        "Template imported. Web sources are registered; check their indexing status in each assistant’s Knowledge.",
      );
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "The file does not contain valid JSON."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeProject) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${activeProject.id}/template`, {
        method: "POST",
        body: JSON.stringify({
          name: new FormData(e.currentTarget).get("name"),
        }),
      });
      setTemplates(await api<ProjectTemplate[]>("/api/templates"));
      setModal(null);
      navigate("templates");
      setNotice("Template saved. You can export it as JSON from Templates.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveProjectSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeProject) return;
    setBusy(true);
    setError("");
    try {
      const project = await api<Project>("/api/projects/" + activeProject.id, {
        method: "PATCH",
        body: JSON.stringify({
          name: new FormData(e.currentTarget).get("name"),
          color: new FormData(e.currentTarget).get("color"),
          description: new FormData(e.currentTarget).get("description"),
        }),
      });
      setActiveProject(project);
      await load();
      setModal(null);
      setNotice("Project saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveAssistant(
    e: React.FormEvent<HTMLFormElement>,
    edit = false,
  ) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const a = await api<Assistant>(
        edit ? `/api/assistants/${selected!.id}` : "/api/assistants",
        {
          method: edit ? "PATCH" : "POST",
          body: JSON.stringify({
            ...Object.fromEntries(f),
            ...(desktop && f.has("research")
              ? { research: JSON.parse(String(f.get("research"))) }
              : {}),
            ...(!edit ? { project_id: activeProject?.id } : {}),
            ...(edit
              ? { model_id: selected!.model_id }
              : desktop
                ? { model_id: null }
                : {}),
          }),
        },
      );
      await load();
      setSelected(a);
      setModal(null);
      if (!edit) choose(a);
      setNotice(
        edit
          ? "Settings saved."
          : desktop
            ? "Assistant created. Open Models to choose the recommended model."
            : "Assistant created. Add your first source.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function processDocument(id: string) {
    await api(`/api/documents/${id}/process`, { method: "POST" });
  }
  async function addText(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const d = await api<{ id: string }>("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          assistant_id: selected.id,
          kind: "text",
          title: f.get("title"),
          text: f.get("text"),
        }),
      });
      setModal(null);
      await loadDocs();
      if (data?.aiReady) await processDocument(d.id);
      setNotice(
        data?.aiReady
          ? "Text added to knowledge."
          : "Text saved. Index it when the AI service is ready.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await loadDocs();
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length || !selected) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const kind = file.name.split(".").pop()?.toLowerCase();
        if (
          !kind ||
          !["pdf", "docx", "txt", "md"].includes(kind) ||
          file.size > MAX_FILE_BYTES ||
          !file.size
        )
          throw new Error("Usa PDF, DOCX, TXT o MD, fino a 10 MB per file.");
        const d = await api<{ id: string; storage_path: string }>(
          "/api/documents",
          {
            method: "POST",
            body: JSON.stringify({
              assistant_id: selected.id,
              title: file.name.slice(0, 180),
              kind,
              byte_size: file.size,
            }),
          },
        );
        const contentType =
          kind === "pdf"
            ? "application/pdf"
            : kind === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : kind === "md"
                ? "text/markdown"
                : "text/plain";
        let importedId = d.id;
        const error = await fetch(`/api/local/files/${d.id}`, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        }).then(async (r) => {
          const result = await r.json();
          if (r.ok) {
            importedId = result.id;
            return null;
          }
          return result.error;
        });
        if (error) {
          await api(`/api/documents/${d.id}?deleteCopy=true`, {
            method: "DELETE",
          });
          throw new Error(
            typeof error === "string" ? error : "Import failed. Please retry.",
          );
        }
        await loadDocs();
        if (data?.aiReady) await processDocument(importedId);
      }
      setNotice(
        data?.aiReady
          ? "Documents ready for chat."
          : "Files saved. Indexing will be available after AI setup.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      await loadDocs();
    }
  }
  async function removeDoc(d: DocumentRecord) {
    if (desktop) {
      setRemovingDoc(d);
      setDeleteCopy(false);
      return;
    }
    if (window.confirm(`Remove “${d.title}” from knowledge?`))
      await confirmRemoveDoc(d, false);
  }
  async function confirmRemoveDoc(d: DocumentRecord, removeCopy: boolean) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/documents/${d.id}?deleteCopy=${removeCopy}`, {
        method: "DELETE",
      });
      setRemovingDoc(null);
      setKnowledgeRevision((v) => v + 1);
      await loadDocs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function viewDoc(d: DocumentRecord) {
    try {
      const v = await api<{ url?: string; text?: string; title: string }>(
        `/api/documents/${d.id}`,
      );
      if (v.url) window.location.assign(v.url);
      else setSource({ title: v.title, content: v.text ?? "" });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(next: typeof mode) {
    setMode(next);
    setSelected(null);
    setMobileNav(false);
    window.history.replaceState(
      {},
      "",
      next === "overview" || next === "actions" || next === "actions-models"
        ? `/?view=${next}`
        : activeProject
          ? "/?project=" + activeProject.id
          : "/",
    );
  }
  if (!data)
    return (
      <main className="loading-page">
        <span className="wordmark">
          SIAAS Personal<span> / </span>
        </span>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <a className="button" href="/">
              Reload workspace
            </a>
          </>
        ) : (
          <SiaasLoader label="Loading project…" />
        )}
      </main>
    );
  const activeAssistants = activeProject
    ? data.assistants.filter((a) => a.project_id === activeProject.id)
    : [];
  const filtered = activeAssistants.filter((a) =>
    `${a.name} ${a.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <button className="sidebar-logo" onClick={home}>
          <AppLogo />
        </button>
        <span className="nav-label">NAVIGATION</span>
        <nav>
          {desktop && (
            <button
              className={mode === "overview" ? "active" : ""}
              onClick={() => navigate("overview")}
            >
              <LayoutDashboard size={19} />
              Overview
            </button>
          )}
          <button
            className={!activeProject && mode === "assistants" ? "active" : ""}
            onClick={home}
          >
            <FolderOpen size={19} />
            Projects<span className="nav-count">{data.projects.length}</span>
          </button>
          <div className="project-submenu">
            {data.projects.map((project) => (
              <button
                key={project.id}
                className={
                  activeProject?.id === project.id && mode === "assistants"
                    ? "active project-link"
                    : "project-link"
                }
                onClick={() => openProject(project)}
              >
                <span
                  className="project-dot"
                  style={{
                    backgroundColor: project.color || DEFAULT_PROJECT_COLOR,
                    border: "1px solid #b7c5bd",
                  }}
                />
                {project.name}
              </button>
            ))}
          </div>
          <button
            className={
              mode === "actions" || mode === "actions-models" ? "active" : ""
            }
            onClick={() => navigate("actions")}
          >
            <Zap size={19} />
            Actions
          </button>
          <button
            className={mode === "templates" ? "active" : ""}
            onClick={() => navigate("templates")}
          >
            <FileText size={19} />
            Templates
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className={
              mode === "workspace"
                ? "sidebar-settings active"
                : "sidebar-settings"
            }
            onClick={() => navigate("workspace")}
          >
            <Settings2 size={19} />
            Settings
          </button>
          <AppVersion version={data.version} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label="Open navigation"
          >
            <MoreHorizontal />
          </button>
          <span className="breadcrumb">
            {mode === "templates" ||
            mode === "workspace" ||
            mode === "overview" ||
            mode === "actions" ||
            mode === "actions-models"
              ? "SIAAS Personal"
              : (activeProject?.name ?? "Projects")}
            <ChevronRight size={14} />
            <strong>
              {mode === "actions-models"
                ? "Actions / Models"
                : mode === "actions"
                  ? "Actions"
                  : mode === "overview"
                    ? "Overview"
                    : mode === "templates"
                      ? "Templates"
                      : mode === "workspace"
                        ? "Settings"
                        : (selected?.name ??
                          (activeProject ? "Assistants" : "All projects"))}
            </strong>
          </span>
          <span className="private-badge">
            <ShieldCheck size={14} />{" "}
            {desktop ? "Data on your PC" : "Private access"}
          </span>
        </header>
        <main
          className={`main-content ${activeProject && mode === "assistants" ? "project-detail" : ""}`}
          style={
            activeProject && mode === "assistants"
              ? ({
                  backgroundColor: resolveProjectPalette(activeProject.color)
                    .background,
                  "--project-foreground": projectForeground(
                    activeProject.color || DEFAULT_PROJECT_COLOR,
                  ),
                } as React.CSSProperties)
              : undefined
          }
        >
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice success" role="status">
              {notice}
              <button
                className="icon-button"
                onClick={() => setNotice("")}
                aria-label="Dismiss message"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {data.workspace &&
            activeProject &&
            mode === "assistants" &&
            !data.runtime.connected && (
              <div className="notice">
                <Cpu size={18} />
                <span>{data.runtime.message}</span>
                {!preview && (
                  <button
                    className="button compact"
                    disabled={busy}
                    onClick={() => void load().then(() => loadDocs())}
                  >
                    Check Ollama
                  </button>
                )}
              </div>
            )}
          {mode === "actions-models" ? (
            <ActionsModelsPage onBack={() => navigate("actions")} />
          ) : mode === "actions" ? (
            <ActionsPage onModels={() => navigate("actions-models")} />
          ) : mode === "overview" && desktop ? (
            <Overview
              onAssistant={(id) => {
                const assistant = data.assistants.find((a) => a.id === id);
                if (assistant) choose(assistant);
                else setError("Assistant is no longer available.");
              }}
              onProject={(id) => {
                const project = data.projects.find((p) => p.id === id);
                if (project) openProject(project);
                else setError("Project is no longer available.");
              }}
            />
          ) : !activeProject && mode === "assistants" ? (
            <section>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR WORKSPACES</span>
                  <h1>
                    Your projects<span className="title-dot">.</span>
                  </h1>
                  <p>
                    Each project brings together assistants and knowledge for
                    your role or activity.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setProjectTemplateId("");
                    setModal("project");
                  }}
                >
                  <Plus size={18} />
                  New project
                </button>
              </div>
              <div className="assistant-grid">
                {data.projects.map((project) => {
                  const assistants = data.assistants.filter(
                    (a) => a.project_id === project.id,
                  );
                  const color = project.color || DEFAULT_PROJECT_COLOR;
                  return (
                    <article
                      className="project-card"
                      key={project.id}
                      style={{
                        backgroundColor:
                          resolveProjectPalette(color).background,
                        color: projectForeground(color),
                      }}
                    >
                      <button
                        className="project-card-open"
                        onClick={() => openProject(project)}
                        aria-label={`Open project ${project.name}`}
                      >
                        <div className="project-card-top">
                          <small>PERSONAL PROJECT</small>
                        </div>
                        <h3>{project.name}</h3>
                        <p>{project.description}</p>
                        <div className="project-card-meta">
                          <span>
                            ASSISTANTS<b>{assistants.length}</b>
                          </span>
                        </div>
                      </button>
                      <button
                        className="button compact resource-delete"
                        disabled={busy}
                        onClick={() => void removeProject(project)}
                        aria-label={`Delete project ${project.name}`}
                      >
                        <Trash2 size={16} />
                        Delete project
                      </button>
                    </article>
                  );
                })}
                <button
                  className="new-card"
                  onClick={() => {
                    setProjectTemplateId("");
                    setModal("project");
                  }}
                >
                  <Plus size={24} />
                  <strong>New project</strong>
                  <span>Start fresh or use a template</span>
                </button>
              </div>
            </section>
          ) : (
            <>
              {mode === "assistants" && activeProject && !selected && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">
                        YOUR ROLE, YOUR ASSISTANTS
                      </span>
                      <div className="project-title-row">
                        <h1>
                          {activeProject.name}
                          <span className="title-dot">.</span>
                        </h1>
                        <ProjectActions
                          disabled={busy}
                          canImport={activeAssistants.length === 0}
                          onExport={() => {
                            setError("");
                            setModal("template");
                          }}
                          onImport={() => projectImportRef.current?.click()}
                          onConfigure={() => {
                            setError("");
                            setModal("project-settings");
                          }}
                        />
                      </div>
                      <p>
                        Create assistants specialized in the tasks of your role
                        or activity.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setModal("assistant")}
                    >
                      <Plus size={18} />
                      New assistant
                    </button>
                  </div>
                  <div className="stats-row">
                    <div>
                      <span>Assistants</span>
                      <strong>
                        {activeAssistants.length.toString().padStart(2, "0")}
                      </strong>
                      <Layers3 />
                    </div>
                    <div>
                      <span>Available models</span>
                      <strong>
                        {data.models
                          .filter((m) => m.available)
                          .length.toString()
                          .padStart(2, "0")}
                        <small> / {data.models.length}</small>
                      </strong>
                      <Cpu />
                    </div>
                    <div>
                      <span>Tokens this month</span>
                      <strong>{data.tokens.toLocaleString("en-US")}</strong>
                      <AudioLines />
                    </div>
                  </div>
                  {!data.aiReady && (
                    <div className="notice">
                      <Sparkles size={18} />
                      <span>
                        {preview
                          ? "Create assistants and organize knowledge. Personal runs AI locally on your computer."
                          : "You can create assistants and save sources now. Chat and indexing become available when Ollama and the embedding model are ready."}
                      </span>
                    </div>
                  )}
                  <div className="section-toolbar">
                    <h2>
                      All assistants <span>{activeAssistants.length}</span>
                    </h2>
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Search assistants"
                        placeholder="Search for an assistant"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  {activeAssistants.length === 0 ? (
                    <div className="empty-hero">
                      <div className="empty-icon">
                        <AssistantMascot size={56} />
                      </div>
                      <h2>Your first assistant starts here.</h2>
                      <p>
                        Choose a model, add your documents
                        <br />e inizia una conversation.
                      </p>
                      <button
                        className="button primary"
                        onClick={() => setModal("assistant")}
                      >
                        <Plus size={18} />
                        Create your first assistant
                      </button>
                      <div className="empty-steps">
                        <span>
                          <b>01</b> Configure
                        </span>
                        <span>
                          <b>02</b> Add sources
                        </span>
                        <span>
                          <b>03</b> Chat
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="assistant-grid">
                      {filtered.map((a, i) => (
                        <article className="resource-card" key={a.id}>
                          <button
                            className="assistant-card"
                            onClick={() => choose(a)}
                          >
                            <div className="card-top">
                              <div className={`assistant-icon tint-${i % 3}`}>
                                <AssistantMascot size={44} />
                              </div>
                              <ChevronRight size={19} />
                            </div>
                            <h3>{a.name}</h3>
                            <p>
                              {a.description ||
                                "Add sources and configure this assistant."}
                            </p>
                            <div className="card-bottom">
                              <span className="model-tag">
                                <Cpu size={13} />
                                {MODELS.find((m) => m.id === a.model_id)
                                  ?.name ??
                                  a.model_id ??
                                  "Choose a model"}
                              </span>
                              <span>
                                {dates.format(new Date(a.created_at))}
                              </span>
                            </div>
                          </button>
                          <button
                            className="button compact resource-delete"
                            disabled={busy}
                            onClick={() => void removeAssistant(a)}
                            aria-label={`Delete assistant ${a.name}`}
                          >
                            <Trash2 size={16} />
                            Delete assistant
                          </button>
                        </article>
                      ))}
                      {!filtered.length && (
                        <p className="muted">
                          No assistants match your search.
                        </p>
                      )}
                      <button
                        className="new-card"
                        onClick={() => setModal("assistant")}
                      >
                        <Plus size={24} />
                        <strong>New assistant</strong>
                        <span>A new knowledge base</span>
                      </button>
                    </div>
                  )}
                </>
              )}
              {mode === "templates" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">REUSABLE CONFIGURATIONS</span>
                      <h1>
                        Templates<span className="title-dot">.</span>
                      </h1>
                      <p>Create a project with preconfigured assistants.</p>
                    </div>
                  </div>
                  <div className="button-row">
                    <label className="button">
                      <Upload size={16} />
                      Import JSON template
                      <input
                        type="file"
                        accept="application/json,.json"
                        hidden
                        disabled={busy}
                        onChange={(e) => void importTemplate(e)}
                      />
                    </label>
                  </div>
                  {!templates.length && (
                    <p className="muted">
                      No templates yet. Import a JSON file or save a project as
                      a template.
                    </p>
                  )}
                  <div className="assistant-grid">
                    {templates.map((template) => (
                      <article
                        className="panel model-card"
                        key={template.id}
                        style={{
                          backgroundColor: template.color,
                          color: projectForeground(template.color),
                        }}
                      >
                        <span className="eyebrow">PROJECT TEMPLATE</span>
                        <h2>{template.name}</h2>
                        <p>{template.description}</p>
                        <p className="muted">
                          {template.assistants.length} preconfigured assistants.
                          Choose models and add your documents.
                        </p>
                        <button
                          className="button"
                          onClick={() => {
                            setProjectTemplateId(template.id);
                            setModal("project");
                          }}
                        >
                          Use template
                        </button>
                        <div className="button-row">
                          <a
                            className="button compact"
                            href={`/api/templates/${encodeURIComponent(template.id)}`}
                          >
                            Export JSON
                          </a>
                          <button
                            className="button compact resource-delete"
                            disabled={busy}
                            onClick={() => void removeTemplate(template)}
                            aria-label={`Delete template ${template.name}`}
                          >
                            <Trash2 size={16} />
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {mode === "workspace" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">SIAAS Personal</span>
                      <h1>
                        Settings<span className="title-dot">.</span>
                      </h1>
                      <p>Manage application updates and local documents.</p>
                    </div>
                  </div>
                  {desktop ? (
                    <>
                      <ExperimentalFeaturesPanel />
                      <DesktopUpdatesPanel />
                      <LocalStoragePanel />
                      <AboutSettings version={data?.version} />
                    </>
                  ) : (
                    <section className="panel settings-panel">
                      <h2>Local workspace</h2>
                      <p>Your workspace is stored on this device.</p>
                    </section>
                  )}
                </>
              )}
              {selected && mode === "assistants" && (
                <>
                  <button className="back-link" onClick={projectHome}>
                    <ChevronLeft size={16} />
                    All assistants
                  </button>
                  <button
                    className="button compact resource-delete"
                    disabled={busy}
                    onClick={() => void removeAssistant(selected)}
                  >
                    <Trash2 size={16} />
                    Delete assistant
                  </button>
                  <div className="page-heading assistant-heading">
                    <div className="assistant-title">
                      <div className="assistant-icon">
                        <AssistantMascot size={44} />
                      </div>
                      <div>
                        <h1>{selected.name}</h1>
                        <p>
                          {selected.description || "Your knowledge assistant"}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label="Assistant sections"
                  >
                    <button
                      role="tab"
                      aria-selected={tab === "chat"}
                      onClick={() => setTab("chat")}
                    >
                      <MessageSquare size={17} />
                      Chat
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "settings"}
                      onClick={() => setTab("settings")}
                    >
                      <SlidersHorizontal size={17} />
                      {italian ? "Configurazione" : "Configuration"}
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "models"}
                      onClick={() => setTab("models")}
                    >
                      <Cpu size={17} />
                      {italian ? "Modelli" : "Models"}
                    </button>
                    {!desktop && (
                      <button
                        role="tab"
                        aria-selected={tab === "quote"}
                        onClick={() => setTab("quote")}
                      >
                        <Layers3 size={17} />
                        External provider
                      </button>
                    )}
                  </div>
                  {!desktop && tab === "quote" && (
                    <QuoteDemo key={selected.id} />
                  )}
                  {tab === "settings" && (
                    <section className="panel settings-panel assistant-settings">
                      <h2>
                        {italian
                          ? "Configura assistente"
                          : "Configure assistant"}
                      </h2>
                      <AssistantForm
                        key={selected.id}
                        showModel={false}
                        initial={selected}
                        preview={preview}
                        busy={busy}
                        onSubmit={(e) => void saveAssistant(e, true)}
                      />
                    </section>
                  )}
                  {tab === "models" && (
                    <div
                      className="assistant-models"
                      aria-label={italian ? "Modelli" : "Models"}
                    >
                      <span className="model-tag">
                        <Cpu size={15} />
                        {data.models.find((m) => m.id === selected.model_id)
                          ?.name ??
                          selected.model_id ??
                          (italian ? "Scegli un modello" : "Choose a model")}
                      </span>
                      <div className="notice">
                        {italian
                          ? "Scegli un modello adatto al tuo computer. Scaricalo, poi seleziona Usa per assistente."
                          : "Choose a model that suits your computer. Download it, then select Use for assistant."}
                      </div>
                      <AgentStatus model={selected.model_id} />
                      <LocalSetup
                        runtime={data.runtime}
                        model={selected.model_id}
                        refresh={load}
                        onModel={async (id) => {
                          const a = await api<Assistant>(
                            `/api/assistants/${selected.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                ...selected,
                                model_id: id,
                              }),
                            },
                          );
                          setSelected(a);
                          await load();
                          setNotice("Model selected for this assistant.");
                        }}
                      />
                      <button
                        className="button primary"
                        disabled={
                          !data.models.some(
                            (m) => m.id === selected.model_id && m.available,
                          )
                        }
                        onClick={() => setTab("chat")}
                      >
                        {italian
                          ? "Torna a fonti e chat"
                          : "Back to knowledge and chat"}
                      </button>
                    </div>
                  )}
                  {tab === "chat" && (
                    <div className="assistant-workbench">
                      <section
                        className="knowledge-panel"
                        aria-label="Knowledge"
                      >
                        {desktop && (
                          <WebKnowledge
                            key={`web-${selected.id}`}
                            assistantId={selected.id}
                            docs={docs.filter((d) => d.source_url)}
                            onChanged={loadDocs}
                            onView={(d) => void viewDoc(d)}
                            onRemove={(d) => {
                              setRemovingDoc(d);
                              setDeleteCopy(false);
                            }}
                          />
                        )}
                        {desktop && (
                          <div className="notice">
                            <span>Add sources to use in responses.</span>
                            {!data.runtime.embeddingReady && (
                              <button
                                className="button"
                                onClick={() => setTab("models")}
                              >
                                Set up the document model
                              </button>
                            )}
                          </div>
                        )}
                        <div className="section-toolbar">
                          <div>
                            <h2>
                              {italian ? "Gestione file" : "File management"}{" "}
                              <span className="muted small">
                                {docs.filter((d) => !d.source_url).length}
                              </span>
                            </h2>
                            <p className="muted small">
                              Only indexed sources are used in responses.
                            </p>
                          </div>
                          <div className="button-row">
                            <button
                              className="button"
                              disabled={busy}
                              onClick={() => setModal("text")}
                            >
                              <FileText size={16} />
                              Add text
                            </button>
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => fileRef.current?.click()}
                            >
                              <FolderOpen size={16} />
                              {italian ? "Importa file" : "Import files"}
                            </button>
                          </div>
                        </div>
                        {desktop && (
                          <LocalKnowledge
                            embeddingReady={!!data?.aiReady}
                            key={selected.id}
                            assistantId={selected.id}
                            revision={knowledgeRevision}
                            onChanged={loadDocs}
                          />
                        )}
                        <input
                          hidden
                          ref={fileRef}
                          type="file"
                          accept=".pdf,.docx,.txt,.md"
                          multiple
                          onChange={(e) => void upload(e.target.files)}
                        />
                        <p
                          className="field-help"
                          role={busy ? "status" : undefined}
                        >
                          {busy
                            ? italian
                              ? "Salvataggio e indicizzazione…"
                              : "Saving and indexing…"
                            : "PDF, DOCX, TXT, Markdown · max 10 MB"}
                        </p>
                        {docsLoading && !docs.length ? (
                          <SiaasLoader label="Loading sources…" compact />
                        ) : (
                          <div className="document-list">
                            {docs
                              .filter((d) => !d.source_url)
                              .map((d) => (
                                <article className="document-row" key={d.id}>
                                  <div className="file-icon">
                                    <FileText size={22} />
                                    <small>{d.kind.toUpperCase()}</small>
                                  </div>
                                  <div className="document-info">
                                    <button onClick={() => void viewDoc(d)}>
                                      {d.title}
                                    </button>
                                    <span>
                                      {dates.format(new Date(d.created_at))} ·{" "}
                                      {d.chunk_count > 0
                                        ? `${d.chunk_count} chunks`
                                        : `${Math.max(1, Math.round(d.byte_size / 1024))} KB`}
                                    </span>
                                    {desktop && (
                                      <small className="source-location">
                                        {d.source_id
                                          ? `Linked folder · ${d.relative_path}`
                                          : d.storage_path
                                            ? `Local copy · ${d.storage_path}`
                                            : "Local text"}
                                      </small>
                                    )}
                                    {d.error && (
                                      <small className="error">{d.error}</small>
                                    )}
                                  </div>
                                  <span className={`status ${d.status}`}>
                                    {needsReindex(
                                      d,
                                      data.runtime.embeddingProfile,
                                    )
                                      ? "Reindex needed"
                                      : {
                                          queued: "Queued",
                                          processing: "Indexing",
                                          ready: "Ready",
                                          error: "Retry needed",
                                        }[d.status]}
                                  </span>
                                  {(needsReindex(
                                    d,
                                    data.runtime.embeddingProfile,
                                  ) ||
                                    d.status === "queued" ||
                                    d.status === "error" ||
                                    (d.status === "processing" &&
                                      d.lease_until &&
                                      new Date(d.lease_until) <
                                        new Date())) && (
                                    <button
                                      className="button compact"
                                      disabled={busy || !data.aiReady}
                                      onClick={async () => {
                                        setBusy(true);
                                        setError("");
                                        try {
                                          await processDocument(d.id);
                                        } catch (e) {
                                          setError((e as Error).message);
                                        } finally {
                                          setBusy(false);
                                          await loadDocs();
                                        }
                                      }}
                                    >
                                      {needsReindex(
                                        d,
                                        data.runtime.embeddingProfile,
                                      )
                                        ? "Reindex"
                                        : "Set up assistant"}
                                    </button>
                                  )}
                                  <button
                                    className="icon-button danger"
                                    aria-label={`Delete ${d.title}`}
                                    disabled={busy}
                                    onClick={() => void removeDoc(d)}
                                  >
                                    <Trash2 size={17} />
                                  </button>
                                </article>
                              ))}
                            {!docs.some((d) => !d.source_url) && (
                              <div className="inline-empty">
                                <FolderOpen size={25} />
                                <span>
                                  No sources yet. Import a document or paste
                                  text.
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                      <section className="workbench-chat" aria-label="Chat">
                        {desktop &&
                          (!selected.model_id ||
                            !data.models.some(
                              (m) => m.id === selected.model_id && m.available,
                            )) && (
                            <div className="notice assistant-chat-setup">
                              <div>
                                <strong>Finish setup to start chatting.</strong>
                                <p className="muted small">
                                  {!selected.model_id
                                    ? "Choose the recommended model for this PC."
                                    : "The selected model must be installed on this PC."}
                                </p>
                              </div>
                              <div className="button-row">
                                {(!selected.model_id ||
                                  !data.models.some(
                                    (m) =>
                                      m.id === selected.model_id && m.available,
                                  )) && (
                                  <button
                                    className="button"
                                    onClick={() => setTab("models")}
                                  >
                                    Configure model
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        <Chat
                          key={selected.id}
                          assistant={selected}
                          desktop={desktop}
                          preview={preview}
                          ready={data.models.some(
                            (m) => m.id === selected.model_id && m.available,
                          )}
                          onSource={(s) =>
                            setSource({
                              title: s.title,
                              content: s.content,
                              url: s.url,
                              fetched_at: s.fetched_at,
                            })
                          }
                          onError={setError}
                        />
                      </section>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>SIAAS Personal</span>
          <span>Your knowledge stays yours.</span>
        </footer>
      </div>
      <input
        ref={projectImportRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Import template into project"
        onChange={(e) => void importIntoProject(e)}
      />
      {modal === "project" && (
        <Modal title="New project" onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={saveProject}>
            <label>
              Project name
              <input
                name="name"
                maxLength={100}
                placeholder="e.g. My work, Study, Event 2027"
              />
            </label>
            <label>
              Template
              <select
                name="template_id"
                value={projectTemplateId}
                onChange={(e) => setProjectTemplateId(e.target.value)}
              >
                <option value="">Empty project</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.assistants.length} assistants
                  </option>
                ))}
              </select>
            </label>
            <p className="field-help">
              Assistant names, descriptions and instructions are preconfigured.
              Choose the recommended models. Template web sources are indexed
              locally; you can also add your own documents.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                Create project
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removingDoc && (
        <Modal
          title="Remove source"
          onClose={() => {
            if (!busy) setRemovingDoc(null);
          }}
        >
          <p>Remove “{removingDoc.title}” and its index from this assistant?</p>
          {removingDoc.source_id ? (
            <p>
              The original file stays in its folder. This document will be
              excluded from future folder refreshes.
            </p>
          ) : removingDoc.storage_path ? (
            <>
              <label className="folder-checkbox">
                <input
                  type="checkbox"
                  checked={deleteCopy}
                  onChange={(e) => setDeleteCopy(e.target.checked)}
                />
                Also delete the local copy managed by SIAAS Personal
              </label>
              <p className="muted small">
                If unchecked, the copy stays in the data folder. The original
                file is unchanged.
              </p>
            </>
          ) : null}
          <div className="button-row">
            <button
              className="button"
              disabled={busy}
              onClick={() => setRemovingDoc(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void confirmRemoveDoc(removingDoc, deleteCopy)}
            >
              Remove source
            </button>
          </div>
        </Modal>
      )}
      {modal === "project-settings" && activeProject && (
        <Modal title="Project settings" onClose={() => !busy && setModal(null)}>
          <div className="project-settings">
            <form key={activeProject.id} onSubmit={saveProjectSettings}>
              <label>
                Name
                <input
                  name="name"
                  defaultValue={activeProject.name}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Project description
                <textarea
                  name="description"
                  defaultValue={activeProject.description}
                  maxLength={500}
                  rows={2}
                />
              </label>
              <fieldset className="project-palette-fieldset">
                <legend>Project palette</legend>
                <p className="field-help">
                  Choose one of eight accessible project palettes.
                </p>
                <div className="project-palette-grid">
                  {PROJECT_PALETTES.map((palette) => (
                    <label
                      className="project-palette-option"
                      key={palette.id}
                      style={{
                        backgroundColor: palette.background,
                        color: palette.foreground,
                      }}
                    >
                      <input
                        type="radio"
                        name="color"
                        value={palette.background}
                        defaultChecked={
                          resolveProjectPalette(activeProject.color).id ===
                          palette.id
                        }
                        aria-label={palette.name}
                        required
                      />
                      <span
                        className="project-palette-swatch"
                        style={{ backgroundColor: palette.accent }}
                        aria-hidden="true"
                      />
                      <span>{palette.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={busy}>
                  Save project
                </button>
              </div>
            </form>
          </div>
          <div className="project-settings-danger">
            <button
              className="button resource-delete"
              disabled={busy}
              onClick={() => void removeProject(activeProject)}
            >
              <Trash2 size={16} />
              Delete project
            </button>
          </div>
        </Modal>
      )}
      {modal === "template" && activeProject && (
        <Modal
          title="Export as template"
          onClose={() => !busy && setModal(null)}
        >
          <form onSubmit={saveTemplate}>
            <label>
              Template name
              <input
                name="name"
                defaultValue={activeProject.name}
                required
                maxLength={100}
                autoFocus
              />
            </label>
            <p className="field-help">
              Added to Templates with assistant settings and public web URLs.
              Local files, folders, indexed content and conversations stay on
              this PC.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                Save to Templates
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "assistant" && (
        <Modal title="New assistant" onClose={() => !busy && setModal(null)}>
          <p className="muted">
            Name your assistant and choose how it should respond.
          </p>
          <AssistantForm
            showModel={!desktop}
            preview={preview}
            busy={busy}
            onSubmit={(e) => void saveAssistant(e)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal === "text" && (
        <Modal
          title="Add a text source"
          onClose={() => !busy && setModal(null)}
        >
          <form onSubmit={addText}>
            <label>
              Title
              <input
                name="title"
                required
                maxLength={180}
                placeholder="Es. Procedura assistenza clienti"
                autoFocus
              />
            </label>
            <label>
              Content
              <textarea
                name="text"
                required
                maxLength={150000}
                rows={11}
                placeholder="Paste information for the assistant to reference…"
              />
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? "Saving…" : "Add to knowledge"}
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {source && (
        <Modal title={source.title} onClose={() => setSource(null)}>
          {source.url && (
            <p>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                Open web source
              </a>
              {source.fetched_at && (
                <>
                  {" "}
                  · Consultata il{" "}
                  {new Date(source.fetched_at).toLocaleString("en-US")}
                </>
              )}
            </p>
          )}
          <div className="source-content">{source.content}</div>
        </Modal>
      )}
    </div>
  );
}
function AppLogo() {
  return (
    <span className="app-logo" aria-label="SIAAS Personal">
      <svg viewBox="0 0 120 92" aria-hidden="true">
        <path
          className="app-logo-hand"
          d="M12 62 C31 43 43 43 59 54 C70 61 80 62 91 53"
        />
        <path className="app-logo-hand" d="M52 73 C68 80 82 77 108 53" />
        <path
          className="app-logo-spark"
          d="M61 5 C64 18 69 23 82 26 C69 29 64 34 61 47 C58 34 53 29 40 26 C53 23 58 18 61 5Z"
        />
        <path
          className="app-logo-spark"
          d="M91 20 C93 27 96 30 103 32 C96 34 93 37 91 44 C89 37 86 34 79 32 C86 30 89 27 91 20Z"
        />
      </svg>
      <b>SIAAS Personal</b>
    </span>
  );
}
function AssistantForm({
  initial,
  showModel = true,
  preview = false,
  busy,
  onSubmit,
}: {
  initial?: Assistant;
  showModel?: boolean;
  preview?: boolean;
  busy: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        Assistant name
        <input
          name="name"
          defaultValue={initial?.name ?? ""}
          placeholder="Es. Supporto clienti"
          required
          maxLength={80}
          autoFocus={!initial}
        />
      </label>
      <label>
        Description
        <input
          name="description"
          defaultValue={initial?.description ?? ""}
          placeholder="What does this assistant do?"
          maxLength={300}
        />
      </label>
      {showModel && (
        <label>
          Model
          <select
            aria-label="Model"
            name="model_id"
            defaultValue={
              initial && !MODELS.some((m) => m.id === initial.model_id)
                ? ""
                : (initial?.model_id ?? DEFAULT_MODEL)
            }
            required
          >
            <option value="" disabled>
              Choose an Ollama model
            </option>
            {MODELS.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name} · {m.provider}
              </option>
            ))}
          </select>
          <span className="field-help">
            {preview
              ? "Local model preference. Models do not run in this online demo."
              : "Change it without reimporting documents. Download the model in Ollama before using it; chat runs on this PC."}
          </span>
        </label>
      )}
      <label>
        Instructions
        <textarea
          name="instructions"
          defaultValue={initial?.instructions ?? ""}
          rows={4}
          maxLength={6000}
          placeholder="Es. Rispondi in modo conciso e professionale. Spiega i termini tecnici."
        />
        <span className="field-help">
          Responses use enabled sources. Instructions are limited to the
          selected mode’s capacity.
        </span>
      </label>
      {!showModel && <ResearchSettingsFields initial={initial?.research} />}
      <button className="button primary" disabled={busy}>
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <Check size={17} />
        )}{" "}
        {initial ? "Save settings" : "Create assistant"}
      </button>
    </form>
  );
}

function Chat({
  assistant,
  desktop = false,
  preview = false,
  ready,
  onSource,
  onError,
}: {
  assistant: Assistant;
  desktop?: boolean;
  preview?: boolean;
  ready: boolean;
  onSource: (s: Source) => void;
  onError: (e: string) => void;
}) {
  const italian = useInterfaceLanguage();
  const [conversations, setConversations] = useState<
      { id: string; title: string }[]
    >([]),
    [conversation, setConversation] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [streaming, setStreaming] = useState(false),
    [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const c = await api<{ id: string; title: string }[]>(
      `/api/conversations?assistant=${assistant.id}`,
    );
    setConversations(c);
  }, [assistant.id]);
  const open = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const d = await api<{
          conversation: { assistant_id: string };
          messages: Message[];
        }>(`/api/conversations/${id}`);
        if (d.conversation.assistant_id !== assistant.id)
          throw new Error(
            "This conversation does not belong to this assistant.",
          );
        setConversation(id);
        setMessages(d.messages);
        window.history.replaceState(
          {},
          "",
          `/?project=${assistant.project_id}&assistant=${assistant.id}&conversation=${id}`,
        );
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [assistant.id, onError],
  );
  useEffect(() => {
    void refresh().catch((e) => onError(e.message));
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (id) void open(id);
  }, [refresh, open, onError]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);
  const sending = useRef(false);
  async function send(
    e?: React.FormEvent,
    prompt?: string,
    action?: ActionSkill,
  ) {
    e?.preventDefault();
    const question = action
      ? actionRequest(action, input)
      : (prompt ?? input).trim();
    if (!question || sending.current || !ready || loading) return;
    sending.current = true;
    if (!prompt) setInput("");
    setStreaming(true);
    onError("");
    let id = conversation;
    const localId = crypto.randomUUID();
    try {
      if (!id) {
        const c = await api<{ id: string }>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ assistant_id: assistant.id }),
        });
        id = c.id;
        setConversation(id);
        window.history.replaceState(
          {},
          "",
          `/?project=${assistant.project_id}&assistant=${assistant.id}&conversation=${id}`,
        );
      }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: question,
          ...(action ? { action_id: action.id, action_name: action.name } : {}),
          status: "complete",
          sources: [],
        },
        {
          id: localId,
          role: "assistant",
          content: "",
          status: "pending",
          sources: [],
        },
      ]);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: id,
          question,
          ...(action ? { action_id: action.id } : {}),
          language: document.documentElement.lang.startsWith("it")
            ? "it"
            : "en",
        }),
      });
      if (!response.ok) {
        const d = await response.json();
        throw new Error(d.error ?? "Chat unavailable.");
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let doneEvent = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "done") doneEvent = true;
          setMessages((prev) =>
            prev.map((m) =>
              m.id !== localId
                ? m
                : {
                    ...m,
                    ...(event.type === "start"
                      ? { agent_mode: event.agent_mode }
                      : {}),
                    ...(event.type === "steps"
                      ? { agent_steps: event.steps }
                      : {}),
                    ...(event.type === "research"
                      ? {
                          research_warnings: event.warnings,
                          research_missing: event.missing,
                        }
                      : {}),
                    ...(event.type === "activity"
                      ? { agent_activity: event.text }
                      : {}),
                    ...(event.type === "artifacts"
                      ? { artifacts: event.artifacts }
                      : {}),
                    ...(event.type === "delta"
                      ? { content: m.content + event.text }
                      : {}),
                    ...(event.type === "sources"
                      ? { sources: event.sources }
                      : {}),
                    ...(event.type === "done" ? { status: "complete" } : {}),
                  },
            ),
          );
        }
      }
      if (!doneEvent)
        throw new Error(
          "Connection interrupted. Reopen the conversation to retrieve the saved response.",
        );
      if (mounted.current) {
        await open(id);
        await refresh();
      }
    } catch (e) {
      onError((e as Error).message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === localId
            ? {
                ...m,
                status: "error",
                content: m.content || "Response unavailable. Please retry.",
              }
            : m,
        ),
      );
      if (!prompt) setInput(question);
    } finally {
      sending.current = false;
      setStreaming(false);
    }
  }
  return (
    <div className="chat-layout">
      <details className="history-panel">
        <summary>Conversations</summary>
        <div className="section-toolbar">
          <h3>Conversations</h3>
          <button
            className="icon-button"
            aria-label="New conversation"
            disabled={streaming}
            onClick={() => {
              setConversation(null);
              setMessages([]);
              window.history.replaceState(
                {},
                "",
                `/?project=${assistant.project_id}&assistant=${assistant.id}`,
              );
            }}
          >
            <Plus size={18} />
          </button>
        </div>
        {conversations.map((c) => (
          <button
            className={`history-item ${c.id === conversation ? "active" : ""}`}
            disabled={streaming || loading}
            key={c.id}
            onClick={() => void open(c.id)}
          >
            <MessageSquare size={15} />
            <span>{c.title}</span>
          </button>
        ))}
        {!conversations.length && (
          <p className="muted small">Your conversations are saved here.</p>
        )}
      </details>
      <section className="chat-panel">
        <div className="chat-top">
          <div className="assistant-icon small-icon">
            <AssistantMascot size={30} />
          </div>
          <div>
            <strong>{assistant.name}</strong>
            <span>Answers grounded in your knowledge</span>
          </div>
          <span className="model-tag">
            {MODELS.find((m) => m.id === assistant.model_id)?.name ??
              assistant.model_id}
          </span>
        </div>
        {desktop && <AgentStatus model={assistant.model_id} />}
        <p
          role="note"
          className="muted"
          style={{ margin: "8px 0 12px", fontSize: "0.85rem" }}
        >
          You are interacting with an AI assistant, not a human. AI-generated
          responses may contain errors. Verify important information.
        </p>
        <div
          className="chat-messages"
          aria-live="polite"
          aria-busy={streaming || loading}
        >
          {loading ? (
            <SiaasLoader label="Loading conversation…" compact />
          ) : messages.length ? (
            messages.map((m) => (
              <article key={m.id} className={`message ${m.role}`}>
                <span className="message-label">
                  {m.role === "user" ? "You" : assistant.name}
                  {m.status === "error" ? " · Interrupted" : ""}
                  {m.action_name ? ` · Action: ${m.action_name}` : ""}
                </span>
                <div className="message-text">
                  {m.content ? (
                    m.role === "assistant" ? (
                      <ChatMarkdown content={m.content} />
                    ) : (
                      shortcutDisplayPrompt(m.content)
                    )
                  ) : (
                    <span className="thinking">
                      <SiaasLoader iconOnly size={16} label="Preparing response…" />
                      {m.agent_activity || "Preparing response…"}
                    </span>
                  )}
                </div>
                {m.agent_mode && m.status === "pending" && m.content && (
                  <p className="muted small" role="status">
                    {m.agent_activity || "Agent running…"}
                  </p>
                )}
                {!!m.agent_steps?.length && (
                  <details className="agent-steps">
                    <summary>
                      Agent activity
                      {m.agent_steps.some((step) => step.status === "error")
                        ? " · with errors"
                        : ""}
                    </summary>
                    <ol>
                      {m.agent_steps.map((step, index) => (
                        <li key={index}>
                          <strong>{agentToolLabel(step.tool, italian)}</strong>{" "}
                          · {step.status === "error" ? "Error" : "Completed"}
                          <span>{step.detail}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {!!m.artifacts?.length && conversation && (
                  <div className="sources" aria-label="Created reports">
                    {m.artifacts.map((artifact) => (
                      <a
                        key={artifact.id}
                        className="button compact"
                        href={`/api/local/reports/${encodeURIComponent(artifact.id)}?conversation=${encodeURIComponent(conversation)}`}
                      >
                        <Download size={15} /> {artifact.title} · Markdown
                      </a>
                    ))}
                  </div>
                )}
                {m.role === "assistant" && m.status === "complete" && (
                  <p className="generation-evidence">
                    {m.sources?.length
                      ? `Generation ${m.model_id?.startsWith("ollama/") ? "local" : "previous"} completed · ${m.model_id ?? "model not recorded"}`
                      : `Generation ${m.model_id?.startsWith("ollama/") ? "local" : "previous"} completed · no sources retrieved`}
                    {m.sources?.length > 0 &&
                    (m.input_tokens || m.output_tokens)
                      ? ` · ${m.input_tokens ?? 0} token input / ${m.output_tokens ?? 0} output`
                      : ""}
                  </p>
                )}
                {!!m.research_warnings?.length && (
                  <div className="notice" role="status">
                    {m.research_warnings.map((warning, i) => (
                      <p key={i}>{warning}</p>
                    ))}
                  </div>
                )}
                {!!m.research_missing?.length && (
                  <details className="research-missing">
                    <summary>Information to verify</summary>
                    <ul>
                      {m.research_missing.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {m.sources?.length > 0 && (
                  <div className="sources">
                    <span>Retrieved sources</span>
                    {m.sources.map((s, i) => (
                      <button key={s.id} onClick={() => onSource(s)}>
                        <BookOpenText size={13} />[{i + 1}] {s.title}
                        {s.url ? " · Web" : " · Document"}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))
          ) : (
            <div className="chat-empty">
              <div className="empty-icon">
                <Sparkles size={30} />
              </div>
              <h2>Ask your knowledge.</h2>
              <p>
                {preview
                  ? "Online chat · Coming soon. You can already add sources and view the estimate."
                  : ready
                    ? "Start a conversation. When knowledge is available, the assistant also uses relevant sources."
                    : "Start Ollama and install the selected model to begin."}
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form className="chat-composer" onSubmit={send}>
          <label className="sr-only" htmlFor="question">
            Your question
          </label>
          <textarea
            id="question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (ready) void send(e);
              }
            }}
            rows={2}
            maxLength={1800}
            placeholder="Type a message…"
            disabled={!ready || streaming || loading}
          />
          <button
            className="send-button"
            aria-label="Send message"
            disabled={!ready || !input.trim() || streaming || loading}
          >
            {streaming ? (
              <SiaasLoader iconOnly label="Waiting for AI response…" />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </form>
        <p className="chat-disclaimer">
          The assistant can make mistakes. Please verify its responses.
        </p>
      </section>
      <Shortcuts
        disabled={!ready || streaming || loading}
        onSend={(prompt) => void send(undefined, prompt)}
        onAction={(action) => void send(undefined, undefined, action)}
      />
    </div>
  );
}
