import type { Metadata } from "next";
import Link from "next/link";

import { InterestTagManager } from "@/components/interest-tag-manager";
import { PageContainer } from "@/components/page-container";
import { getInterestOptions, getInterestTags } from "@/lib/interests";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "兴趣标签" };

export default async function InterestsPage() {
  const user = await getSessionUser();
  const [options, accountInterests] = await Promise.all([
    getInterestOptions(),
    user ? getInterestTags(user.id) : Promise.resolve(null),
  ]);

  return (
    <PageContainer className="max-w-4xl">
      <header className="border-b border-foreground pb-8">
        <nav aria-label="面包屑" className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Link href="/">首页</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">兴趣标签</span>
        </nav>
        <p className="mt-8 text-xs font-medium tracking-widest text-muted-foreground">个人任务 · 兴趣</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">兴趣标签</h1>
        <div className="mt-4 max-w-2xl space-y-2 break-words text-sm leading-7 text-muted-foreground sm:text-base">
          <p>
            选择你关注的诠释者、学派与主题（分类）：词条页的视角列表会把相关诠释者排前，
            相关词条推荐也会优先呈现兴趣所在。
          </p>
          <p>
            {user ? (
              <>
                兴趣随账号同步，换设备不丢；保存时会把本浏览器此前的本地选择一并并入。
                当前选择也可以在<Link href="/profile" className="text-foreground underline-offset-4 hover:underline">个人主页</Link>查看。
              </>
            ) : (
              <>
                未登录：选择只保存在本浏览器（localStorage），诠释者和学派成员参与视角重排，
                三类兴趣共同影响相关词条推荐；登录后可同步到账号。
              </>
            )}
          </p>
        </div>
      </header>

      <section aria-labelledby="interest-picker-heading" className="mt-8">
        <h2 id="interest-picker-heading" className="text-2xl font-semibold">选择兴趣</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          三类兴趣可以任意组合；词条页会提示兴趣正在影响视角顺序与相关词条推荐。
        </p>
        <div className="mt-6">
          <InterestTagManager
            mode={user ? "account" : "guest"}
            interpreters={options.interpreters.map((row) => ({ id: row.id, label: row.name }))}
            schools={options.schools.map((row) => ({ id: row.id, label: row.name }))}
            categories={options.categories.map((row) => ({
              id: row.id,
              label: row.name,
              note: row.parentName ?? undefined,
            }))}
            accountInterests={accountInterests ?? undefined}
          />
        </div>
      </section>
    </PageContainer>
  );
}
