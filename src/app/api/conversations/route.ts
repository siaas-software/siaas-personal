import { localWorkspace, fail, jsonBody, uuid } from "@/lib/http";
import { z } from "zod";
export async function GET(req: Request) {
  try {
    const { db } = await localWorkspace();
    const id = uuid.parse(new URL(req.url).searchParams.get("assistant"));
    const { data, error } = await db
      .from("conversations")
      .select("id,title,created_at")
      .eq("assistant_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const { assistant_id } = z
      .object({ assistant_id: uuid })
      .parse(await jsonBody(req));
    const { data, error } = await db
      .from("conversations")
      .insert({ assistant_id, tenant_id: tenantId })
      .select("id")
      .single();
    if (error) throw error;
    return Response.json(data, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
