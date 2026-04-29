import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities } from "@/lib/org/legal-entities";
import { Button } from "@/components/ui/button";

const LEGAL_FORM_LABELS: Record<string, string> = {
  IP:    "ИП",
  OOO:   "ООО",
  AO:    "АО",
  PAO:   "ПАО",
  NKO:   "НКО",
  OTHER: "Иное",
};

export default async function LegalEntitiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Page guard: any account-member with org.view_legal_entities can see
  // the list. Mutations are gated separately by RLS.
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "org.view_legal_entities",
  });
  if (!canView) redirect("/dashboard");

  const { rows } = await listLegalEntities();

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Юридические лица</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Юрлица аккаунта: ИП, ООО, АО. К одному юрлицу могут быть привязаны
            несколько заведений.
          </p>
        </div>
        <Button asChild>
          <Link href="/org/legal-entities/new">
            <Plus className="mr-2 h-4 w-4" />
            Создать юрлицо
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Юрлиц пока нет. Создайте первое — данные подтянутся из DaData по ИНН.
          </p>
          <Button asChild>
            <Link href="/org/legal-entities/new">
              <Plus className="mr-2 h-4 w-4" />
              Создать юрлицо
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border border-border bg-background">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/org/legal-entities/${row.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{row.name}</span>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {LEGAL_FORM_LABELS[row.legal_form] ?? row.legal_form}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {row.inn ? `ИНН ${row.inn}` : "ИНН не указан"}
                    {row.kpp ? ` • КПП ${row.kpp}` : ""}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {row.dadata_synced_at
                    ? `DaData ${new Date(row.dadata_synced_at).toLocaleDateString("ru-RU")}`
                    : "вручную"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
