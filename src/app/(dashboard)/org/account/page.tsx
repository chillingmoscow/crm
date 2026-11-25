import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";

export const metadata: Metadata = { title: "Аккаунт" };

export default function AccountSettingsPage() {
  return (
    <PageFrame className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Организация" }, { label: "Аккаунт" }]} />
      <TablePageHeader title="Аккаунт" />
      <p className="text-sm text-muted-foreground">Раздел в разработке</p>
    </PageFrame>
  );
}
