import type { ReadingHeading } from "@/lib/reading-markdown";

export function ReadingContents({ headings }: { headings: ReadingHeading[] }) {
  const baseDepth = Math.min(...headings.map(heading => heading.depth));
  return (
    <nav aria-label="章节目录">
      <ol className="space-y-2 text-sm leading-relaxed">
        {headings.map(heading => (
          <li key={heading.id} style={{ paddingInlineStart: `${Math.min(heading.depth - baseDepth, 3) * 0.75}rem` }}>
            <a className="block break-words py-1 underline-offset-4 hover:underline" href={`#${heading.id}`}>
              {heading.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
