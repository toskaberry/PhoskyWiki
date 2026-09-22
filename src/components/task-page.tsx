import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * F11 共享任务页骨架：创建／编辑／审核／修订／管理页面统一的
 * 面包屑 → 眉题 → 强标题 → 说明层级（与词条枢纽等阅读页同一视觉语言）。
 */
export function TaskPageHeader({
  breadcrumb,
  kicker,
  title,
  description,
  className,
  children,
}: {
  breadcrumb: { label: string; href?: string }[];
  /** 标题上方的小字眉题，说明当前任务类别。 */
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn("border-b border-border pb-8", className)}>
      <nav
        aria-label="面包屑"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
      >
        {breadcrumb.map((item, index) => (
          <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-2">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <Link
                href={item.href}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="min-w-0 [overflow-wrap:anywhere]">
                {item.label}
              </span>
            )}
          </span>
        ))}
      </nav>
      {kicker && <p className="mt-6 text-sm text-muted-foreground">{kicker}</p>}
      <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{title}</h1>
      {description != null && (
        <div className="mt-4 max-w-3xl space-y-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}
      {children}
    </header>
  );
}

/** 任务页内的区块标题：细分隔线 + 标题 + 说明。 */
export function TaskSectionHeading({
  title,
  description,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("border-t border-border pt-6", className)}>
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {description != null && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

const chipTones = {
  neutral: "bg-secondary text-secondary-foreground",
  outline: "border border-border text-muted-foreground",
  accent: "bg-accent text-accent-foreground",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-destructive/10 text-destructive",
} as const;

/** 提交类型、状态、票数等小标签；仅表达状态，不承担交互。 */
export function StatusChip({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: keyof typeof chipTones }) {
  return (
    <span
      data-slot="status-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-5",
        chipTones[tone],
        className,
      )}
      {...props}
    />
  );
}

const calloutTones = {
  neutral: "border-border bg-muted/40 text-foreground",
  warning: "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

/** 驳回理由、冲突、失败等需要注意的提示框。 */
export function Callout({
  tone = "neutral",
  title,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { tone?: keyof typeof calloutTones; title?: ReactNode }) {
  return (
    <div
      data-slot="callout"
      className={cn("rounded-md border p-3 text-sm leading-relaxed", calloutTones[tone], className)}
      {...props}
    >
      {title != null && <p className="font-medium">{title}</p>}
      {title != null && children != null && <div className="mt-1">{children}</div>}
      {title == null && children}
    </div>
  );
}

/** 未登录访问任务页的统一提示：说明当前任务 + 登录／注册入口（保留来路由页面自带）。 */
export function LoginRequired({
  title,
  description,
  next,
}: {
  title: string;
  description?: ReactNode;
  next?: string;
}) {
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <Callout tone="neutral" className="mt-8 max-w-xl">
      <p className="font-medium">{title}</p>
      {description != null && (
        <p className="mt-1 leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href={`/login${suffix}`}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          登录
        </Link>
        <Link
          href={`/register${suffix}`}
          className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          注册
        </Link>
      </div>
    </Callout>
  );
}
