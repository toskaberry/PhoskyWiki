import { inArray, or } from "drizzle-orm";
import { getDb } from "../../src/db";
import { pages, perspectives, submissions } from "../../src/db/schema";
import { assertIsolatedTestEnvironment } from "../isolated-environment";
import type { APIRequestContext } from "@playwright/test";

/** Exact, randomly generated fixture titles must be registered before a write. */
export async function cleanupTestContent(titles: string[], request: APIRequestContext) {
  assertIsolatedTestEnvironment();
  if (!titles.length) return;
  const published = await getDb().select({ id: pages.id }).from(pages).where(inArray(pages.title, titles));
  // Use the app first so a configured test search service removes derived results.
  for (const page of published) {
    const result = await request.post(`/api/admin/pages/${page.id}`, { data: { action: "delete" } });
    if (!result.ok()) throw new Error(`Test cleanup failed for page ${page.id}: HTTP ${result.status()}`);
  }
  await getDb().transaction(async tx => {
    const roots = await tx.select({ id: pages.id }).from(pages).where(inArray(pages.title, titles));
    const rootIds = roots.map(row => row.id);
    const children = rootIds.length ? await tx.select({ id: perspectives.pageId }).from(perspectives)
      .where(or(inArray(perspectives.termId, rootIds), inArray(perspectives.interpreterId, rootIds))) : [];
    const ids = [...rootIds, ...children.map(row => row.id)];
    await tx.delete(submissions).where(inArray(submissions.title, titles));
    if (ids.length) await tx.delete(pages).where(inArray(pages.id, ids));
  });
}
