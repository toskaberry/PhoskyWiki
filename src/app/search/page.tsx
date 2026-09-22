// 全站搜索页（T10/ADR-0002）：服务端直查 SearchIndex 端口，
// 按类型分面过滤词条、诠释者、视角与页面评论。
// 请求期执行（q 每次不同），结果高亮片段已按 highlightHtml 转义。

import Link from "next/link";
import { PageContainer } from "@/components/page-container";
import { DiscoveryHeader, DiscoveryEmpty, DiscoveryRow } from "@/components/discovery";

import { SearchBox } from "@/components/search-box";
import { searchPublicPages } from "@/lib/search/public-search";
import {
  SEARCH_TYPES,
  SEARCH_TYPE_LABELS,
  highlightHtml,
  parseSearchParams,
  searchHitHref,
  type ParsedSearchParams,
  type SearchFacets,
  type SearchHit,
} from "@/lib/search/search-types";

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const parsed = parseSearchParams(await searchParams);
  const result = parsed.q ? await runSearch(parsed) : null;

  return (
    <PageContainer>
      <DiscoveryHeader label="检索 / 全站内容" title="全站搜索">
        <p>查找词条、诠释者、视角正文与页面评论；输入时可选择联想结果。</p>
      </DiscoveryHeader>
      <div className="mt-6">
        <SearchBox key={parsed.q} initialQuery={parsed.q} size="lg" />
      </div>

      {!parsed.q && (
        <div className="mt-8">
          <DiscoveryEmpty href="/terms" label="浏览词条索引">输入关键词开始搜索，也可以从词条索引出发。</DiscoveryEmpty>
        </div>
      )}
      {parsed.q && (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <p className="min-w-0 break-words text-muted-foreground">当前查询：{parsed.q} · {parsed.type ? SEARCH_TYPE_LABELS[parsed.type] : "全部类型"}</p>
          <Link href="/search" className="py-2 text-primary underline-offset-4 hover:underline">清除搜索</Link>
        </div>
      )}

      {result?.error && (
        <div role="alert" className="mt-8 border-y border-destructive/40 py-6 text-sm">
          <p className="text-destructive">搜索服务暂时不可用，请稍后重试。</p>
          <a href={facetHref(parsed.q, parsed.type, parsed.offset)} className="mt-3 inline-block py-2 text-primary underline-offset-4 hover:underline">重新搜索</a>
          <Link href="/terms" className="ml-6 inline-block py-2 text-primary underline-offset-4 hover:underline">浏览词条索引</Link>
        </div>
      )}

      {result && !result.error && (
        <>
          <nav aria-label="类型分面" className="mt-8 flex flex-wrap items-center gap-2 border-b border-border pb-3">
            {/* 全部 = 各类型计数之和（分面计数不受当前 type 过滤约束，端口契约） */}
            <FacetTab
              label="全部"
              count={Object.values(result.facets).reduce<number>((sum, count) => sum + (count ?? 0), 0)}
              href={facetHref(parsed.q, null)}
              active={parsed.type === null}
            />
            {SEARCH_TYPES.map((type) => (
              <FacetTab
                key={type}
                label={SEARCH_TYPE_LABELS[type]}
                count={result.facets[type] ?? 0}
                href={facetHref(parsed.q, type)}
                active={parsed.type === type}
              />
            ))}
          </nav>

          {result.hits.length === 0 ? (
            <div className="mt-8">
              <DiscoveryEmpty href={parsed.type ? facetHref(parsed.q, null) : "/terms"} label={parsed.type ? "查看全部类型" : "浏览词条索引"}>
                没有与「{parsed.q}」匹配的内容。
              </DiscoveryEmpty>
              {parsed.offset > 0 && <Link href={facetHref(parsed.q, parsed.type)} className="mt-4 inline-block py-2 text-sm text-primary hover:underline">返回第一页</Link>}
            </div>
          ) : (
            <>
              <ul className="mt-6 divide-y divide-border border-y border-border" data-testid="search-results">
                {result.hits.map((hit) => (
                  <DiscoveryRow
                    key={`${hit.type}-${hit.pageId}`}
                    href={searchHitHref(hit)}
                    title={<span className="[&_mark]:bg-primary/15 [&_mark]:text-foreground" dangerouslySetInnerHTML={{ __html: highlightHtml(hit.title) }} />}
                    meta={SEARCH_TYPE_LABELS[hit.type]}
                    description={hit.snippet ? <span className="[&_mark]:bg-primary/15 [&_mark]:text-foreground" dangerouslySetInnerHTML={{ __html: hit.snippet }} /> : undefined}
                  />
                ))}
              </ul>
              <Pagination parsed={parsed} total={result.total} />
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}

async function runSearch(parsed: ParsedSearchParams): Promise<
  { error: false; hits: SearchHit[]; total: number; facets: SearchFacets } | { error: true }
> {
  try {
    const result = await searchPublicPages(parsed.q, {
      type: parsed.type,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    return { error: false, ...result };
  } catch (err) {
    console.error("搜索页查询失败：", err);
    return { error: true };
  }
}

/** 分面 tab 与分页共用的 /search 查询串。 */
function facetHref(q: string, type: ParsedSearchParams["type"], offset = 0): string {
  const params = new URLSearchParams({ q });
  if (type) params.set("type", type);
  if (offset > 0) params.set("offset", String(offset));
  return `/search?${params.toString()}`;
}

function FacetTab({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`border-b-2 px-3 py-2 text-sm transition-colors ${
        active ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {label}
      <span className="ml-1 text-xs opacity-70">{count}</span>
    </Link>
  );
}

function Pagination({ parsed, total }: { parsed: ParsedSearchParams; total: number }) {
  const prevOffset = Math.max(0, parsed.offset - parsed.limit);
  const nextOffset = parsed.offset + parsed.limit;
  return (
    <nav aria-label="分页" className="mt-8 flex items-center justify-between text-sm">
      {parsed.offset > 0 ? (
        <Link href={facetHref(parsed.q, parsed.type, prevOffset)} className="text-muted-foreground hover:text-foreground">上一页</Link>
      ) : (
        <span />
      )}
      {nextOffset < total && (
        <Link href={facetHref(parsed.q, parsed.type, nextOffset)} className="text-muted-foreground hover:text-foreground">下一页</Link>
      )}
    </nav>
  );
}
