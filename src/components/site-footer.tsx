import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-5 px-4 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <p className="text-lg font-bold tracking-tight">PhoskyWiki</p>
          <p className="mt-2 text-sm text-muted-foreground">词条 × 视角的原子笔记 WIKI</p>
          <p className="mt-1 text-xs text-muted-foreground">哲学 / 政治经济学 / 历史</p>
        </div>
        <nav aria-label="页尾导航" className="flex flex-wrap gap-x-5 text-sm">
          <Link className="inline-flex min-h-11 items-center" href="/search">检索全站</Link>
          <Link className="inline-flex min-h-11 items-center" href="/categories">浏览分类</Link>
          <Link className="inline-flex min-h-11 items-center" href="/interests">浏览兴趣</Link>
        </nav>
      </div>
    </footer>
  );
}
