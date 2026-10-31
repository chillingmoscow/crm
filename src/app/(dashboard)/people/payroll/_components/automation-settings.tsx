"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, ChevronDown, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  automationSettingsSchema,
  automationSettingsLines,
  type AutomationSettings as Config,
} from "@/lib/payroll/automation-settings";
import {
  loadAutomationSettings,
  saveAutomationSettings,
} from "../automation-actions";
import { selectClass } from "./employee-pay";

function NumberField({
  id,
  label,
  value,
  onChange,
  unit = "₽",
  min = 0,
  max = 1e6,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={unit === "₽" || unit === "бонусов" ? "0.01" : 1}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? NaN : Number(e.target.value))
          }
          className="pr-20 tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm font-medium">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
function Section({
  title,
  summary,
  children,
  open = false,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="group border-t" open={open || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 px-5 pb-5">{children}</div>
    </details>
  );
}
function RolesField({
  id,
  roles,
  onChange,
}: {
  id: string;
  roles: string[];
  onChange: (value: string[]) => void;
}) {
  // Keep intermediate separators while typing; trim/validate on save.
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Должности · через запятую</Label>
      <Input
        id={id}
        value={roles.join(",")}
        onChange={(e) => onChange(e.target.value.split(","))}
      />
    </div>
  );
}
const money = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("ru-RU") : "—";
const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  });

export function AutomationSettings({ venueId }: { venueId: string }) {
  const [record, setRecord] = useState<Awaited<
    ReturnType<typeof loadAutomationSettings>
  > | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const data = await loadAutomationSettings(venueId);
    setRecord(data);
    setConfig(data.current.config);
  }, [venueId]);
  useEffect(() => {
    let alive = true;
    void loadAutomationSettings(venueId)
      .then((data) => {
        if (alive) {
          setRecord(data);
          setConfig(data.current.config);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [venueId]);
  if (error)
    return (
      <p
        role="alert"
        className="rounded-xl border p-5 text-sm text-destructive"
      >
        {error}
      </p>
    );
  if (!record || !config)
    return (
      <div
        aria-busy="true"
        aria-label="Загрузка настроек автоматизаций"
        className="h-40 animate-pulse rounded-xl border bg-muted/30"
      />
    );
  function change<K extends keyof Config>(
    section: K,
    patch: Partial<Config[K]>,
  ) {
    setConfig(
      (current) =>
        current && { ...current, [section]: { ...current[section], ...patch } },
    );
  }
  const m = config.medical,
    u = config.uniform,
    t = config.tasks,
    g = config.gifts;
  const dirty =
    record.current.version === 0 ||
    JSON.stringify(config) !== JSON.stringify(record.current.config);
  const holidays = (
    index: number,
    patch: Partial<Config["gifts"]["holidays"][number]>,
  ) =>
    change("gifts", {
      holidays: g.holidays.map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    });
  const tenure = (
    index: number,
    patch: Partial<Config["gifts"]["tenure"][number]>,
  ) =>
    change("gifts", {
      tenure: g.tenure.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    });
  return (
    <form
      className="overflow-hidden rounded-xl border"
      onSubmit={async (event) => {
        event.preventDefault();
        const parsed = automationSettingsSchema.safeParse(config);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Проверьте настройки");
          return;
        }
        setBusy(true);
        try {
          await saveAutomationSettings({
            venueId,
            version: record.current.version,
            config: parsed.data,
          });
          await reload();
          toast.success("Настройки сохранены. Работа n8n не изменена");
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "Не удалось сохранить настройки",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <header className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Медкнижки, форма и мотивация</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Правила заведения
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Общие правила медкнижек и удержаний за форму. Сведения и покупки хранятся во вкладке «Документы» сотрудника.
        </p>
        {record.current.version === 0 && (
          <p className="text-sm text-muted-foreground">
            Заполнено по прежним настройкам CHILLING. Проверьте и сохраните для
            этого заведения.
          </p>
        )}
      </header>
      <fieldset disabled={busy} className="min-w-0">
        <Section
          title="Медицинские книжки"
          summary={`Просрочка — ${money(m.expiry_amount)} ₽ один раз за случай`}
          open
        >
          <Toggle
            label="Напоминать о медкнижке"
            checked={m.reminders}
            onChange={(reminders) => change("medical", { reminders })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="medical-hire-reminder"
              label="Первое напоминание после приёма"
              value={m.reminder_after_hire_days}
              unit="дней"
              max={365}
              onChange={(reminder_after_hire_days) =>
                change("medical", { reminder_after_hire_days })
              }
            />
            <NumberField
              id="medical-expiry-reminder"
              label="Напоминать до окончания срока"
              value={m.reminder_before_expiry_days}
              unit="дней"
              max={365}
              onChange={(reminder_before_expiry_days) =>
                change("medical", { reminder_before_expiry_days })
              }
            />
          </div>
          <div className="space-y-4 border-t pt-5">
            <Toggle
              label="Штраф за непредоставленную книжку"
              checked={m.submission_fine}
              onChange={(submission_fine) =>
                change("medical", { submission_fine })
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="medical-submission-months"
                label="После приёма на работу"
                value={m.submission_after_hire_months}
                unit="мес."
                min={1}
                max={36}
                onChange={(submission_after_hire_months) =>
                  change("medical", { submission_after_hire_months })
                }
              />
              <NumberField
                id="medical-submission-amount"
                label="Сумма штрафа"
                value={m.submission_amount}
                onChange={(submission_amount) =>
                  change("medical", { submission_amount })
                }
              />
            </div>
          </div>
          <div className="space-y-4 border-t pt-5">
            <Toggle
              label="Штраф за просрочку"
              checked={m.expiry_fine}
              onChange={(expiry_fine) => change("medical", { expiry_fine })}
            />
            <NumberField
              id="medical-expiry-amount"
              label="Один штраф за случай просрочки"
              value={m.expiry_amount}
              onChange={(expiry_amount) => change("medical", { expiry_amount })}
            />
            <p className="text-sm text-muted-foreground">
              Повторные проверки не создают штраф. Новый случай — после
              продления книжки и следующей просрочки.
            </p>
          </div>
          <div className="space-y-4 border-t pt-5">
            <Toggle
              label="Компенсировать изготовление книжки"
              checked={m.reimbursement}
              onChange={(reimbursement) => change("medical", { reimbursement })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="medical-reimbursement"
                label="Сумма компенсации"
                value={m.reimbursement_amount}
                onChange={(reimbursement_amount) =>
                  change("medical", { reimbursement_amount })
                }
              />
              <NumberField
                id="medical-reimbursement-months"
                label="После обследования"
                value={m.reimbursement_after_exam_months}
                unit="мес."
                max={36}
                onChange={(reimbursement_after_exam_months) =>
                  change("medical", { reimbursement_after_exam_months })
                }
              />
            </div>
            <Toggle
              label="Только если обследование пройдено после приёма"
              checked={m.reimbursement_requires_exam_after_hire}
              onChange={(reimbursement_requires_exam_after_hire) =>
                change("medical", { reimbursement_requires_exam_after_hire })
              }
            />
          </div>
        </Section>
        <Section
          title="Рабочая форма"
          summary={`${u.installments} удержания · ${u.payment_days.join(" и ")} числа`}
        >
          <Toggle
            label="Возмещать стоимость формы частями"
            checked={u.enabled}
            onChange={(enabled) => change("uniform", { enabled })}
          />
          <NumberField
            id="uniform-installments"
            label="Количество удержаний"
            value={u.installments}
            unit="частей"
            min={1}
            max={24}
            onChange={(installments) => change("uniform", { installments })}
          />
          <div className="space-y-2">
            <Label>Дни удержаний в месяце</Label>
            <div className="flex flex-wrap gap-2">
              {u.payment_days.map((day, i) => (
                <div className="flex items-center gap-1" key={i}>
                  <Input
                    aria-label={`День удержания ${i + 1}`}
                    type="number"
                    min={1}
                    max={28}
                    className="w-20"
                    value={day}
                    onChange={(e) =>
                      change("uniform", {
                        payment_days: u.payment_days.map((d, j) =>
                          i === j ? Number(e.target.value) : d,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Убрать день ${i + 1}`}
                    disabled={u.payment_days.length === 1}
                    onClick={() =>
                      change("uniform", {
                        payment_days: u.payment_days.filter((_, j) => i !== j),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {u.payment_days.length < 4 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={u.payment_days.at(-1) === 28}
                  onClick={() =>
                    change("uniform", {
                      payment_days: [
                        ...u.payment_days,
                        Math.min(28, (u.payment_days.at(-1) ?? 0) + 1),
                      ],
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  День
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Стоимость указывается при выдаче формы. Последнее удержание
            покрывает остаток; повторного расхода при удержании нет.
          </p>
        </Section>
        <Section
          title="Задачи"
          summary="Невыполнение и выполнение перенесённых задач"
        >
          <Toggle
            label="Учитывать невыполненные задачи"
            checked={t.missing_enabled}
            onChange={(missing_enabled) => change("tasks", { missing_enabled })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-kind">При невыполнении</Label>
              <select
                id="task-kind"
                className={selectClass}
                value={t.missing_kind}
                onChange={(e) =>
                  change("tasks", {
                    missing_kind: e.target.value as typeof t.missing_kind,
                  })
                }
              >
                <option value="deduction">Штраф</option>
                <option value="warning">Предупреждение</option>
              </select>
            </div>
            {t.missing_kind === "deduction" && (
              <NumberField
                id="task-amount"
                label="Штраф по умолчанию"
                value={t.missing_amount}
                onChange={(missing_amount) =>
                  change("tasks", { missing_amount })
                }
              />
            )}
          </div>
          <div className="space-y-4 border-t pt-5">
            <Toggle
              label="Премия за выполнение перенесённой задачи"
              checked={t.extra_reward_enabled}
              onChange={(extra_reward_enabled) =>
                change("tasks", { extra_reward_enabled })
              }
            />
            <div className="space-y-2">
              <Label htmlFor="task-reward-medium">Начислять премию</Label>
              <select
                id="task-reward-medium"
                className={selectClass}
                value={t.extra_reward_medium}
                onChange={(e) =>
                  change("tasks", {
                    extra_reward_medium: e.target
                      .value as typeof t.extra_reward_medium,
                  })
                }
              >
                <option value="bonus">Бонусами</option>
                <option value="money">Деньгами</option>
              </select>
            </div>
            <p className="text-sm text-muted-foreground">
              Сумма берётся из самой задачи. Выполнение должно быть
              подтверждено.
            </p>
          </div>
        </Section>
        <Section
          title="Дни рождения и праздники"
          summary={`${g.holidays.length} событий · подарки бонусами`}
        >
          <Toggle
            label="Подарки за праздники и стаж"
            checked={g.enabled}
            onChange={(enabled) => change("gifts", { enabled })}
          />
          <NumberField
            id="gift-tenure-boundary"
            label="Повышенный подарок при стаже от"
            value={g.tenure_boundary_days}
            unit="дней"
            min={1}
            max={3650}
            onChange={(tenure_boundary_days) =>
              change("gifts", { tenure_boundary_days })
            }
          />
          <div className="divide-y">
            {g.holidays.map((row, i) => (
              <div key={row.id} className="space-y-4 py-5 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <Input
                    aria-label={`Название события ${i + 1}`}
                    value={row.name}
                    onChange={(e) => holidays(i, { name: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Удалить событие ${row.name}`}
                    onClick={() =>
                      change("gifts", {
                        holidays: g.holidays.filter((_, j) => i !== j),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    id={`gift-junior-${row.id}`}
                    label={`Стаж менее ${g.tenure_boundary_days} дней`}
                    value={row.junior_amount}
                    unit="бонусов"
                    onChange={(junior_amount) => holidays(i, { junior_amount })}
                  />
                  <NumberField
                    id={`gift-senior-${row.id}`}
                    label={`Стаж от ${g.tenure_boundary_days} дней`}
                    value={row.senior_amount}
                    unit="бонусов"
                    onChange={(senior_amount) => holidays(i, { senior_amount })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`gift-date-${row.id}`}>Дата · ДД.ММ</Label>
                    <Input
                      id={`gift-date-${row.id}`}
                      placeholder="День рождения сотрудника"
                      value={row.month_day.split("-").reverse().join(".")}
                      onChange={(e) =>
                        holidays(i, {
                          month_day: e.target.value
                            .split(".")
                            .reverse()
                            .join("-"),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`gift-gender-${row.id}`}>Получатели</Label>
                    <select
                      id={`gift-gender-${row.id}`}
                      className={selectClass}
                      value={row.gender}
                      onChange={(e) =>
                        holidays(i, {
                          gender: e.target.value as typeof row.gender,
                        })
                      }
                    >
                      <option value="all">Все</option>
                      <option value="male">Мужчины</option>
                      <option value="female">Женщины</option>
                    </select>
                  </div>
                </div>
                <RolesField
                  id={`gift-roles-${row.id}`}
                  roles={row.roles}
                  onChange={(roles) => holidays(i, { roles })}
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={g.holidays.length >= 30}
            onClick={() =>
              change("gifts", {
                holidays: [
                  ...g.holidays,
                  {
                    id: crypto.randomUUID(),
                    name: "Новый праздник",
                    month_day: "01-01",
                    junior_amount: 0,
                    senior_amount: 0,
                    roles: ["Бармен"],
                    gender: "all",
                  },
                ],
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Добавить событие
          </Button>
        </Section>
        <Section
          title="Подарки за стаж"
          summary={`${g.tenure.length} порогов · отдельно от надбавок к зарплате`}
        >
          <p className="text-sm text-muted-foreground">
            Надбавки к выходу настраиваются в должности. Здесь — бонусный
            подарок и целевая скидка сотрудника. Автоматическое назначение
            скидки ещё не подключено.
          </p>
          <div className="divide-y">
            {g.tenure.map((row, i) => (
              <div key={i} className="space-y-4 py-5 first:pt-0">
                <div className="flex items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-3">
                    <NumberField
                      id={`tenure-days-${i}`}
                      label="Стаж"
                      value={row.days}
                      unit="дней"
                      min={1}
                      max={36500}
                      onChange={(days) => tenure(i, { days })}
                    />
                    <NumberField
                      id={`tenure-amount-${i}`}
                      label="Подарок"
                      value={row.amount}
                      unit="бонусов"
                      onChange={(amount) => tenure(i, { amount })}
                    />
                    <NumberField
                      id={`tenure-discount-${i}`}
                      label="Скидка"
                      value={row.discount_percent}
                      unit="%"
                      max={100}
                      onChange={(discount_percent) =>
                        tenure(i, { discount_percent })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-7"
                    aria-label={`Удалить порог стажа ${row.days} дней`}
                    onClick={() =>
                      change("gifts", {
                        tenure: g.tenure.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <RolesField
                  id={`tenure-roles-${i}`}
                  roles={row.roles}
                  onChange={(roles) => tenure(i, { roles })}
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={g.tenure.length >= 30}
            onClick={() =>
              change("gifts", {
                tenure: [
                  ...g.tenure,
                  {
                    days: (g.tenure.at(-1)?.days ?? 0) + 1,
                    amount: 0,
                    discount_percent: 0,
                    roles: ["Бармен"],
                  },
                ],
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Добавить порог
          </Button>
        </Section>
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t p-5">
          <p className="text-xs text-muted-foreground">
            {record.current.updated_at
              ? `Версия ${record.current.version} · ${date(record.current.updated_at)}`
              : "Настройки ещё не сохранены"}
          </p>
          <Button disabled={busy || !dirty}>
            {busy ? "Сохраняем…" : "Сохранить настройки"}
          </Button>
        </footer>
      </fieldset>
      {record.history.length > 0 && (
        <details className="border-t p-5">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Clock3 className="h-4 w-4 text-muted-foreground" />
            История настроек
          </summary>
          <ol className="mt-4 space-y-3">
            {record.history.map((row) => (
              <li key={row.version} className="text-sm">
                <details>
                  <summary className="cursor-pointer font-medium">
                    Версия {row.version} · {row.actor_name}
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.updated_at && date(row.updated_at)} · просрочка{" "}
                    {money(row.config.medical.expiry_amount)} ₽ ·{" "}
                    {row.config.gifts.holidays.length} праздничных правил ·{" "}
                    {row.config.gifts.tenure.length} порогов стажа
                  </p>
                  <ul className="mt-3 space-y-2 rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground">
                    {automationSettingsLines(row.config).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Все значения каждой версии сохранены. Изменения также попадают в
            журнал событий.
            {record.history.length === 30 && " Показаны последние 30 версий."}
          </p>
        </details>
      )}
    </form>
  );
}
