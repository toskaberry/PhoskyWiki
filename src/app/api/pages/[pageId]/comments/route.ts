import { commentId, commentResponse, listPageComments } from "@/lib/page-comments";

export async function GET(_req: Request, ctx: { params: Promise<{ pageId: string }> }) {
  return commentResponse(async () => Response.json(await listPageComments(commentId((await ctx.params).pageId))));
}
