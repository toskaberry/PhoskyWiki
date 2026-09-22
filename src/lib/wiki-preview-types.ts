/** Minimal public content for a wiki-link preview; never includes proposal content. */
export interface WikiPreview {
  type: "term" | "perspective";
  title: string;
  href: string;
  excerpt: string;
  interpreterName?: string;
  perspectives: Array<{ title: string; href: string }>;
  perspectiveCount: number;
}
