import Link from "next/link";

import { listInterpreters } from "@/lib/content";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const metadata = { title: "诠释者索引" };

export default async function InterpretersPage() {
  const interpreters = await listInterpreters();
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">诠释者索引</h1>
      <p className="mt-3 text-muted-foreground">沿着一位思想家的问题意识，阅读彼此关联的概念。</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {interpreters.map((interpreter) => (
          <li key={interpreter.pageId} className="min-w-0 rounded-lg border p-5">
            <Link href={pagePath("interpreter", interpreter.slug, interpreter.pageId)} className="break-words text-lg font-semibold underline-offset-4 hover:underline">{interpreter.name}</Link>
            <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{interpreter.summary}</p>
          </li>
        ))}
      </ul>
      {interpreters.length === 0 && <p className="mt-8 text-muted-foreground">还没有诠释者，欢迎参与共建。</p>}
    </main>
  );
}
