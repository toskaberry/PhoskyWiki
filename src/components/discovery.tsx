import Link from "next/link";
import type { ReactNode } from "react";

/** Shared typography for discovery routes; data and ordering stay with each page. */
export function DiscoveryHeader({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <header className="border-b border-foreground pb-8">
      <p className="mb-3 text-xs font-medium tracking-widest text-muted-foreground">{label}</p>
      <h1 className="break-words text-3xl font-bold tracking-tight sm:text-5xl">{title}</h1>
      <div className="mt-4 max-w-2xl break-words text-sm leading-7 text-muted-foreground sm:text-base">{children}</div>
    </header>
  );
}

export function DiscoveryList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border border-y border-border">{children}</ul>;
}

export function DiscoveryRow({ href, title, description, meta }: {
  href: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <li className="min-w-0 py-5 sm:py-6">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <Link href={href} className="min-w-0 break-words text-lg font-semibold text-primary underline-offset-4 hover:underline sm:text-xl">{title}</Link>
        {meta && <div className="min-w-0 break-words text-xs leading-6 text-muted-foreground sm:max-w-[40%] sm:text-right">{meta}</div>}
      </div>
      {description && <div className="mt-2 max-w-3xl break-words text-sm leading-7 text-muted-foreground">{description}</div>}
    </li>
  );
}

export function DiscoveryEmpty({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return (
    <div className="border-y border-border py-8">
      <p className="break-words text-sm leading-7 text-muted-foreground">{children}</p>
      <Link href={href} className="mt-4 inline-block py-2 text-sm text-primary underline-offset-4 hover:underline">{label}</Link>
    </div>
  );
}

export function DiscoveryFacts({ title, rows }: { title: string; rows: { label: string; content: ReactNode }[] }) {
  return (
    <aside aria-label={title} className="min-w-0 border-t border-foreground py-5">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <dl className="divide-y divide-border text-sm">
        {rows.map((row) => (
          <div key={row.label} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3 py-3">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words leading-6">{row.content}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
