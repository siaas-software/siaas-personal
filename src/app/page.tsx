import { isDesktop } from "@/lib/runtime";
import { Workspace } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default function Page() {
  if (isDesktop()) return <Workspace />;
  return <main className="setup"><h1>SIAAS Personal</h1><p>Open the desktop application to access your local workspace.</p></main>;
}
