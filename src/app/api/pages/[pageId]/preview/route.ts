import { getWikiLinkPreview } from "@/lib/wiki-link-preview";

const headers = { "Cache-Control": "no-store" };

/** 双链预览的公开目标信息（#85）：只返回当前公开内容；隐藏/不存在目标 404。 */
export async function GET(_req: Request, ctx: { params: Promise<{ pageId: string }> }) {
  const id = Number((await ctx.params).pageId);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
    return Response.json({ error: "预览目标不存在" }, { status: 404, headers });
  }
  try {
    const preview = await getWikiLinkPreview(id);
    if (!preview) {
      return Response.json({ error: "预览目标不存在" }, { status: 404, headers });
    }
    return Response.json(preview, { headers });
  } catch {
    return Response.json({ error: "预览暂不可用" }, { status: 500, headers });
  }
}
