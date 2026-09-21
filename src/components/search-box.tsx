"use client";

// 全站搜索框（T10）：即打即搜联想（200ms 防抖 + AbortController 取消过期请求），
// 回车进 /search 结果页，点选/键盘选中直达命中页。无 JS 时表单 GET 降级仍可用。

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SEARCH_TYPE_LABELS,
  searchHitHref,
  type SearchHit,
} from "@/lib/search/search-types";

/** 联想项 = 命中页的最小信息（下拉只展示标题与类型徽标）。 */
type Suggestion = Pick<SearchHit, "pageId" | "type" | "title" | "slug">;

export function SearchBox({
  initialQuery = "",
  autoFocus = false,
  size = "sm",
}: {
  initialQuery?: string;
  autoFocus?: boolean;
  /** sm = 页头；lg = 首页 / 搜索页主入口 */
  size?: "sm" | "lg";
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const trimmed = query.trim();
  const showDropdown = open && suggestions.length > 0 && trimmed.length > 0;

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions: Suggestion[] };
        setSuggestions(data.suggestions);
        setActiveIndex(-1);
        // Results may arrive after a facet click or Escape. Only user input/focus
        // opens the list; a late response must not reopen it over search results.
      } catch {
        // 过期请求被 abort 或网络失败：维持现状即可
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function goToSearch() {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  function pick(suggestion: Suggestion) {
    setOpen(false);
    router.push(searchHitHref(suggestion));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && showDropdown) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && showDropdown) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (showDropdown && activeIndex >= 0 && suggestions[activeIndex]) {
        pick(suggestions[activeIndex]);
      } else {
        goToSearch();
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={boxRef}
      className="relative"
      role="combobox"
      aria-expanded={showDropdown}
      aria-controls={showDropdown ? listId : undefined}
      aria-haspopup="listbox"
    >
      <form className="relative" role="search" action="/search" method="get" onSubmit={(event) => { event.preventDefault(); goToSearch(); }}>
        <input
          name="q"
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => {
            setQuery(event.target.value);
            setSuggestions([]);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="搜索词条 / 诠释者 / 视角…"
          aria-label="全站搜索"
          data-testid="search-input"
          className={
            size === "lg"
              ? "w-full rounded-lg border border-input bg-background py-4 pl-4 pr-20 text-base shadow-sm outline-none focus:border-ring sm:py-5 sm:pl-5 sm:text-lg"
              : "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
          }
        />
        {size === "lg" && <button type="submit" className="absolute inset-y-2 right-2 rounded-md bg-foreground px-4 text-sm text-background hover:opacity-80">搜索</button>}
      </form>
      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          data-testid="search-suggestions"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-background shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.type}-${suggestion.pageId}`} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onClick={() => pick(suggestion)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                  index === activeIndex ? "bg-muted" : ""
                }`}
              >
                <span className="min-w-0 break-words">{suggestion.title}</span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {SEARCH_TYPE_LABELS[suggestion.type]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
