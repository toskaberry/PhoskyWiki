import { hasAdminRole } from "@/lib/roles";
import { auth } from "@/lib/auth";
import { compareRevisions, getPageHistory, historyId } from "@/lib/history";
import { reviewErrorResponse } from "@/lib/review";

export async function GET(req: Request, ctx: { params: Promise<{ pageId: string }> }) {
  try {
    const pageId = historyId((await ctx.params).pageId);
    const session = await auth.api.getSession({ headers: req.headers });
    const result = await getPageHistory(pageId, hasAdminRole(session?.user.role));
    const query = new URL(req.url).searchParams;
    const comparison = query.has("from") || query.has("to")
      ? compareRevisions(result, historyId(query.get("from")), historyId(query.get("to")))
      : null;
    return Response.json({ ...result, comparison }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = reviewErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
