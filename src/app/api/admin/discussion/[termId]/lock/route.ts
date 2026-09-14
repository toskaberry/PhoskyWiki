// 版务锁定/解锁词条（T13，#71 扩展语义）：POST = 锁定，DELETE = 解锁，幂等。
// 准入见 requireAdminUser（T05 会话角色：登录且 admin）；锁定人记录在
// term_discussions.locked_by。锁定后该词条讨论区与页面评论（总评 + 各视角评论）
// 对任何角色（含管理员）关闭新增发言，已有内容仍可读。

import { requireAdminUser } from "@/lib/admin-auth";
import { setDiscussionLocked } from "@/lib/discussion";

interface LockRouteContext {
  params: Promise<{ termId: string }>;
}

async function handle(req: Request, ctx: LockRouteContext, locked: boolean) {
  const actor = await requireAdminUser(req);
  if (actor instanceof Response) return actor;

  const termId = Number((await ctx.params).termId);
  if (!Number.isSafeInteger(termId) || termId <= 0) {
    return Response.json({ error: "非法的词条 id" }, { status: 400 });
  }
  const updated = await setDiscussionLocked(termId, locked, actor.user);
  return updated
    ? new Response(null, { status: 204 })
    : Response.json({ error: "词条不存在" }, { status: 404 });
}

export async function POST(req: Request, ctx: LockRouteContext) {
  return handle(req, ctx, true);
}

export async function DELETE(req: Request, ctx: LockRouteContext) {
  return handle(req, ctx, false);
}
