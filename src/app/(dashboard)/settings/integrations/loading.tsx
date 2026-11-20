import { PageFrame } from "@/components/shared/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

/** Integrations list skeleton: heading, then groups of cards. */
export default function IntegrationsLoading() {
  return <PageFrame className="flex flex-col gap-6" aria-label="Загружаем интеграции" aria-busy>
    <Skeleton className="h-10 w-56" />
    {[2, 1].map((n, g) => <div key={g} className="flex flex-col gap-3">
      <Skeleton className="h-5 w-32" />
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-[74px] rounded-lg" />)}</div>
    </div>)}
  </PageFrame>;
}
