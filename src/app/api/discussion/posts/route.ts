export async function POST(_req: Request) {
  return Response.json({ error: "独立讨论区已退役，请在对应页面评论区发言" }, { status: 410 });
}
