import { getWikiPreview } from "@/lib/wiki-preview";

// Failures also remain uncached so deletion, restoration and retry are immediate.
const headers = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const rawId = new URL(req.url).searchParams.get("pageId") ?? "";
  const pageId = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(pageId) || pageId <= 0 || pageId > 2_147_483_647) {
    return Response.json({ error: "pageId 必须是有效的正整数" }, { status: 400, headers });
  }

  try {
    const preview = await getWikiPreview(pageId);
    if (!preview) {
      return Response.json({ error: "预览暂不可用" }, { status: 404, headers });
    }
    return Response.json(preview, { headers });
  } catch {
    return Response.json({ error: "预览暂不可用" }, { status: 500, headers });
  }
}
