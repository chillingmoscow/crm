"use client";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection } from "@/components/shared/profile-section";
import { StatusBadge } from "@/components/ui/status-badge";
import { IntegrationLogo, type IntegrationProvider } from "./integration-logo";

export type IntegrationTone = "success" | "warning" | "neutral";

export function IntegrationStatus({ children, tone = "neutral" }: { children: ReactNode; tone?: IntegrationTone }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}

/**
 * Integration screen as an entity card (DS «Entity detail page»): 720px column,
 * breadcrumbs «Настройки / Интеграции / Name», logo 56px, name 28px, status and context in the grey line.
 */
export function IntegrationLayout({ title, provider, status, context, children, actions }: {
  title: string; provider: IntegrationProvider; status?: ReactNode; context?: ReactNode; children: ReactNode; actions?: ReactNode;
}) {
  return <ProfilePageFrame>
    <Breadcrumbs items={[{ label: "Настройки" }, { label: "Интеграции", href: "/settings/integrations" }, { label: title }]} />
    <ProfileHeader name={title} avatar={<IntegrationLogo provider={provider} size="lg" />} actions={actions}>
      {status}
      {context ? <span className="text-sm text-muted-foreground">{context}</span> : null}
    </ProfileHeader>
    {children}
  </ProfilePageFrame>;
}

/** `ProfileSection` with an anchor for links like `#undelivered`. */
export function IntegrationSection({ id, ...props }: { id?: string; title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <div id={id} className="scroll-mt-24"><ProfileSection {...props} /></div>;
}

/** Inline warning (DS «Состояния»): one sentence and at most one action. */
export function IntegrationWarning({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
    <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
    <p className="min-w-0 flex-1">{children}</p>
    {action}
  </div>;
}

/** Read mode of a section (DS «Секции карточки»): grey 13px label, 14px value. */
export function IntegrationFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="divide-y">{items.map(item => <div key={item.label} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
    <dt className="text-[13px] text-muted-foreground">{item.label}</dt><dd className="min-w-0 break-words text-sm">{item.value}</dd>
  </div>)}</dl>;
}

export function IntegrationNotice({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}
