import "server-only";

import { getTermDetail, listPerspectivesOfTerm } from "@/lib/content";
import { getDiscoveryGraph } from "@/lib/graph";
import { expandInterestedInterpreters, filterLiveInterests } from "@/lib/interests";
import { EMPTY_INTEREST_SET, reorderPerspectivesByInterest, type InterestSet } from "@/lib/interest-tags";
import { listRelatedTerms } from "@/lib/recommend";
import { pagePath } from "@/lib/slug";

/** 账号 SSR 与匿名发现共用，选择仅用于本次只读计算。 */
export async function getTermDiscovery(termId: number, selected: InterestSet | null) {
  if (!await getTermDetail(termId)) return null;
  const [interests, perspectives, graph] = await Promise.all([
    filterLiveInterests(selected ?? EMPTY_INTEREST_SET),
    listPerspectivesOfTerm(termId),
    getDiscoveryGraph(termId),
  ]);
  const interpreterIds = await expandInterestedInterpreters(interests);
  return {
    perspectives: reorderPerspectivesByInterest(perspectives, interpreterIds).map((p) => ({
      pageId: p.pageId,
      title: p.title,
      href: pagePath("perspective", p.slug, p.pageId),
      interpreterId: p.interpreterId,
      interpreterName: p.interpreterName,
      interpreterHref: pagePath("interpreter", p.interpreterSlug, p.interpreterId),
      linkCount: p.linkCount,
    })),
    relatedTerms: graph ? await listRelatedTerms(graph, interests, interpreterIds) : [],
    interestInterpreterIds: [...interpreterIds],
  };
}

export type TermDiscovery = NonNullable<Awaited<ReturnType<typeof getTermDiscovery>>>;
