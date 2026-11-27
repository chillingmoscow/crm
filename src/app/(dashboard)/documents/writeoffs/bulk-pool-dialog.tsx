"use client";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { countRu } from "@/lib/format/plural";
import type { WriteoffPoolAssignment } from "@/lib/stock/writeoff-pools";
import type { WriteoffPoolTargets } from "./actions";
import { poolNames } from "./pool-section";

type Pool = WriteoffPoolAssignment["pool"];
const acts = (n: number) => countRu(n, "акт", "акта", "актов");

/**
 * «Кто платит» для выбранных актов. Подтверждение массовой операции (DS «Modal»):
 * называет число актов и условия; ошибка остаётся в диалоге. Выбор тот же, что
 * в карточке акта, но без снятия разнесения: снимают по одному акту.
 */
export function BulkPoolDialog({
  open,
  count,
  reassigned,
  monthName,
  deductionWarning,
  targets,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  /** Сколько актов выбрано. */
  count: number;
  /** Из них уже с плательщиком: он заменится. */
  reassigned: number;
  monthName: string;
  /** Пояснение про уже посчитанное удержание месяца; null - не показывать. */
  deductionWarning: string | null;
  targets: WriteoffPoolTargets;
  onOpenChange: (open: boolean) => void;
  /** Бросает ошибку с текстом для человека: диалог её покажет и останется открытым. */
  onConfirm: (pool: Pool, key: string | null) => Promise<void>;
}) {
  const [pool, setPool] = useState<Pool | "">("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noKey = pool === "shared" || pool === "excluded";
  const complete =
    noKey || ((pool === "department" || pool === "personal") && !!key);
  const departments = targets.departments.filter((d) => !d.archived);
  const employees = targets.employees.filter((e) => e.active);

  function close(next: boolean) {
    if (busy) return;
    if (!next) {
      setPool("");
      setKey("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function confirm() {
    if (pool === "" || !complete) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(pool, noKey ? null : key);
      setPool("");
      setKey("");
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Не удалось разнести акты",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      icon={Wallet}
      open={open}
      onOpenChange={close}
      title={`Кто платит за ${acts(count)}?`}
      description={
        <>
          Плательщик запишется для выбранных проведённых актов за {monthName}.
          {reassigned > 0 &&
            ` У ${countRu(reassigned, "акта", "актов", "актов")} плательщик уже выбран: он заменится.`}{" "}
          Черновики и акты, которых нет в Quick Resto, пропускаются.
        </>
      }
      confirmLabel={`Разнести ${acts(count)}`}
      pendingLabel="Разносим…"
      busy={busy}
      confirmDisabled={!complete}
      error={error}
      onConfirm={() => void confirm()}
    >
      <div className="grid gap-4">
        <Field id="writeoff-bulk-pool" label="Плательщик">
          {(control) => (
            <OptionSelect
              {...control}
              value={pool}
              disabled={busy}
              placeholder="Выберите, кто платит"
              onValueChange={(v) => {
                setPool(v as Pool | "");
                setKey("");
              }}
              options={(Object.keys(poolNames) as Pool[]).map((p) => ({
                value: p,
                label: poolNames[p],
              }))}
            />
          )}
        </Field>
        {pool === "department" && (
          <Field id="writeoff-bulk-department" label="Подразделение">
            {(control) => (
              <OptionSelect
                {...control}
                value={key}
                disabled={busy}
                placeholder="Выберите подразделение"
                onValueChange={setKey}
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
          </Field>
        )}
        {pool === "personal" && (
          <Field id="writeoff-bulk-employee" label="Сотрудник">
            {(control) => (
              <OptionSelect
                {...control}
                value={key}
                disabled={busy}
                placeholder="Выберите сотрудника"
                onValueChange={setKey}
                options={employees.map((e) => ({ value: e.id, label: e.name }))}
              />
            )}
          </Field>
        )}
        {deductionWarning && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {deductionWarning}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
