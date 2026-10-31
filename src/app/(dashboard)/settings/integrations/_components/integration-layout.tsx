"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
export function IntegrationStatus({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "warning" | "neutral" }) {
  return <Badge variant="outline" className={cn("shrink-0 whitespace-nowrap rounded-full font-normal",
    tone === "success" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    tone === "warning" && "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400")}>{children}</Badge>;
}
export function IntegrationLayout({ title, description, status, children, actions, root = false }: {
  title: string; description: string; status?: ReactNode; children: ReactNode; actions?: ReactNode; root?: boolean;
}) {
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
    <PageBreadcrumb><nav aria-label="Навигация по разделам" className="flex min-w-0 items-center gap-2 text-sm">
      {root ? <span className="text-muted-foreground">Настройки</span> : <Link href="/settings/integrations" className="text-muted-foreground hover:text-foreground">Интеграции</Link>}<span className="text-muted-foreground" aria-hidden="true">/</span><span className="truncate">{title}</span>
    </nav></PageBreadcrumb>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{title}</h1>{status}</div><p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p></div>
      {actions}
    </header>
    {children}
  </div>;
}
export function IntegrationSection({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1"><h2 className="text-base font-semibold">{title}</h2>{description ? <p className="text-sm leading-6 text-muted-foreground">{description}</p> : null}</div>{actions}</header>
    {children}
  </section>;
}
export function IntegrationNotice({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-muted-foreground">{children}</p>;
}
