import { redirect } from "next/navigation";
import { isDesktop } from "@/lib/runtime";
import { Workspace } from "@/components/workspace";

export const dynamic = "force-dynamic";

export default function AppPage() {
  if (!isDesktop()) redirect("/");
  return <Workspace />;
}
