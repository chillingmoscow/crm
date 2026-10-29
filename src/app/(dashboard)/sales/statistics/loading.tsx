import { PageFrame } from "@/components/shared/page-frame";

export default function Loading() {
  return (
    <PageFrame
      className="space-y-6"
      role="status"
      aria-label="Загружаем статистику"
    >
      <div className="h-9 w-48 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
      <div className="h-28 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />
      <div className="h-72 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />
    </PageFrame>
  );
}
