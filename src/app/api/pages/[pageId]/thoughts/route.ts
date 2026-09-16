import { auth } from "@/lib/auth";
import { listPageThoughts, thoughtId, thoughtResponse } from "@/lib/passage-thoughts";

/** 视角页的感想列表：公开感想对游客开放，本人私密感想随登录返回（spec 0009 #74）。 */
export async function GET(req: Request, context: { params: Promise<{ pageId: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  return thoughtResponse(async () => {
    const pageId = thoughtId((await context.params).pageId);
    return Response.json(await listPageThoughts(pageId, session?.user.id), {
      headers: { "cache-control": "private, no-store" },
    });
  });
}
