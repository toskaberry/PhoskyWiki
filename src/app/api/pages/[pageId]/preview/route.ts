import { getWikiLinkPreview } from "@/lib/wiki-link-preview";

/** 双链预览的公开目标信息（#85）：只返回当前公开内容；隐藏/不存在目标 404。 */
export async function GET(_req: Request, ctx: { params: Promise<{ pageId: string }> }) {
  const id = Number((await ctx.params).pageId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ error: "预览目标不存在" }, { status: 404 });
  }
  const preview = await getWikiLinkPreview(id);
  if (!preview) {
    return Response.json({ error: "预览目标不存在" }, { status: 404 });
  }
  // 可见性在请求时判定，缓存不得跨可见性变化复用
  return Response.json(preview, { headers: { "Cache-Control": "no-store" } });
}
