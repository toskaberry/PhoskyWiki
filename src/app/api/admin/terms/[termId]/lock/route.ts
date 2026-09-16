// 版务锁定/解锁词条（#71 建立，spec 0009 沿用）：POST = 锁定，DELETE = 解锁，幂等。
// 准入见 requireAdminUser（T05 会话角色：登录且 admin）；锁定人记录在
// term_discussions.locked_by。锁定后该词条下的页面评论与回复对任何角色
// （含管理员）关闭新增，已有内容仍可读；划线感想不受影响。

import { requireAdminUser } from "@/lib/admin-auth";
import { setTermLocked } from "@/lib/term-lock";

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
  const updated = await setTermLocked(termId, locked, actor.user);
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
