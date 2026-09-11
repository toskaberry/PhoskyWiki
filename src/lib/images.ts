import { hasAdminRole } from "@/lib/roles";
import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { images } from "@/db/schema";
import type { Actor } from "./review";
import { IMAGE_ID, ImageError, imageReferences } from "./image-markdown";
import { getObjectStore } from "./object-store";
import { LimitError, limitResponse, limitSetting } from "./write-limits";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export async function beginImageUpload(input: unknown, actor: Actor) {
  const body = input as { filename?: unknown; contentType?: unknown; size?: unknown } | null;
  if (!body || typeof body.filename !== "string" || !body.filename.trim() || body.filename.length > 255 ||
    typeof body.contentType !== "string" || !TYPES.has(body.contentType) ||
    typeof body.size !== "number" || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > 10 * 1024 * 1024) {
    throw new ImageError(400, "请上传 10 MB 以内的 PNG、JPEG、WebP 或 GIF 图片");
  }
  const id = randomUUID();
  const stagingKey = `staging/${id}`;
  const { filename, contentType, size } = body;
  const maximum = limitSetting("UPLOAD_FILE_BYTES", 10 * 1024 * 1024, 10 * 1024 * 1024);
  if (size > maximum) throw new ImageError(400, `图片超过本站单文件限制（${maximum} 字节）`);
  return getDb().transaction(async tx => {
    // Exact account row lock: no hash collisions, shared IPs or client identity fields.
    await tx.execute(sql`SELECT id FROM "user" WHERE id = ${actor.id} FOR UPDATE`);
    const usage = await tx.execute<{ bytes: string; pending: string }>(sql`
      SELECT COALESCE(SUM(size), 0)::text AS bytes,
        COUNT(*) FILTER (WHERE object_key IS NULL)::text AS pending
      FROM images WHERE uploaded_by = ${actor.id} AND expired_at IS NULL
    `);
    if (Number(usage.rows[0].bytes) + size > limitSetting("UPLOAD_ACCOUNT_BYTES", 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER)) {
      throw new LimitError("upload_bytes", "账号图片容量已达上限，请联系管理员");
    }
    if (Number(usage.rows[0].pending) >= limitSetting("UPLOAD_PENDING_COUNT", 20)) {
      throw new LimitError("upload_pending", "待完成上传数量已达上限，请完成上传或等待暂存清理");
    }
    const signed = await getObjectStore().presignUpload(stagingKey, contentType);
    await tx.insert(images).values({ id, uploadedBy: actor.id, filename, contentType, size, stagingKey });
    return { id, ...signed, expiresIn: 300 };
  });
}

export async function completeImageUpload(id: string, actor: Actor) {
  if (!IMAGE_ID.test(id)) throw new ImageError(404, "图片不存在");
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(images).where(eq(images.id, id)).for("update");
    if (!row || row.uploadedBy !== actor.id) throw new ImageError(404, "图片不存在");
    if (!row.objectKey) {
      if (row.expiredAt || Date.now() - row.createdAt.getTime() >= stagingMaxAgeSeconds() * 1000) throw new ImageError(410, "暂存上传已过期，请重新上传");
      const store = getObjectStore();
      const metadata = await store.head(row.stagingKey);
      if (!metadata) throw new ImageError(409, "上传尚未完成，请重试");
      if (metadata.size !== row.size || metadata.contentType !== row.contentType || !metadata.etag) throw new ImageError(400, "上传文件大小或类型与声明不符，请重新上传");
      // 新 key 从不发 PUT 签名。CopySourceIfMatch 保证冻结的正是刚校验的对象。
      const objectKey = `images/${randomUUID()}`;
      await store.copy(row.stagingKey, objectKey, metadata.etag);
      await tx.update(images).set({ objectKey, publishedAt: hasAdminRole(actor.role) ? new Date() : null }).where(eq(images.id, id));
    }
    return { id, src: `/api/images/${id}` };
  });
}

export async function imageReadUrl(id: string, actor: Actor | null) {
  if (!IMAGE_ID.test(id)) throw new ImageError(404, "图片不存在");
  const [row] = await getDb().select().from(images).where(eq(images.id, id));
  if (!row?.objectKey || (!row.publishedAt && actor?.id !== row.uploadedBy && !hasAdminRole(actor?.role))) throw new ImageError(404, "图片不存在");
  return getObjectStore().presignRead(row.objectKey);
}

/** 创建提案时校验所有引用；私有图片只能由上传者或管理员提交。 */
export async function validateImageReferences(db: Db | Tx, content: string, actor: Actor) {
  const ids = imageReferences(content);
  if (!ids.length) return;
  const rows = await db.select().from(images).where(inArray(images.id, ids));
  if (rows.length !== ids.length || rows.some((row) => !row.objectKey || (!row.publishedAt && row.uploadedBy !== actor.id && !hasAdminRole(actor.role)))) throw new ImageError(400, "图片尚未上传完成、不存在或无权引用");
}

/** 与修订同一事务发布引用；待审或驳回从不走此路径。 */
export async function publishImageReferences(tx: Tx, content: string) {
  const ids = imageReferences(content);
  if (!ids.length) return;
  const rows = await tx.select().from(images).where(inArray(images.id, ids));
  if (rows.length !== ids.length || rows.some((row) => !row.objectKey)) throw new ImageError(400, "引用的图片不存在或未完成上传");
  await tx.update(images).set({ publishedAt: new Date() }).where(inArray(images.id, ids));
}

export function imageErrorResponse(error: unknown): Response {
  if (error instanceof LimitError) return limitResponse(error);
  if (error instanceof ImageError) return Response.json({ error: error.message }, { status: error.status });
  // SDK 错误可能包含签名地址；不传给客户端。
  return Response.json({ error: "图片存储暂不可用，请稍后重试" }, { status: 503 });
}

export function stagingMaxAgeSeconds() {
  return Math.max(3600, limitSetting("UPLOAD_STAGING_SECONDS", 86400));
}
