import { requireSuperAdminUser } from "@/lib/admin-auth";
import { accessRequest, privateJson } from "@/lib/access-http";
import { changeUserRole, listUsers } from "@/lib/user-management";
import { AccessError } from "@/lib/access-grants";

export async function GET(req: Request) {
  const actor = await requireSuperAdminUser(req);
  if (actor instanceof Response) return privateJson(await actor.json(), actor.status);
  try {
    const query = new URL(req.url).searchParams;
    return privateJson(await listUsers(actor.user.id, query.get("q") ?? "", query.get("page") ?? "1"));
  } catch (error) {
    if (error instanceof AccessError) return privateJson({ error: error.message }, error.status);
    throw error;
  }
}

export async function POST(req: Request) {
  return accessRequest(req, async body => {
    const actor = await requireSuperAdminUser(req);
    if (actor instanceof Response) return privateJson(await actor.json(), actor.status);
    return privateJson(await changeUserRole(actor.user.id, body.userId, body.role));
  });
}
