import "server-only";

import { getDb } from "@/db";
import {
  getHeadContent,
  getLivePage,
  getPerspectiveDetail,
  getTermDetail,
  listPerspectivesOfTerm,
} from "@/lib/content";
import { renderMarkdownText } from "@/lib/markdown";
import { pagePath } from "@/lib/slug";
import type { WikiPreview } from "@/lib/wiki-preview-types";

function compactExcerpt(text: string): string {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  return characters.length <= 150 ? characters.join("") : `${characters.slice(0, 149).join("")}…`;
}

/** Visibility, metadata and published revision share one read snapshot. */
export async function getWikiPreview(pageId: number): Promise<WikiPreview | null> {
  return getDb().transaction(async (tx) => {
    const page = await getLivePage(pageId, tx);
    if (!page) return null;

    if (page.type === "term") {
      const term = await getTermDetail(pageId, tx);
      if (!term) return null;
      const perspectives = await listPerspectivesOfTerm(pageId, tx);
      return {
        type: "term",
        title: term.title,
        href: pagePath("term", term.slug, term.id),
        excerpt: compactExcerpt(term.summary),
        perspectives: perspectives.slice(0, 2).map((perspective) => ({
          title: perspective.title,
          href: pagePath("perspective", perspective.slug, perspective.pageId),
        })),
        perspectiveCount: perspectives.length,
      };
    }

    if (page.type === "perspective") {
      const perspective = await getPerspectiveDetail(pageId, tx);
      if (!perspective) return null;
      const content = await getHeadContent(pageId, tx);
      // Link destinations do not affect plain text; use the shared Markdown renderer
      // for visible labels, formatting, code, images and raw-HTML filtering.
      const text = renderMarkdownText(content ?? "", () => ({ href: "", exists: false }));
      return {
        type: "perspective",
        title: perspective.title,
        href: pagePath("perspective", perspective.slug, perspective.id),
        excerpt: compactExcerpt(text),
        interpreterName: perspective.interpreterName,
        perspectives: [],
        perspectiveCount: 0,
      };
    }

    return null;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
