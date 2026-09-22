import type { ReactNode } from "react";
import Link from "next/link";
import { WikiPreviewContent } from "@/components/wiki-preview-content";

/** 渲染 Markdown 产出的安全 HTML（renderMarkdown 已过 rehype-sanitize）。 */
export function WikiContent({ html }: { html: string }) {
  return <WikiPreviewContent html={html} />;
}

/** 信息框里的站内链接列表（「·」分隔，无值时显示占位符）。 */
export function InfoboxLinks({
  items,
  empty = "—",
}: {
  items: { key: string; label: string; href: string }[];
  empty?: string;
}) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {items.map((item, index) => (
        <span key={item.key} className="flex items-center">
          {index > 0 && <span className="mr-2 text-muted-foreground">·</span>}
          <Link href={item.href} className="underline-offset-4 hover:underline">
            {item.label}
          </Link>
        </span>
      ))}
    </span>
  );
}

/** 页面侧栏信息框（infobox）。 */
export function Infobox({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; content: ReactNode }[];
}) {
  return (
    <aside className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="mb-3 border-b border-border pb-2 text-center font-medium">
        {title}
      </div>
      <dl className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[5.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words">{row.content}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
