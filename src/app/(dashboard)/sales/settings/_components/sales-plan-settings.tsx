"use client";
import { useEffect, useMemo, useState } from "react";
import { Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { AmountInput } from "@/components/finance/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money, formatRub } from "@/components/shared/money";
import { MonthPicker } from "@/components/shared/month-picker";
import { ProfileSection } from "@/components/shared/profile-section";
import { unwrapAction } from "@/lib/actions/result";
import { monthLabel } from "@/lib/sales/format";
import type { SalesPlan } from "@/lib/sales/plan";
import { loadSalesPlans, saveSalesPlan } from "../../plan-actions";

const MIN_MONTH = "2020-01";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function PlanForm({
  open,
  venueId,
  initialMonth,
  plans,
  onClose,
  onSaved,
}: {
  /** Панель держат смонтированной, пока она уезжает: закрывают через `open`. */
  open: boolean;
  venueId: string;
  initialMonth: string;
  plans: SalesPlan[];
  onClose: () => void;
  onSaved: (plans: SalesPlan[]) => void;
}) {
  const byMonth = useMemo(() => new Map(plans.map((p) => [p.month, p.turnover])), [plans]);
  const [month, setMonth] = useState(initialMonth);
  const [turnover, setTurnover] = useState<number | null>(byMonth.get(initialMonth) ?? null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [invalid, setInvalid] = useState<string | undefined>();
  // Удаление — через подтверждение (DS «Modal»); его ошибка остаётся в окне.
  const [confirmDelete, setConfirmDelete] = useState(false),
    [deleteError, setDeleteError] = useState<string | null>(null);
  const existing = byMonth.get(month) ?? null;
  const save = async (next: number | null) => {
    if (next !== null && !(next > 0)) {
      setInvalid("Укажите оборот больше нуля");
      return;
    }
    setInvalid(undefined);
    setBusy(true);
    setError(null);
    setDeleteError(null);
    try {
      const saved = unwrapAction(await saveSalesPlan({ venueId, month, turnover: next }));
      setConfirmDelete(false);
      onSaved(saved);
      toast.success(
        next === null
          ? `План на ${monthLabel(month)} удалён`
          : `План на ${monthLabel(month)}: ${formatRub(next)}`,
      );
    } catch (e) {
      const text = e instanceof Error ? e.message : "Не удалось сохранить план продаж";
      if (next === null) setDeleteError(text);
      else setError(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title={existing === null ? "Новый план" : "План месяца"}
      description="Оборот, к которому идёт заведение. На «Сменах» — кольцо прогресса и прогноз на конец месяца"
      footer={
        <>
          {existing !== null && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => {
                setDeleteError(null);
                setConfirmDelete(true);
              }}
            >
              Удалить план
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={() => void save(turnover)}>
            {busy ? "Сохраняем…" : existing === null ? "Создать план" : "Сохранить"}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
        <Field id="sales-plan-month" label="Месяц" required>
          {(control) => (
            <MonthPicker
              {...control}
              variant="field"
              prefix=""
              ariaLabel="Месяц плана"
              value={`${month}-01`}
              min={`${MIN_MONTH}-01`}
              onChange={(v) => {
                const next = v.slice(0, 7);
                setMonth(next);
                setTurnover(byMonth.get(next) ?? null);
                setInvalid(undefined);
              }}
            />
          )}
        </Field>
        <Field
          id="sales-plan-turnover"
          label="Оборот за месяц"
          required
          hint="Тот же оборот, что в «Сменах»: гостевые продажи без депозитов, парковки, чаевых и сервисного сбора"
          error={invalid}
        >
          {(control) => (
            <AmountInput id={control.id} value={turnover} onChange={setTurnover} />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </fieldset>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Удалить план на ${monthLabel(month)}?`}
        description="Кольцо и прогноз на «Сменах» для этого месяца пропадут. План можно задать заново"
        confirmLabel="Удалить план"
        pendingLabel="Удаляем…"
        destructive
        busy={busy}
        error={deleteError}
        onConfirm={() => void save(null)}
      />
    </EditDrawer>
  );
}

/**
 * План продаж заведения по месяцам. Ссылка `?plan=2026-11` (кнопка «Задать
 * план» на «Сменах») сразу открывает панель этого месяца.
 */
export function SalesPlanSettingsSection({
  venueId,
  currentMonth,
  openMonth,
}: {
  venueId: string;
  /** Текущий месяц заведения «2026-11». */
  currentMonth: string;
  /** Месяц, панель которого открыть сразу. */
  openMonth?: string;
}) {
  const [plans, setPlans] = useState<SalesPlan[] | null>(null),
    [error, setError] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [formMonth, setFormMonth] = useState(currentMonth);
  // Форму держим смонтированной, пока панель уезжает (docs/motion.md);
  // каждое открытие — новый ключ, форма начинается с сохранённых данных.
  const [session, setSession] = useState(0);
  const openForm = (month: string) => {
    setFormMonth(month);
    setSession((n) => n + 1);
    setOpen(true);
  };
  useEffect(() => {
    let live = true;
    loadSalesPlans(venueId)
      .then(unwrapAction)
      .then((d) => {
        if (!live) return;
        setPlans(d);
        if (openMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(openMonth)) {
          setFormMonth(openMonth);
          setSession((n) => n + 1);
          setOpen(true);
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Не удалось загрузить план продаж");
      });
    return () => {
      live = false;
    };
  }, [venueId, openMonth]);
  // Текущий и следующий месяц — всегда; прочие — если план задан. Свежие сверху.
  const rows = useMemo(() => {
    const byMonth = new Map((plans ?? []).map((p) => [p.month, p.turnover]));
    const months = new Set([shiftMonth(currentMonth, 1), currentMonth, ...byMonth.keys()]);
    return [...months]
      .sort()
      .reverse()
      .slice(0, 8)
      .map((month) => ({ month, turnover: byMonth.get(month) ?? null }));
  }, [plans, currentMonth]);
  return (
    <div id="sales-plan" className="scroll-mt-6">
      <ProfileSection
        title="План продаж"
        description="Оборот на месяц. На «Сменах» — кольцо прогресса и прогноз на конец месяца по темпу закрытых смен."
        actions={
          plans ? (
            <Button variant="outline" size="sm" onClick={() => openForm(currentMonth)}>
              <Target />
              Задать план
            </Button>
          ) : null
        }
      >
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : !plans ? (
          <div role="status" aria-label="Загружаем план продаж" className="space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.month} className="flex items-center justify-between gap-3 py-2.5">
                <button
                  type="button"
                  className="min-w-0 truncate text-left transition-colors duration-200 hover:text-brand focus-visible:text-brand focus-visible:outline-none"
                  onClick={() => openForm(r.month)}
                >
                  {capital(monthLabel(r.month))}
                  {r.month === currentMonth && (
                    <span className="ml-2 text-xs text-muted-foreground">текущий</span>
                  )}
                </button>
                {r.turnover === null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-2 text-muted-foreground"
                    onClick={() => openForm(r.month)}
                  >
                    Задать
                  </Button>
                ) : (
                  <Money className="shrink-0 font-medium" value={r.turnover} />
                )}
              </li>
            ))}
          </ul>
        )}
        {plans && (
          <PlanForm
            key={session}
            open={open}
            venueId={venueId}
            initialMonth={formMonth}
            plans={plans}
            onClose={() => setOpen(false)}
            onSaved={(next) => {
              setPlans(next);
              setOpen(false);
            }}
          />
        )}
      </ProfileSection>
    </div>
  );
}
