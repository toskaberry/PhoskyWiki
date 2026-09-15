export async function DELETE(_req: Request, _ctx: { params: Promise<{ postId: string }> }) {
  return Response.json({ error: "独立讨论区已退役，请在对应页面评论区管理评论" }, { status: 410 });
}
