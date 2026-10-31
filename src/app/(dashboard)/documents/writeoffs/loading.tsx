import { PageFrame } from "@/components/shared/page-frame";
export default function Loading() {
  return (
    <PageFrame aria-label="Загружаем списания" className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-10 animate-pulse rounded bg-muted" />
      <div className="h-80 animate-pulse rounded-lg border bg-muted/30" />
    </PageFrame>
  );
}
