import { hasAdminRole } from "@/lib/roles";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SubmissionForm, type SubmissionFormProps } from "@/components/submission-form";
import { ContentDiff } from "@/components/content-diff";
import { TermMetadataDiff } from "@/components/term-metadata-diff";
import { getLivePage, getPerspectiveEditingState, listTerms, listInterpreters, listPerspectivePairs } from "@/lib/content";
import { getSessionUser } from "@/lib/session";
import { getMySubmission } from "@/lib/submission-history";
import { getTermEditingState, getInterpreterEditingState, ReviewError } from "@/lib/review";
import { termSnapshot, type MetadataSnapshot } from "@/lib/revision-snapshot";

export const dynamic = "force-dynamic";
export const metadata = { title: "修改后重新提交" };

export default async function ResubmitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const rawId = (await params).id;
  const id = Number(rawId);
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id) || id > 2_147_483_647) notFound();
  const proposal = await getMySubmission(user.id, id, hasAdminRole(user.role));
  if (!proposal || proposal.status !== "rejected") notFound();
  const retry = { id, ownerId: user.id, reason: proposal.rejectionReason ?? "提交已驳回", stale: false, unavailable: undefined as string | undefined, proposal };
  const common = { isAdmin: hasAdminRole(user.role), resubmission: retry };
  let form: SubmissionFormProps;
  let comparison: React.ReactNode = null;
  if (proposal.kind === "edit") {
    const page = proposal.pageId ? await getLivePage(proposal.pageId) : null;
    if (!page) retry.unavailable = "目标页面或其父页面已删除或不可用。";
    if (proposal.title !== null) {
      const original: MetadataSnapshot = page?.type === "interpreter" || proposal.baseSnapshot?.type === "interpreter" ? { version: 1, type: "interpreter", title: proposal.title, summary: proposal.summary ?? "", keyTexts: proposal.keyTexts ?? undefined } : termSnapshot({ title: proposal.title, summary: proposal.summary ?? "", aliases: proposal.aliases, keyTexts: proposal.keyTexts ?? undefined });
      let current = { snapshot: original, baseRevisionId: proposal.baseRevisionId! };
      if (page) {
        try { current = await (page.type === "interpreter" ? getInterpreterEditingState(page.id) : getTermEditingState(page.id)); }
        catch (err) { if (!(err instanceof ReviewError)) throw err; retry.unavailable = err.message; }
      }
      original.keyTexts ??= current.snapshot.keyTexts;
      retry.stale = current.baseRevisionId !== proposal.baseRevisionId;
      if (!retry.unavailable) comparison = <TermMetadataDiff from={current.snapshot} to={original} />;
      form = { ...common, variant: original.type === "term" ? "edit_term" : "edit_interpreter", pageId: proposal.pageId!, initialMetadata: original, baseRevisionId: current.baseRevisionId };
    } else {
      const state = page ? await getPerspectiveEditingState(page.id) : null;
      const head = state ? { id: state.baseRevisionId, content: state.content } : null;
      if (!head) retry.unavailable ??= "目标页面缺少可编辑修订。";
      retry.stale = Boolean(head && head.id !== proposal.baseRevisionId);
      if (head) comparison = <ContentDiff oldText={head.content} newText={proposal.content} />;
      const targets = state?.linkTargets ?? new Map();
      form = { ...common, variant: "edit", pageId: proposal.pageId!, initialContent: proposal.content, baseRevisionId: head?.id ?? proposal.baseRevisionId!, resolvedWikiLinks: [...targets].filter(([, target]) => target.exists || target.unavailable) };
    }
  } else if (proposal.kind === "new_perspective") {
    const [terms, interpreters, existingPerspectives] = await Promise.all([listTerms(), listInterpreters(), listPerspectivePairs()]);
    const termOptions = terms.map(term => ({ id: term.id, label: term.title }));
    const interpreterOptions = interpreters.map(i => ({ id: i.pageId, label: i.name }));
    if (!termOptions.some(t => t.id === proposal.termId)) { retry.unavailable = "原所属词条不可用。"; termOptions.push({ id: proposal.termId!, label: `不可用词条 #${proposal.termId}` }); }
    if (!interpreterOptions.some(i => i.id === proposal.interpreterId)) { retry.unavailable = `${retry.unavailable ?? ""}原诠释者不可用。`; interpreterOptions.push({ id: proposal.interpreterId!, label: `不可用诠释者 #${proposal.interpreterId}` }); }
    form = { ...common, variant: "new_perspective", terms: termOptions, interpreters: interpreterOptions, presetTermId: proposal.termId, existingPerspectives };
  } else form = { ...common, variant: proposal.kind };
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
    <Link href={`/profile/submissions/${id}`} className="text-sm underline">返回原驳回记录 #{id}</Link>
    <h1 className="my-4 text-2xl font-bold">修改后重新提交</h1>
    {comparison && <section className="mb-6" aria-label="最新版与原提案">
      <h2 className="mb-2 text-xl font-semibold">最新版与原提案</h2>
      <p className="mb-3 text-sm">{retry.stale ? "页面已有新版。请对照下面的最新版与原提案，在表单中人工整理后确认。" : "请结合当前内容修改原提案。"}</p>
      {comparison}
    </section>}
    <SubmissionForm {...form} />
  </main>;
}
