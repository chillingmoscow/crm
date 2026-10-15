"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, Clock3, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { previewLateness } from "@/lib/payroll/discipline";
import {
  loadDisciplineSettings,
  saveDisciplineSettings,
  type DisciplineSettings as Settings,
} from "../journal-actions";
const money = (amount: number) => amount.toLocaleString("ru-RU");
type NumericKey =
  | "late_grace"
  | "late_step"
  | "late_amount"
  | "late_max"
  | "missing_amount"
  | "unclosed_amount";
export function DisciplineSettings() {
  const [data, setData] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [example, setExample] = useState(22);
  useEffect(() => {
    let alive = true;
    loadDisciplineSettings()
      .then((value) => {
        if (!alive) return;
        if (!value) {
          setError(
            "Настройки автоматических правил ещё не созданы для заведения.",
          );
          return;
        }
        setData(value);
        setSaved(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (error)
    return (
      <p
        role="alert"
        className="rounded-xl border p-5 text-sm text-destructive"
      >
        {error}
      </p>
    );
  if (!data)
    return (
      <div
        aria-label="Загрузка правил"
        aria-busy="true"
        className="h-64 animate-pulse rounded-xl border bg-muted/30"
      />
    );
  const change = (patch: Partial<Settings>) =>
    setData((current) => current && { ...current, ...patch });
  const dirty = JSON.stringify(data) !== JSON.stringify(saved);
  const invalid =
    data.late_step < 1 ||
    data.late_step > 120 ||
    data.late_grace < 0 ||
    data.late_grace > 120 ||
    [data.late_step, data.late_grace].some((n) => !Number.isInteger(n)) ||
    [
      data.late_amount,
      data.late_max,
      data.missing_amount,
      data.unclosed_amount,
    ].some((n) => !Number.isFinite(n) || n < 0 || n > 1e6) ||
    data.warning_steps.some(
      (s, i) =>
        !Number.isInteger(s.count) ||
        s.count < 1 ||
        s.count > 1000 ||
        s.amount <= 0 ||
        s.amount > 1e6 ||
        (i > 0 && s.count <= data.warning_steps[i - 1].count),
    );
  const preview = previewLateness(example * 60, data);
  const outcome = (kind: typeof preview.kind) =>
    ({
      disabled: "Правило выключено",
      on_time: "Без предупреждения и штрафа",
      warning: "Предупреждение",
      deduction: "Штраф",
    })[kind];
  const numeric = (
    key: NumericKey,
    label: string,
    unit: string,
    min = 0,
    max = 1e6,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`discipline-${key}`}>{label}</Label>
      <div className="relative">
        <Input
          id={`discipline-${key}`}
          type="number"
          min={min}
          max={max}
          step={key === "late_step" || key === "late_grace" ? 1 : "0.01"}
          className="pr-14 tabular-nums"
          value={data[key]}
          onChange={(e) => change({ [key]: Number(e.target.value) })}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-normal text-muted-foreground"
        >
          {unit}
        </span>
      </div>
    </div>
  );
  return (
    <section
      id="automatic-payroll-rules"
      className="scroll-mt-6 overflow-hidden rounded-xl border"
    >
      <header className="flex items-start justify-between gap-5 border-b p-5">
        <div>
          <h2 className="font-semibold">Автоматические правила</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Действуют с {data.valid_from.split("-").reverse().join(".")} ·
            прежние записи сохраняются
          </p>
        </div>
        <Switch
          aria-label="Автоматические правила"
          disabled={busy}
          checked={data.enabled}
          onCheckedChange={(enabled) => change({ enabled })}
        />
      </header>
      <fieldset disabled={busy} className="min-w-0">
        <section className="p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="flex items-center gap-2 font-medium">
              <Clock3 className="size-4 text-muted-foreground" />
              Опоздания
            </h3>
            <Switch
              aria-label="Учёт опозданий"
              checked={data.late_enabled}
              onCheckedChange={(late_enabled) => change({ late_enabled })}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <fieldset
              disabled={!data.enabled || !data.late_enabled}
              className="min-w-0 space-y-5 disabled:opacity-50"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {numeric("late_grace", "Предупреждение до", "мин", 0, 120)}
                {numeric("late_step", "Каждые начатые", "мин", 1, 120)}
                {numeric("late_amount", "Размер штрафа за период", "₽")}
                {numeric("late_max", "Максимум за смену", "₽")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="late-payment-medium">Как учитывать штраф</Label>
                <select
                  id="late-payment-medium"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={data.late_bonus ? "bonus" : "money"}
                  onChange={(e) =>
                    change({ late_bonus: e.target.value === "bonus" })
                  }
                >
                  <option value="bonus">
                    Сначала бонусами, иначе целиком деньгами
                  </option>
                  <option value="money">Всегда деньгами</option>
                </select>
              </div>
            </fieldset>
            <div className="min-w-0 rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor="lateness-example">Проверить на примере</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="lateness-example"
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={example}
                    className="h-9 w-24 text-right tabular-nums"
                    onChange={(e) =>
                      setExample(
                        Math.min(1440, Math.max(0, Number(e.target.value))),
                      )
                    }
                  />
                  <span className="text-sm text-muted-foreground">мин</span>
                </div>
              </div>
              <div aria-live="polite" className="my-5">
                <p className="text-sm text-muted-foreground">
                  {outcome(preview.kind)}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {preview.kind === "deduction"
                    ? `${money(preview.amount)} ${data.late_bonus ? "бонусов / ₽" : "₽"}`
                    : "0 ₽"}
                </p>
                {preview.kind === "deduction" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {Math.ceil(preview.minutes / Math.max(1, data.late_step))} ×{" "}
                    {money(data.late_amount)}
                    {Math.ceil(preview.minutes / Math.max(1, data.late_step)) *
                      data.late_amount >
                    data.late_max
                      ? `, максимум ${money(data.late_max)}`
                      : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {[3, 10, 22, 60].map((n) => (
                  <button
                    type="button"
                    key={n}
                    aria-pressed={example === n}
                    onClick={() => setExample(n)}
                    className="rounded-md border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {n} мин
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                После {data.late_grace} мин штраф считается за всё опоздание.
                Секунды округляются до ближайшей минуты.
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Сравниваем начало в графике и отметку Quick Resto. Длительность
            смены не учитывается. Для разовых сотрудников штраф по QR-отметкам
            не начисляется.
          </p>
        </section>
        <section className="border-t p-5">
          <h3 className="font-medium">Предупреждения</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Считаются за месяц. Каждый достигнутый порог добавляет отдельный
            штраф.
          </p>
          <fieldset
            disabled={!data.enabled}
            className="mt-4 max-w-xl space-y-3 disabled:opacity-50"
          >
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1fr_1fr_36px] gap-3 bg-muted/40 px-3 py-2.5 text-xs font-medium text-muted-foreground">
                <span>Предупреждений</span>
                <span>Добавить штраф, ₽</span>
                <span />
              </div>
              {data.warning_steps.map((step, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_36px] items-center gap-3 border-t px-3 py-2"
                >
                  <Input
                    aria-label={`Предупреждений для порога ${i + 1}`}
                    type="number"
                    min={1}
                    max={1000}
                    value={step.count}
                    onChange={(e) =>
                      change({
                        warning_steps: data.warning_steps.map((s, n) =>
                          n === i ? { ...s, count: Number(e.target.value) } : s,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={`Сумма штрафа для порога ${i + 1}`}
                    type="number"
                    min={1}
                    max={1e6}
                    value={step.amount}
                    onChange={(e) =>
                      change({
                        warning_steps: data.warning_steps.map((s, n) =>
                          n === i
                            ? { ...s, amount: Number(e.target.value) }
                            : s,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Удалить порог ${i + 1}`}
                    onClick={() =>
                      change({
                        warning_steps: data.warning_steps.filter(
                          (_, n) => n !== i,
                        ),
                      })
                    }
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              {!data.warning_steps.length && (
                <p className="p-3 text-sm text-muted-foreground">
                  Предупреждения сохраняются без автоматического штрафа.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={data.warning_steps.length >= 20}
              onClick={() =>
                change({
                  warning_steps: [
                    ...data.warning_steps,
                    {
                      count: Math.min(
                        1000,
                        (data.warning_steps.at(-1)?.count ?? 0) + 5,
                      ),
                      amount: 500,
                    },
                  ],
                })
              }
            >
              <Plus className="size-4" />
              Добавить порог
            </Button>
          </fieldset>
        </section>
        <details className="group border-t">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            Другие случаи
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-6 px-5 pb-5 sm:grid-cols-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="missing-clockin-enabled">
                  Нет отметки о смене
                </Label>
                <Switch
                  id="missing-clockin-enabled"
                  checked={data.missing_enabled}
                  onCheckedChange={(missing_enabled) =>
                    change({ missing_enabled })
                  }
                />
              </div>
              <fieldset
                disabled={!data.enabled || !data.missing_enabled}
                className="space-y-2 disabled:opacity-50"
              >
                {numeric("missing_amount", "Повторно за месяц", "₽")}
                <p className="text-xs text-muted-foreground">
                  Первый случай — предупреждение. При сбое загрузки данных штраф
                  не создаётся.
                </p>
              </fieldset>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="unclosed-shift-enabled">
                  Не закрыта персональная смена
                </Label>
                <Switch
                  id="unclosed-shift-enabled"
                  checked={data.unclosed_enabled}
                  onCheckedChange={(unclosed_enabled) =>
                    change({ unclosed_enabled })
                  }
                />
              </div>
              <fieldset
                disabled={!data.enabled || !data.unclosed_enabled}
                className="space-y-2 disabled:opacity-50"
              >
                {numeric("unclosed_amount", "Штраф спустя 24 часа", "₽")}
              </fieldset>
            </div>
          </div>
        </details>
      </fieldset>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t bg-muted/10 p-5">
        <div className="max-w-xl text-xs text-muted-foreground">
          <p>
            Бонусы: пока только расчёт в Sheerly. Реальные списания выполняет
            прежняя система.
          </p>
          {invalid && (
            <p role="alert" className="mt-1 text-destructive">
              Проверьте суммы и порядок порогов. Период — от 1 до 120 минут.
            </p>
          )}
        </div>
        <Button
          disabled={busy || !dirty || invalid}
          onClick={async () => {
            setBusy(true);
            try {
              await saveDisciplineSettings(data);
              const next = await loadDisciplineSettings();
              if (!next)
                throw new Error("Не удалось прочитать сохранённые правила");
              setData(next);
              setSaved(next);
              toast.success("Правила сохранены");
            } catch (e) {
              toast.error(
                e instanceof Error ? e.message : "Не удалось сохранить",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Сохраняем…" : "Сохранить правила"}
        </Button>
      </footer>
    </section>
  );
}
