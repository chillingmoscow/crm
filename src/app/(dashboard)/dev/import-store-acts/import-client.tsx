"use client";

import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { ProfileSection } from "@/components/shared/profile-section";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { formatDateCell } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { parseProductIds } from "@/lib/stock-count/import-plan";

import {
  previewStoreActsImport,
  runStoreActsImport,
  type StoreActRow,
  type StoreActsImportResult,
  type StoreActsPreview,
} from "./actions";

type Query = { storeId: string; from: string; allowedProductIds: number[] };

const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });

/** «октябрь 2026» из `2026-10`. */
function formatMonth(month: string): string {
  return monthName.format(new Date(`${month}-01T12:00:00Z`)).replace(/\s*г\.$/, "");
}

export function ImportStoreActsClient({
  stores,
  defaultStoreId,
  defaultFrom,
  defaultProductIds,
}: {
  stores: Array<{ id: string; title: string }>;
  defaultStoreId: string;
  defaultFrom: string;
  defaultProductIds: string;
}) {
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [from, setFrom] = useState(defaultFrom);
  const [productIdsText, setProductIdsText] = useState(defaultProductIds);
  const [productIdsError, setProductIdsError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ query: Query; data: StoreActsPreview } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<StoreActsImportResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [importing, startImporting] = useTransition();

  const readQuery = (): Query | null => {
    const parsed = parseProductIds(productIdsText);
    if ("error" in parsed) {
      setProductIdsError(parsed.error);
      return null;
    }
    setProductIdsError(null);
    if (!storeId) {
      setLoadError("Выберите склад");
      return null;
    }
    if (!from) {
      setLoadError("Укажите дату начала");
      return null;
    }
    return { storeId, from, allowedProductIds: parsed.ids };
  };

  const load = (query: Query) =>
    startLoading(async () => {
      const response = await previewStoreActsImport(query);
      if (response.ok) {
        setPreview({ query, data: response.data });
        setLoadError(null);
      } else {
        setLoadError(response.error);
      }
    });

  const onPreview = () => {
    const query = readQuery();
    if (!query) return;
    setResult(null);
    load(query);
  };

  const onImport = () => {
    if (!preview) return;
    const { query, data } = preview;
    startImporting(async () => {
      const response = await runStoreActsImport({
        ...query,
        externalIds: data.toImport.map((row) => row.externalId),
      });
      if (!response.ok) {
        setImportError(response.error);
        return;
      }
      setImportError(null);
      setConfirmOpen(false);
      setResult(response.data);
      load(query);
    });
  };

  // Предпросмотр относится к параметрам, с которыми его получили: изменили
  // поля — загружать по старому списку нельзя.
  const typedIds = parseProductIds(productIdsText);
  const stale =
    preview !== null &&
    (preview.query.storeId !== storeId ||
      preview.query.from !== from ||
      preview.query.allowedProductIds.join(",") !== ("ids" in typedIds ? typedIds.ids.join(",") : ""));
  const toImportCount = preview && !stale ? preview.data.toImport.length : 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ProfileSection
        title="Что загрузить"
        description="Проведённые акты склада из Quick Resto, в которых нет ничего, кроме перечисленных позиций. Акты, которые уже есть в Sheerly, не загружаются и не дублируются при повторном запуске."
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Склад">
            {(control) => (
              <OptionSelect
                {...control}
                value={storeId}
                onValueChange={setStoreId}
                options={stores.map((store) => ({ value: store.id, label: store.title }))}
                placeholder="Выберите склад"
              />
            )}
          </Field>
          <Field label="С даты">
            {(control) => <DatePicker {...control} value={from} onChange={setFrom} clearable={false} />}
          </Field>
          <Field
            label="Позиции Quick Resto"
            className="sm:col-span-2"
            hint="Номера через запятую. По умолчанию — табак «Стандарт», «Премиум», «Парфюм»"
            error={productIdsError}
          >
            {(control) => (
              <Input
                {...control}
                value={productIdsText}
                onChange={(event) => setProductIdsText(event.target.value)}
                inputMode="numeric"
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={toImportCount > 0 ? "outline" : "default"}
            onClick={onPreview}
            disabled={loading || importing}
            className="h-10"
          >
            {loading ? "Получаем акты…" : preview ? "Обновить список" : "Показать акты"}
          </Button>
          {toImportCount > 0 ? (
            <Button onClick={() => setConfirmOpen(true)} disabled={loading || importing} className="h-10">
              {`Загрузить ${countRu(toImportCount, "акт", "акта", "актов")}`}
            </Button>
          ) : null}
        </div>
        {stale ? (
          <p className="text-[13px] text-muted-foreground">Параметры изменились — обновите список перед загрузкой</p>
        ) : null}
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : null}
      </ProfileSection>

      {result ? <ImportResult result={result} /> : null}

      {preview ? (
        <>
          <ProfileSection title={`Будет загружено · ${preview.data.toImport.length}`}>
            {preview.data.toImport.length > 0 ? (
              <ActsTable rows={preview.data.toImport} />
            ) : (
              <p className="text-sm text-muted-foreground">Новых актов нет</p>
            )}
          </ProfileSection>
          <ProfileSection title={`Пропущено · ${preview.data.skipped.length}`}>
            {preview.data.skipped.length > 0 ? (
              <ActsTable rows={preview.data.skipped} withReason />
            ) : (
              <p className="text-sm text-muted-foreground">Пропущенных актов нет</p>
            )}
            {preview.data.earlierCount > 0 ? (
              <p className="text-[13px] text-muted-foreground">
                {`Ещё ${countRu(preview.data.earlierCount, "акт", "акта", "актов")} склада раньше даты начала — не показаны`}
              </p>
            ) : null}
          </ProfileSection>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setImportError(null);
        }}
        title={`Загрузить ${countRu(toImportCount, "акт", "акта", "актов")}?`}
        description="Итоги актов зафиксируются как проведённые. В Quick Resto акты не меняются. Удержание за месяцы актов потом нужно пересчитать."
        confirmLabel={`Загрузить ${countRu(toImportCount, "акт", "акта", "актов")}`}
        pendingLabel="Загружаем…"
        busy={importing}
        confirmDisabled={toImportCount === 0}
        error={importError}
        onConfirm={onImport}
      />
    </div>
  );
}

function ImportResult({ result }: { result: StoreActsImportResult }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {result.imported > 0 ? (
        <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <p>
            {`Загружено ${countRu(result.imported, "акт", "акта", "актов")}. Пересчитайте удержание за затронутые месяцы: «Зарплата → Добавить → Пересчитать недостачу за месяц»`}
          </p>
          {result.months.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {result.months.map((month) => (
                <li key={month}>{formatMonth(month)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {result.failed.length > 0 ? (
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p>{`Не загружено: ${countRu(result.failed.length, "акт", "акта", "актов")}`}</p>
          <ul className="mt-2 list-disc pl-5">
            {result.failed.map((row) => (
              <li key={row.externalId} className="break-words">
                {`${row.number ?? `Акт ${row.externalId}`}: ${row.error}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ActsTable({ rows, withReason = false }: { rows: Array<StoreActRow & { reason?: string }>; withReason?: boolean }) {
  return (
    <div className="rounded-lg border">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: withReason ? "16%" : "18%" }} />
          <col style={{ width: withReason ? "16%" : "18%" }} />
          <col style={{ width: withReason ? "24%" : "32%" }} />
          <col style={{ width: withReason ? "14%" : "16%" }} />
          <col style={{ width: withReason ? "14%" : "16%" }} />
          {withReason ? <col style={{ width: "16%" }} /> : null}
        </colgroup>
        <thead className="sticky top-0 z-20 [&_th]:bg-muted">
          <tr className="text-left text-xs font-medium text-muted-foreground">
            <th className="truncate px-3 py-2 font-medium">Номер</th>
            <th className="truncate px-3 py-2 font-medium">Дата</th>
            <th className="truncate px-3 py-2 font-medium">Комментарий</th>
            <th className="truncate px-3 py-2 text-right font-medium">Недостача</th>
            <th className="truncate px-3 py-2 text-right font-medium">Излишек</th>
            {withReason ? <th className="truncate px-3 py-2 font-medium">Почему</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.externalId} className="border-t">
              <td className="overflow-hidden px-3 py-2">
                <span className="block truncate">{row.number}</span>
              </td>
              <td className="overflow-hidden px-3 py-2 tabular-nums">
                <span className="block truncate">{formatDateCell(row.date) ?? "—"}</span>
              </td>
              <td className="overflow-hidden px-3 py-2">
                <span className="block truncate" data-tip={row.comment ?? undefined}>
                  {row.comment ?? "—"}
                </span>
              </td>
              <td className="overflow-hidden px-3 py-2 text-right">
                <Money value={row.shortfallSum} />
              </td>
              <td className="overflow-hidden px-3 py-2 text-right">
                <Money value={row.surplusSum} />
              </td>
              {withReason ? (
                <td className="overflow-hidden px-3 py-2">
                  <span className="block truncate" data-tip={row.reason}>
                    {row.reason}
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
