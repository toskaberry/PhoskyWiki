import { writeLimitResponse } from "@/lib/write-limits";
// 创建提交（T06）：编者把编辑/新建提议送入审核队列；管理员本人提交直接生效。
// 准入：登录（editor/admin 皆可，游客 401）。语义见 ADR-0004 与 lib/review.ts。

import { auth } from "@/lib/auth";
import {
  createSubmission,
  reviewErrorResponse,
  ReviewError,
  type SubmissionInput,
} from "@/lib/review";
import type { SubmissionKind, UserRole } from "@/db/schema";

const KINDS: SubmissionKind[] = ["edit", "new_term", "new_perspective", "new_interpreter"];

function parseSubmissionInput(body: Record<string, unknown>): SubmissionInput {
  const kind = body.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as SubmissionKind)) {
    throw new ReviewError(400, "非法的提交类型");
  }
  if (kind === "new_term" && body.content !== undefined && typeof body.content !== "string") {
    throw new ReviewError(400, "新词条只接受导航信息；正文请另行提交具名诠释者视角");
  }
  // 可省的数值字段：缺席为 undefined（走领域层的必填校验），在场则必须是正整数
  const optionalInt = (value: unknown, field: string): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new ReviewError(400, `${field} 必须是正整数`);
    }
    return n;
  };
  return {
    kind: kind as SubmissionKind,
    pageId: optionalInt(body.pageId, "pageId"),
    content: typeof body.content === "string" ? body.content : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    aliases: body.aliases as string[] | undefined,
    keyTexts: body.keyTexts as SubmissionInput["keyTexts"],
    termId: optionalInt(body.termId, "termId"),
    interpreterId: optionalInt(body.interpreterId, "interpreterId"),
    baseRevisionId: optionalInt(body.baseRevisionId, "baseRevisionId"),
    supersedes: optionalInt(body.supersedes, "supersedes"),
    confirmedBaseRevisionId: optionalInt(body.confirmedBaseRevisionId, "confirmedBaseRevisionId"),
  };
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {

    return Response.json({ error: "提交需要登录" }, { status: 401 });
  }
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
  }

  try {
    const input = parseSubmissionInput(body as Record<string, unknown>);
    const result = await createSubmission(input, {
      id: session.user.id,
      role: session.user.role as UserRole,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    const mapped = reviewErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
