export type DesktopUpdateState = {
  phase: string;
  version: string;
  supported: boolean;
  message: string;
  nextVersion?: string;
  percent?: number;
  notes?: string;
};
declare global {
  interface Window {
    siaasDesktop?: {
      chooseKnowledgeFolder: () => Promise<string | null>;
      openKnowledgeFolder: (path: string) => Promise<void>;
      openDataDirectory: () => Promise<void>;
      updateState: () => Promise<DesktopUpdateState>;
      checkUpdate: () => Promise<DesktopUpdateState>;
      installUpdate: () => Promise<void>;
      onUpdateState: (
        callback: (state: DesktopUpdateState) => void,
      ) => () => void;
      getSetupError: () => Promise<string>;
      setupOllama: () => Promise<{
        ok: boolean;
        error?: string;
        message?: string;
      }>;
      cancelSetup: () => Promise<void>;
      onSetupProgress: (
        callback: (progress: { message: string; percent?: number }) => void,
      ) => () => void;
    };
  }
}
