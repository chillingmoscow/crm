"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { CategoryPicker } from "@/components/finance/category-picker";
import { CounterpartyPicker } from "@/components/finance/counterparty-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { bulkUpdateTransactions } from "@/lib/finance/transactions";
import { countRu } from "@/lib/format/plural";
import type { AccountVenueRow } from "@/lib/org/legal-entities";
import type {
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionRow,
} from "@/types/finance";

type FieldKey = "category_id" | "counterparty_id" | "venue_id";

const FIELD_LABEL: Record<FieldKey, string> = {
  category_id: "Статья",
  counterparty_id: "Контрагент",
  venue_id: "Заведение",
};

/**
 * Массовая правка выбранных операций: статья, контрагент или заведение.
 * Диалог сразу говорит, у скольких операций значение поменяется и какие
 * пропустятся (переводы, чужие без права на правку, операции другого
 * типа), а при невозможности — почему кнопка выключена.
 */
export function BulkEditDialog({
  open,
  onOpenChange,
  selected,
  editable,
  categories,
  counterparties,
  venues,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: TransactionRow[];
  /** Выбранные, которые пользователь вправе править. */
  editable: TransactionRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  venues: AccountVenueRow[];
  onDone: () => void;
}) {
  const [field, setField] = useState<FieldKey>("category_id");
  const [value, setValue] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setField("category_id");
    setValue(null);
    setChosen(false);
    setError(null);
  }, [open]);

  // Статья и контрагент бывают только у прихода и расхода.
  const targets = useMemo(
    () => (field === "venue_id" ? editable : editable.filter((tx) => tx.type !== "transfer")),
    [editable, field],
  );
  const types = new Set(targets.map((tx) => tx.type));
  const categoryType =
    field === "category_id" && types.size === 1 ? (targets[0]?.type as "income" | "expense") : undefined;

  const skippedTransfers =
    field === "venue_id" ? 0 : editable.filter((tx) => tx.type === "transfer").length;
  const skippedForeign = selected.length - editable.length;

  const restriction =
    targets.length === 0
      ? editable.length === 0
        ? "Среди выбранных нет операций, которые вы можете изменить"
        : "У переводов нет статьи и контрагента. Выберите приходы или расходы"
      : field === "category_id" && types.size > 1
        ? "Выбраны и приходы, и расходы, а статьи у них разные. Отберите операции одного типа (фильтр «Тип»)"
        : null;

  const notes = [
    skippedTransfers
      ? `${countRu(skippedTransfers, "перевод", "перевода", "переводов")} не изменятся: у них нет этого поля`
      : null,
    skippedForeign
      ? `${countRu(skippedForeign, "чужая операция", "чужие операции", "чужих операций")} не изменятся: нет прав на правку`
      : null,
  ].filter(Boolean);

  const apply = async () => {
    setBusy(true);
    setError(null);
    const result = await bulkUpdateTransactions(
      targets.map((tx) => tx.id),
      { field, value },
    ).catch(() => ({
      updated: 0,
      skipped: targets.length,
      error: "Нет связи с сервером. Проверьте соединение и повторите",
    }));
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast.success(
      result.skipped > 0
        ? `Изменено: ${result.updated} из ${targets.length}. Остальные изменить нельзя: связаны с зарплатой или нет прав`
        : `Изменено: ${countRu(result.updated, "операция", "операции", "операций")}`,
    );
    onDone();
  };

  const fieldOptions = (Object.keys(FIELD_LABEL) as FieldKey[])
    .filter((key) => key !== "venue_id" || venues.length > 0)
    .map((key) => ({ value: key, label: FIELD_LABEL[key] }));

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={`Изменить ${countRu(selected.length, "операцию", "операции", "операций")}`}
      description={
        restriction
          ? undefined
          : `Новое значение получат ${countRu(targets.length, "операция", "операции", "операций")}.${notes.length ? ` ${notes.join(". ")}.` : ""}`
      }
      restriction={restriction}
      confirmLabel={`Изменить · ${targets.length}`}
      pendingLabel="Сохраняем…"
      busy={busy}
      confirmDisabled={!chosen}
      error={error}
      onConfirm={() => void apply()}
    >
      <div className="grid gap-4">
        <Field label="Что изменить">
          {(control) => (
            <OptionSelect
              {...control}
              value={field}
              onValueChange={(next) => {
                setField(next as FieldKey);
                setValue(null);
                setChosen(false);
                setError(null);
              }}
              options={fieldOptions}
            />
          )}
        </Field>
        <Field label="Новое значение">
          {(control) =>
            field === "category_id" ? (
              <CategoryPicker
                categories={categories.filter((c) => !c.archived_at)}
                value={value}
                onChange={(next) => {
                  setValue(next);
                  setChosen(true);
                }}
                type={categoryType}
                placeholder="Выберите статью"
                ariaLabel="Новая статья"
                disabled={!!restriction}
              />
            ) : field === "counterparty_id" ? (
              <CounterpartyPicker
                counterparties={counterparties.filter((c) => !c.deleted_at)}
                value={value}
                onChange={(next) => {
                  setValue(next);
                  setChosen(true);
                }}
                placeholder="Выберите контрагента"
                allowClear
                ariaLabel="Новый контрагент"
                disabled={!!restriction}
              />
            ) : (
              <OptionSelect
                {...control}
                value={chosen ? (value ?? "__none__") : ""}
                onValueChange={(next) => {
                  setValue(next === "__none__" ? null : next);
                  setChosen(true);
                }}
                placeholder="Выберите заведение"
                options={[
                  ...venues.map((v) => ({ value: v.id, label: v.name })),
                  { value: "__none__", label: "Без заведения" },
                ]}
                disabled={!!restriction}
              />
            )
          }
        </Field>
      </div>
    </ConfirmDialog>
  );
}
