"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import { assignInventoryDocument, syncQuickRestoInventory } from "@/app/(dashboard)/inventory/actions";

type DocumentRow = {
  id: string;
  document_number: string;
  invoice_date: string | null;
  status: string;
  processed: boolean;
  assigned_to: string | null;
  shortfall_sum: number | null;
  surplus_sum: number | null;
  results_has_line_amounts: boolean;
  item_count: number;
  store_title: string | null;
  comment: string | null;
};

type StaffRow = {
  id: string;
  name: string;
};

const STATUS_LABEL: Record<string, string> = {
  synced: "Новый",
  assigned: "Назначен",
  in_progress: "В работе",
  ready_for_review: "Готов к проверке",
  processed: "Проведен",
  results_blocked: "Итоги требуют проверки",
  sync_error: "Ошибка синхронизации",
};

// Цвет badge подбирается по статусу — пользователю сразу видно
// в каком акт состоянии (новый/в работе/готов/проблема).
const STATUS_BADGE_CLASS: Record<string, string> = {
  synced:           "bg-slate-100 text-slate-700 border-slate-200",
  assigned:         "bg-blue-50 text-blue-700 border-blue-200",
  in_progress:      "bg-amber-50 text-amber-700 border-amber-200",
  ready_for_review: "bg-violet-50 text-violet-700 border-violet-200",
  processed:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  results_blocked:  "bg-rose-50 text-rose-700 border-rose-200",
  sync_error:       "bg-rose-50 text-rose-700 border-rose-200",
};

export function DocumentsClient({
  documents,
  staff,
  canManage,
  canSync,
  amountRoundingScale,
}: {
  documents: DocumentRow[];
  staff: StaffRow[];
  canManage: boolean;
  canSync: boolean;
  amountRoundingScale: AmountRoundingScale;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const runSync = (scope: "documents" | "full") => {
    startTransition(async () => {
      try {
        const result = await syncQuickRestoInventory({ scope });
        if (result.error || !result.summary) {
          toast.error(result.error ?? "Синхронизация не выполнена");
          return;
        }
        toast.success(
          scope === "documents"
            ? `Синхронизировано актов: ${result.summary.documents}`
            : `Синхронизировано: позиций ${result.summary.products}, актов ${result.summary.documents}`
        );
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Синхронизация не выполнена");
      }
    });
  };

  const assign = (documentId: string, assignedTo: string) => {
    startTransition(async () => {
      try {
        const result = await assignInventoryDocument({
          documentId,
          assignedTo: assignedTo || null,
        });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Назначение обновлено");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Назначение не обновлено");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Акты инвентаризации</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Заполнение мобильного акта идет по строкам продуктов из Quick Resto.
          </p>
        </div>
        {canSync ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-2">Синхронизировать QR</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => runSync("documents")}>
                Только акты
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runSync("full")}>
                Акты, ингредиенты и склады
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border bg-background">
        {/* Колонки: № | Дата | Статус | Склад | Комментарий | Итоги | Назначен | Действие.
            «Строки» убран — счётчик позиций виден на детальной странице
            акта; в общем списке он добавлял шума. Дата и Статус — отдельные
            столбцы. Комментарий — труcate с full-text в title (hover). */}
        <div className="grid grid-cols-[1fr_140px] items-center border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid-cols-[100px_100px_150px_.9fr_1fr_.9fr_180px_160px]">
          <div>№</div>
          <div className="hidden md:block">Дата</div>
          <div className="hidden md:block">Статус</div>
          <div className="hidden md:block">Склад</div>
          <div className="hidden md:block">Комментарий</div>
          <div className="hidden md:block">Итоги</div>
          <div className="hidden md:block">Назначен</div>
          <div className="text-right">Действие</div>
        </div>
        {documents.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Актов пока нет. Синхронизируйте Quick Resto после создания акта.
          </div>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className="grid grid-cols-[1fr_140px] items-center gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[100px_100px_150px_.9fr_1fr_.9fr_180px_160px]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">№ {doc.document_number}</div>
                {/* На mobile (< md) дата и статус остаются под номером,
                    т.к. отдельные колонки скрыты. */}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground md:hidden">
                  <span>{STATUS_LABEL[doc.status] ?? doc.status}</span>
                  {doc.invoice_date ? <span>{new Date(doc.invoice_date).toLocaleDateString("ru-RU")}</span> : null}
                </div>
              </div>
              <div className="hidden text-sm md:block">
                {doc.invoice_date ? new Date(doc.invoice_date).toLocaleDateString("ru-RU") : "—"}
              </div>
              <div className="hidden md:block">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs font-normal",
                    STATUS_BADGE_CLASS[doc.status] ?? "bg-slate-50 text-slate-700 border-slate-200",
                  )}
                >
                  {STATUS_LABEL[doc.status] ?? doc.status}
                </Badge>
              </div>
              <div className="hidden truncate text-sm md:block">{doc.store_title ?? "—"}</div>
              <div
                className="hidden truncate text-sm text-muted-foreground md:block"
                title={doc.comment ?? undefined}
              >
                {doc.comment ?? "—"}
              </div>
              <div className="hidden text-sm md:block">
                {doc.results_has_line_amounts ? (
                  <span>
                    −{formatMoney(Math.abs(doc.shortfall_sum ?? 0), "RUB", amountRoundingScale)} / +{formatMoney(Math.abs(doc.surplus_sum ?? 0), "RUB", amountRoundingScale)}
                  </span>
                ) : (
                  <span className="text-amber-700">Нет построчных итогов</span>
                )}
              </div>
              <div className="hidden md:block">
                {canManage ? (
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60"
                    value={doc.assigned_to ?? ""}
                    disabled={isPending}
                    onChange={(event) => assign(doc.id, event.target.value)}
                  >
                    <option value="">Не назначен</option>
                    {staff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {staff.find((member) => member.id === doc.assigned_to)?.name ?? "—"}
                  </span>
                )}
              </div>
              <div className="flex justify-end gap-2">
                {doc.processed || doc.results_has_line_amounts || doc.status === "results_blocked" ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/documents/${doc.id}/results`}>
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="ml-2">Итоги</span>
                    </Link>
                  </Button>
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/documents/${doc.id}`}>
                    <ClipboardCheck className="h-4 w-4" />
                    <span className="ml-2">Открыть</span>
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
