"use client";

import type { KeyText, KeyTextValidationError } from "@/lib/key-texts";

export function KeyTexts({ items }: { items: KeyText[] }) {
  if (!items.length) return null;
  return <ol className="list-decimal space-y-2 pl-4">{items.map((item, index) => <li key={index}>
    {item.url ? <a href={item.url} className="underline">{item.title}</a> : item.title}
    {item.author && <span> · {item.author}</span>}{item.year && <span>（{item.year}）</span>}
  </li>)}</ol>;
}

// F11：关键文本按「条目卡片」组织，字段对齐、操作靠近条目；
// 标签与 aria-label 保持既有名称（tests 以「作品名 1」等定位）。
export function KeyTextsEditor({ value, onChange, error }: { value: KeyText[]; onChange: (value: KeyText[]) => void; error?: KeyTextValidationError }) {
  const fields = [['title', '作品名'], ['author', '作者'], ['year', '年份'], ['url', '作品链接']] as const;
  const actionButton = "min-h-9 rounded border border-border px-2.5 text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";
  return <fieldset className="rounded-lg border border-border p-4">
    <legend className="px-1 text-sm font-medium">关键文本（可选）</legend>
    <p className="text-xs text-muted-foreground">词条或诠释者的代表作品，按阅读顺序排列。</p>
    <div className="mt-3 flex flex-col gap-3">
      {value.map((item, index) => <div key={index} className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([field, label]) => {
            const invalid = error?.index === index && error.field === field;
            const errorId = `key-text-${index}-${field}-error`;
            return <label key={field} className="flex flex-col gap-1 text-sm">
              {label}
              <input
                aria-label={`${label} ${index + 1}`}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                value={item[field] ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                onChange={e => onChange(value.map((row, i) => i === index ? { ...row, [field]: e.target.value } : row))}
              />
              {invalid && <span id={errorId} role="alert" data-testid="form-error" className="text-sm text-destructive">{error.message}</span>}
            </label>;
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={actionButton} disabled={index === 0} onClick={() => { const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}>上移</button>
          <button type="button" className={actionButton} onClick={() => onChange(value.filter((_, i) => i !== index))}>移除作品 {index + 1}</button>
        </div>
      </div>)}
    </div>
    <button type="button" className="mt-3 min-h-11 rounded-md border border-border px-3 text-sm transition-colors hover:bg-muted" onClick={() => onChange([...value, { title: "" }])}>添加作品</button>
  </fieldset>;
}
