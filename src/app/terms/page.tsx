import { PageContainer } from "@/components/page-container";
import { DiscoveryHeader, DiscoveryList, DiscoveryRow, DiscoveryEmpty } from "@/components/discovery";
import { listTerms } from "@/lib/content";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const metadata = { title: "词条索引" };

export default async function Page() {
  const terms = await listTerms();
  return (
    <PageContainer>
      <DiscoveryHeader label="概念 / 词条" title="词条索引">
        <p>从一个概念出发，比较不同诠释者的视角。共 {terms.length} 个词条。</p>
      </DiscoveryHeader>
      <section aria-label="全部词条" className="mt-8">
        {terms.length > 0 ? (
          <DiscoveryList>
            {terms.map((term) => (
              <DiscoveryRow key={term.id} href={pagePath("term", term.slug, term.id)} title={term.title} description={term.summary} meta={`${term.perspectiveCount} 个视角`} />
            ))}
          </DiscoveryList>
        ) : (
          <DiscoveryEmpty href="/" label="返回首页">还没有词条，欢迎参与共建。</DiscoveryEmpty>
        )}
      </section>
    </PageContainer>
  );
}
