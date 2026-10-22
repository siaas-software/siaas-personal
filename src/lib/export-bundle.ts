import { createHash } from "node:crypto";
import { templateBundle } from "./templates";

export type PortableAssistant = {
  name: string;
  description: string;
  instructions: string;
  model_id?: string | null;
  color?: string;
  sources?: string[];
};

export type PortableProject = {
  name: string;
  description?: string;
  color?: string;
  assistants: PortableAssistant[];
};

export const PROJECT_EXPORT_FORMAT = "siaas-project-v1";

export function exportProjectBundle(project: PortableProject) {
  const value = templateBundle(project);
  const content = JSON.stringify(value, null, 2);
  return {
    fileName: "siaas-project.json",
    content,
    bytes: Buffer.byteLength(content),
    digest: createHash("sha256").update(content).digest("hex"),
  };
}
