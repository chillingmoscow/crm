"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { cn } from "@/lib/utils";
import { IntegrationLogo, type IntegrationProvider } from "./integration-logo";

export type IntegrationTone = "success" | "warning" | "neutral";

export function IntegrationStatus({ children, tone = "neutral" }: { children: ReactNode; tone?: IntegrationTone }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
    tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    tone === "neutral" && "bg-muted/60 text-muted-foreground")}>
    <span aria-hidden="true" className={cn("size-1.5 rounded-full", tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : "bg-muted-foreground/50")} />
    {children}
  </span>;
}

export function IntegrationLayout({ title, description, provider, status, children, actions, root = false }: {
  title: string; description: string; provider?: IntegrationProvider; status?: ReactNode; children: ReactNode; actions?: ReactNode; root?: boolean;
}) {
  return <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
    <PageBreadcrumb><nav aria-label="Навигация по разделам" className="flex min-w-0 items-center gap-2 text-sm">
      {root ? <span className="text-muted-foreground">Настройки</span> : <Link href="/settings/integrations" className="text-muted-foreground hover:text-foreground">Интеграции</Link>}<span className="text-muted-foreground" aria-hidden="true">/</span><span className="truncate">{title}</span>
    </nav></PageBreadcrumb>
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {provider ? <IntegrationLogo provider={provider} size="lg" /> : null}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3"><h1 className={cn("font-bold tracking-tight", root ? "text-3xl" : "text-2xl")}>{title}</h1>{status}</div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
    {children}
  </div>;
}

export function IntegrationSection({ title, description, actions, children, id, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return <section id={id} aria-label={title} className={cn("scroll-mt-20 space-y-4 rounded-[14px] border bg-card p-4 sm:p-5", className)}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h2 className="text-base font-semibold">{title}</h2>{description ? <p className="text-[13px] leading-5 text-muted-foreground">{description}</p> : null}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
    {children}
  </section>;
}

/** Problem that needs a person: short text and one action. */
export function IntegrationCallout({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div role="status" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-amber-500/30 bg-amber-500/10 px-4 py-3 dark:bg-amber-500/15">
    <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
    <p className="min-w-0 flex-1 text-sm">{children}</p>
    {action}
  </div>;
}

/** Label/value rows for a read-only summary. */
export function IntegrationFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="divide-y text-sm">{items.map(item => <div key={item.label} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
    <dt className="text-muted-foreground">{item.label}</dt><dd className="min-w-0 break-words">{item.value}</dd>
  </div>)}</dl>;
}

export function IntegrationNotice({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-5 text-muted-foreground">{children}</p>;
}
