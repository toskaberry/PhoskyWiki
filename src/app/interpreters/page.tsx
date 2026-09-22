import { PageContainer } from "@/components/page-container";
import { DiscoveryHeader, DiscoveryList, DiscoveryRow, DiscoveryEmpty } from "@/components/discovery";
import { listInterpreters } from "@/lib/content";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const metadata = { title: "诠释者索引" };

export default async function Page() {
  const interpreters = await listInterpreters();
  return (
    <PageContainer>
      <DiscoveryHeader label="思想家 / 诠释者" title="诠释者索引">
        <p>沿着一位思想家的问题意识，阅读彼此关联的概念。诠释者是提供思想视角的人物，编者是整理和提交页面的人。</p>
      </DiscoveryHeader>
      <section aria-label="全部诠释者" className="mt-8">
        {interpreters.length > 0 ? (
          <DiscoveryList>
            {interpreters.map((interpreter) => (
              <DiscoveryRow key={interpreter.pageId} href={pagePath("interpreter", interpreter.slug, interpreter.pageId)} title={interpreter.name} description={interpreter.summary} meta={"诠释者"} />
            ))}
          </DiscoveryList>
        ) : (
          <DiscoveryEmpty href="/" label="返回首页">还没有诠释者，欢迎参与共建。</DiscoveryEmpty>
        )}
      </section>
    </PageContainer>
  );
}
