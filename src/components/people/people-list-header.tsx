import type { ReactNode } from "react";
import { TablePageHeader } from "@/components/shared/table";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";

export function PeopleListHeader({
  title,
  description,
  count,
  actions,
}: {
  title: string;
  description: string;
  count: number;
  actions: ReactNode;
}) {
  return (
    <>
      <PageBreadcrumb>
        <nav
          aria-label="Навигация по разделам"
          className="flex min-w-0 items-center gap-2 text-sm"
        >
          <span className="text-muted-foreground">Люди</span>
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="truncate">{title}</span>
        </nav>
      </PageBreadcrumb>
      <TablePageHeader
        className="md:flex-wrap md:items-center [&>div:last-child]:max-w-full"
        title={
          <span className="inline-flex items-center gap-3">
            {title}
            <span
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-muted px-2 text-sm font-normal tabular-nums text-muted-foreground"
              aria-label={`Всего: ${count}`}
            >
              {count}
            </span>
          </span>
        }
        subtitle={description}
        actions={actions}
      />
    </>
  );
}
