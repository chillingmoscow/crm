import type { ReactNode } from "react";
import { TablePageHeader } from "@/components/shared/table";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";

/** Шапка списка раздела «Люди»: крошки «Люди / Страница» и общая шапка списка. */
export function PeopleListHeader({
  title,
  crumb = title,
  count,
  actions,
}: {
  title: string;
  /** Название страницы в крошках, если оно отличается от заголовка. */
  crumb?: string;
  count: number | string;
  actions: ReactNode;
}) {
  return (
    <>
      <Breadcrumbs items={[{ label: "Люди" }, { label: crumb }]} />
      <TablePageHeader title={title} count={count} actions={actions} />
    </>
  );
}
