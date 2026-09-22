import { PageContainer } from "@/components/page-container";
import type { Metadata } from "next";
import { DiscoveryHeader, DiscoveryList, DiscoveryRow, DiscoveryEmpty } from "@/components/discovery";

import { listSchools } from "@/lib/content";
import { pagePath } from "@/lib/slug";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "学派 · PhoskyWiki" };

export default async function SchoolsPage() {
  const schools = await listSchools();

  return (
    <PageContainer>
      <DiscoveryHeader label="思想脉络 / 学派" title="学派">
        <p>学派组织诠释者；核心词条由成员的视角聚合而来，同一词条可连接多个学派。</p>
      </DiscoveryHeader>

      <section aria-labelledby="schools-heading" className="mt-10">
        <h2 id="schools-heading" className="mb-6 text-xl font-semibold">
          全部学派（{schools.length}）
        </h2>
        {schools.length > 0 ? (
          <DiscoveryList>
            {schools.map((school) => (
              <DiscoveryRow key={school.id} href={pagePath("school", school.slug, school.id)} title={school.title} description={school.summary} meta={`${school.memberCount} 位成员 · ${school.coreTermCount} 个核心词条`} />
            ))}
          </DiscoveryList>
        ) : (
          <DiscoveryEmpty href="/interpreters" label="浏览诠释者索引">暂无学派。</DiscoveryEmpty>
        )}
      </section>
    </PageContainer>
  );
}
