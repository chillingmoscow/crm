"use client";
import { useState } from "react";
import { toast } from "sonner";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRub } from "@/components/shared/money";
import type { WriteoffRow } from "@/lib/stock/writeoff-view";
import {
  writeoffChargeRubles,
  writeoffCounts,
  type WriteoffPoolAssignment,
} from "@/lib/stock/writeoff-pools";
import type { WriteoffData } from "./actions";

type Pool = WriteoffPoolAssignment["pool"];
const poolNames: Record<Pool, string> = {
  shared: "Вся команда",
  department: "Подразделение",
  personal: "Один сотрудник",
  excluded: "Не удерживать",
};

/**
 * Состояние формы «Кто платит». Живёт в панели, а не в разделе: кнопки
 * «Сохранить» и «Снять разнесение» стоят в подвале панели (DS § «Боковая
 * панель», тип Б: все действия — в подвале).
 */
export function useWriteoffPoolForm(
  row: WriteoffRow,
  onAssign: (pool: Pool | null, key: string | null) => Promise<void>,
) {
  const mark = row.assignment;
  const [pool, setPool] = useState<Pool | "">(mark?.pool ?? "");
  const [key, setKey] = useState(mark?.key ?? "");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  // Ошибка сохранения остаётся в панели (DS § «Боковая панель»), а не в тосте.
  const [error, setError] = useState<string | null>(null);
  const noKey = pool === "shared" || pool === "excluded";
  const complete =
    noKey || ((pool === "department" || pool === "personal") && !!key);
  const changed =
    pool !== (mark?.pool ?? "") || (key || null) !== (mark?.key ?? null);

  async function run(kind: "save" | "clear") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "clear") {
        await onAssign(null, null);
        setPool("");
        setKey("");
      } else {
        await onAssign(pool as Pool, noKey ? null : key);
      }
      toast.success(kind === "clear" ? "Разнесение снято" : "Акт разнесён");
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : kind === "clear"
            ? "Не удалось снять разнесение"
            : "Не удалось сохранить разнесение",
      );
    } finally {
      setBusy(null);
    }
  }

  return {
    mark,
    pool,
    key,
    busy,
    error,
    canSave: complete && changed && busy === null,
    choosePool: (next: Pool | "") => {
      setPool(next);
      setKey("");
    },
    setKey,
    save: () => run("save"),
    clear: () => run("clear"),
  };
}

export type WriteoffPoolForm = ReturnType<typeof useWriteoffPoolForm>;

/** Раздел «Кто платит» в карточке акта: видно, разнесён ли акт, и можно выбрать плательщика. */
export function PoolSection({
  row,
  data,
  canAssign,
  form,
}: {
  row: WriteoffRow;
  data: WriteoffData;
  canAssign: boolean;
  form: WriteoffPoolForm;
}) {
  const doc = row.native;
  if (!doc) return null;
  const { mark, pool, key, busy } = form;

  const counts = writeoffCounts(doc);
  const rubles = writeoffChargeRubles(doc.payload.kind, doc.payload.lines);
  const zero = counts && rubles === 0;

  const departments = data.targets.departments.filter(
    (d) => !d.archived || d.id === mark?.key,
  );
  const employees = data.targets.employees.filter(
    (e) => e.active || e.id === mark?.key,
  );

  return (
    <DrawerSection
      title="Кто платит"
      actions={
        row.poolState === "unassigned" && (
          <StatusBadge tone="warning">{row.pool}</StatusBadge>
        )
      }
    >
      <div className="space-y-1">
        <p className="break-words text-sm">
          {mark ? (
            row.pool
          ) : zero ? (
            <span className="text-muted-foreground">
              Сумма акта 0 ₽: разносить его не нужно, месяц он не блокирует.
            </span>
          ) : counts ? (
            <span className="text-muted-foreground">
              Пока не выбрано. Пока акт не разнесён, месяц не посчитан.
            </span>
          ) : (
            <span className="text-muted-foreground">
              {doc.payload.processed
                ? "Акт пропал из источника и в расчёт не идёт."
                : "Черновик в расчёт не идёт, пока его не проведут."}
            </span>
          )}
        </p>
        {mark && !counts && (
          <p className="text-xs text-muted-foreground">
            {doc.payload.processed
              ? "Акт пропал из источника и в расчёт не идёт. Разнесение сохранилось: если акт вернётся, оно применится."
              : "Черновик в расчёт не идёт, пока его не проведут. Выбор сохранится."}
          </p>
        )}
        {counts && row.poolState === "unassigned" && mark ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {row.pool === "Сумма не определена"
              ? "У части позиций в Quick Resto нет суммы, поэтому акт не попадает в расчёт месяца. Исправьте акт в Quick Resto или выберите «Не удерживать»."
              : "Подразделение в архиве, расчёт месяца его не учитывает. Выберите плательщика заново."}
          </p>
        ) : null}
        {rubles !== null && counts && mark?.pool !== "excluded" && (
          <p className="text-xs text-muted-foreground">
            К разнесению: {formatRub(rubles, { fraction: "auto" })}. Каждая
            позиция округлена отдельно.
          </p>
        )}
      </div>
      {canAssign ? (
        <div className="grid gap-4">
          <Field
            id="writeoff-pool"
            label="Плательщик"
            hint={
              doc.payload.kind === "personal" && !mark
                ? "Личное потребление сотрудник оплачивает сам, это не удержание. Обычно выбирают «Не удерживать»."
                : undefined
            }
          >
            {(control) => (
              <OptionSelect
                {...control}
                value={pool}
                disabled={busy !== null}
                placeholder="Выберите, кто платит"
                onValueChange={(v) => form.choosePool(v as Pool | "")}
                options={(Object.keys(poolNames) as Pool[]).map((p) => ({
                  value: p,
                  label: poolNames[p],
                }))}
              />
            )}
          </Field>
          {pool === "department" && (
            <Field id="writeoff-department" label="Подразделение">
              {(control) => (
                <OptionSelect
                  {...control}
                  value={key}
                  disabled={busy !== null}
                  placeholder="Выберите подразделение"
                  onValueChange={form.setKey}
                  options={departments.map((d) => ({
                    value: d.id,
                    label: `${d.name}${d.archived ? " (в архиве)" : ""}`,
                  }))}
                />
              )}
            </Field>
          )}
          {pool === "personal" && (
            <Field id="writeoff-employee" label="Сотрудник">
              {(control) => (
                <OptionSelect
                  {...control}
                  value={key}
                  disabled={busy !== null}
                  placeholder="Выберите сотрудника"
                  onValueChange={form.setKey}
                  options={employees.map((e) => ({
                    value: e.id,
                    label: `${e.name}${e.active ? "" : " (не работает)"}`,
                  }))}
                />
              )}
            </Field>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Разносить акты может сотрудник с отдельным правом. Если нужно,
          обратитесь к владельцу аккаунта.
        </p>
      )}
      {form.error && (
        <p role="alert" className="text-sm text-destructive">
          {form.error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Акт разносится целиком: разделить его по позициям нельзя.
      </p>
    </DrawerSection>
  );
}
