"use client";

// 兴趣标签管理（T12）：三类兴趣（诠释者/学派/主题）的选择界面，双路径——
//   游客：改动即写 localStorage（不注册也有体验，用户故事 22）；
//   登录：本浏览器此前的本地兴趣并入预选，「保存到账号」PUT /api/interests
//   全量替换，并把结果镜像回 localStorage（登出后本设备仍是同一份，
//   用户故事 23「随账号同步」）。
// 本地兴趣经 useGuestInterests 读取（外部存储快照，水合后可用）；
// 账号编辑优先于快照；游客成功写入后继续订阅，以响应后续跨标签页修改。

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { persistGuestInterests, useGuestInterests } from "@/lib/guest-interest-store";
import {
  EMPTY_INTEREST_SET,
  mergeInterestSets,
  sameInterestSet,
  type InterestSet,
} from "@/lib/interest-tags";

export interface InterestOption {
  id: number;
  label: string;
  /** 辅助说明（主题 chip 的上级分类），计入 label 可访问名 */
  note?: string;
}

export interface InterestTagManagerProps {
  mode: "guest" | "account";
  interpreters: InterestOption[];
  schools: InterestOption[];
  categories: InterestOption[];
  /** account 模式：服务端读到的账号兴趣（已过滤在线目标）；guest 模式省略 */
  accountInterests?: InterestSet;
}

type InterestKind = "interpreters" | "schools" | "categories";

export function InterestTagManager({
  mode,
  interpreters,
  schools,
  categories,
  accountInterests,
}: InterestTagManagerProps) {
  const isAccount = mode === "account";
  const stored = useGuestInterests();
  const [edited, setEdited] = useState<InterestSet | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // 登录路径的预选 = 账号兴趣 ∪ 本地兴趣（「随账号同步」的带入面）
  const mergedBase = useMemo(
    () =>
      isAccount && stored
        ? mergeInterestSets(accountInterests ?? EMPTY_INTEREST_SET, stored)
        : null,
    [isAccount, accountInterests, stored],
  );
  const selected = edited ?? (isAccount ? (mergedBase ?? accountInterests ?? EMPTY_INTEREST_SET) : (stored ?? EMPTY_INTEREST_SET));
  const importedLocal =
    edited === null &&
    mergedBase !== null &&
    accountInterests !== undefined &&
    !sameInterestSet(accountInterests, mergedBase);

  function toggle(kind: InterestKind, id: number) {
    const list = selected[kind];
    const next: InterestSet = {
      ...selected,
      [kind]: list.includes(id) ? list.filter((value) => value !== id) : [...list, id],
    };
    setEdited(next);
    setSavedAt(null);
    if (!isAccount) {
      // 游客即改即存，无保存按钮
      const saved = persistGuestInterests(next);
      if (saved) setEdited(null);
      setError(saved ? null : "浏览器无法保存兴趣，当前选择暂留本页。请允许本地存储后重试。");
    }
  }

  async function saveToAccount() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/interests", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selected),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "保存失败，请稍后再试");
      }
      const data = (await res.json()) as { interests: InterestSet };
      setEdited(data.interests);
      setSavedAt(new Date().toLocaleTimeString());
      // 镜像到本浏览器：登出后本设备仍保留同一份（下次登录也以此为并入基线）
      persistGuestInterests(data.interests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <ChipGroup
        legend="诠释者"
        hint="所选诠释者的视角在词条下排前"
        options={interpreters}
        selectedIds={selected.interpreters}
        onToggle={(id) => toggle("interpreters", id)}
      />
      <ChipGroup
        legend="学派"
        hint="成员诠释者的视角一并排前"
        options={schools}
        selectedIds={selected.schools}
        onToggle={(id) => toggle("schools", id)}
      />
      <ChipGroup
        legend="主题（分类）"
        hint="兴趣所在分类的词条优先出现在相关词条推荐"
        options={categories}
        selectedIds={selected.categories}
        onToggle={(id) => toggle("categories", id)}
      />

      {isAccount ? (
        <div className="flex flex-col gap-2 border-t border-border pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={saveToAccount} disabled={pending} aria-busy={pending}>
              {pending ? "保存中…" : "保存到账号"}
            </Button>
            {savedAt && (
              <span data-testid="interest-saved" className="text-sm text-muted-foreground">
                已保存 {savedAt}
              </span>
            )}
            {error && (
              <span data-testid="interest-error" role="alert" className="text-sm text-destructive">
                {error}
              </span>
            )}
          </div>
          {importedLocal && (
            <p data-testid="interest-import-hint" className="text-sm text-muted-foreground">
              已带入本浏览器此前的本地兴趣，保存后即同步到账号。
            </p>
          )}
        </div>
      ) : (
        <div className="border-t border-border pt-6">
          <p data-testid="guest-storage-hint" className="text-sm text-muted-foreground">
            改动即保存在本浏览器；
            <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
              登录
            </Link>
            后可同步到账号。
          </p>
          {error && <p role="status" className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ChipGroup({
  legend,
  hint,
  options,
  selectedIds,
  onToggle,
}: {
  legend: string;
  hint: string;
  options: InterestOption[];
  selectedIds: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <fieldset>
      <legend className="text-base font-semibold">
        {legend}
        <span className="ml-3 font-normal text-muted-foreground">{hint}</span>
      </legend>
      {options.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">暂无可选项。</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {options.map((option) => {
            const checked = selectedIds.includes(option.id);
            return (
              <li key={option.id}>
                <label
                  className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${
                    checked
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(option.id)}
                    className={`h-3.5 w-3.5 ${checked ? "accent-background" : "accent-foreground"}`}
                  />
                  {option.label}
                  {option.note && <span className="text-xs opacity-70">（{option.note}）</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
