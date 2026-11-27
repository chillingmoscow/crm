"use client";
import type { ActionResult } from "@/lib/actions/result";
import { useEffect, useState } from "react";
import { Plus, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AmountInput } from "@/components/finance/amount-input";
import { ProfileSection } from "@/components/shared/profile-section";
import { ExpandPanel } from "@/components/shared/overview-toggle";
import { countRu } from "@/lib/format/plural";
import { formatDayMonthTime } from "@/lib/format/date";
import {
  cashMovementDefaults,
  cashMovementRulesSchema,
  type CashMovementRules,
} from "@/lib/sales/cash-movements";
import {
  loadMovementConfiguration,
  saveMovementConfiguration,
  type MovementConfiguration,
} from "@/app/(dashboard)/sales/shifts/cash-movement-actions";
import { RuleHistory } from "@/app/(dashboard)/org/venues/[venueId]/_components/rule-history";

/** Сообщение загрузчика, когда правила инкассаций пользователю недоступны. */
const NO_ACCESS = "Правила изменяет владелец в выбранном заведении";

function Choice({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Field id={name} label={label} required>
      {(control) => (
        <OptionSelect
          {...control}
          value={value}
          onValueChange={onChange}
          placeholder="Выберите"
          options={options.map((o) => ({ value: o.id, label: o.name }))}
        />
      )}
    </Field>
  );
}
function Form({
  open,
  data,
  onClose,
  onSaved,
}: {
  /** Панель держат смонтированной, пока она уезжает: закрывают через `open`. */
  open: boolean;
  data: MovementConfiguration;
  onClose: () => void;
  onSaved: (d: MovementConfiguration) => void;
}) {
  const previous = data.versions[0],
    [rules, setRules] = useState<CashMovementRules>(
      previous?.config ?? {
        ...cashMovementDefaults,
        overrides: data.preset,
        cashAccountId: "",
        safeAccountId: "",
        operatingAccountId: "",
        incomeCategoryId: null,
        taxiCategoryId: "",
        tipsCategoryId: "",
      },
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [patternsOpen, setPatternsOpen] = useState(false),
    [overridesOpen, setOverridesOpen] = useState(false);
  const set = <K extends keyof CashMovementRules>(
    k: K,
    v: CashMovementRules[K],
  ) => setRules((r) => ({ ...r, [k]: v }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = cashMovementRulesSchema.safeParse(rules);
      if (!parsed.success)
        throw Error(parsed.error.issues[0]?.message ?? "Проверьте параметры");
      onSaved(
        await saveMovementConfiguration({
          venueId: data.venueId,
          version: previous?.version ?? 0,
          config: parsed.data,
          reason,
        }),
      );
      toast.success("Правила инкассаций сохранены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
    } finally {
      setBusy(false);
    }
  };
  const patch = (
    index: number,
    change: Partial<CashMovementRules["overrides"][number]>,
  ) =>
    set(
      "overrides",
      rules.overrides.map((o, i) => (i === index ? { ...o, ...change } : o)),
    );
  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Инкассации и внесения"
      description="Счета, статьи и правила сверки"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={busy || !reason.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
        <DrawerSection title="Счета">
          {(
            [
              ["cashAccountId", "Касса"],
              ["safeAccountId", "Сейф"],
              ["operatingAccountId", "Операционный счёт"],
            ] as const
          ).map(([key, label]) => (
            <Choice
              key={key}
              name={`movement-${key}`}
              label={label}
              value={rules[key]}
              options={data.banks}
              onChange={(v) => set(key, v)}
            />
          ))}
        </DrawerSection>
        <DrawerSection title="Внесения в кассу">
          <Choice
            name="movement-cash-in-mode"
            label="Обработка новых внесений"
            value={rules.cashInMode ?? "income"}
            options={[
              { id: "review", name: "Назначение выбираем вручную" },
              { id: "income", name: "Всегда поступление по статье" },
            ]}
            onChange={(value) => setRules((r) => ({
              ...r,
              cashInMode: value as "review" | "income",
              incomeCategoryId: value === "review" ? null : r.incomeCategoryId,
            }))}
          />
          {(rules.cashInMode ?? "income") === "income" && (
            <Choice
              name="movement-income-category"
              label="Статья поступлений"
              value={rules.incomeCategoryId ?? ""}
              options={data.categories.filter((c) => c.type === "income")}
              onChange={(v) => set("incomeCategoryId", v)}
            />
          )}
        </DrawerSection>
        <DrawerSection title="Статьи">
          {(
            [
              ["taxiCategoryId", "Такси", "expense"],
              ["tipsCategoryId", "Чаевые", "expense"],
            ] as const
          ).map(([key, label, type]) => (
            <Choice
              key={key}
              name={`movement-${key}`}
              label={label}
              value={rules[key]}
              options={data.categories.filter((c) => c.type === type)}
              onChange={(v) => set(key, v)}
            />
          ))}
        </DrawerSection>
        <DrawerSection
          title="Автоматическая сверка"
          actions={
            <Switch
              id="movement-auto"
              aria-label="Автоматическая сверка"
              checked={rules.autoRead}
              onCheckedChange={(v) => set("autoRead", v)}
            />
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="movement-lookback" label="Повторно проверять, дней" required>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={90}
                  value={rules.lookbackDays}
                  onChange={(e) => set("lookbackDays", Number(e.target.value))}
                />
              )}
            </Field>
            <Field id="movement-interval" label="Интервал, минут" required>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={15}
                  max={1440}
                  value={rules.intervalMinutes}
                  onChange={(e) => set("intervalMinutes", Number(e.target.value))}
                />
              )}
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Поздние выгрузки относятся к дате исходной кассовой смены.
          </p>
        </DrawerSection>
        <DrawerSection
          title="Распознавание комментариев"
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={patternsOpen}
              aria-controls="movement-patterns"
              onClick={() => setPatternsOpen(!patternsOpen)}
            >
              {patternsOpen ? "Скрыть" : "Показать"}
            </Button>
          }
        >
          <ExpandPanel id="movement-patterns" open={patternsOpen}>
            <div className="space-y-4">
              {(
                [
                  ["safePattern", "Инкассация в сейф"],
                  ["taxiPattern", "Такси"],
                  ["tipsPattern", "Чаевые"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} id={`movement-${key}`} label={label} required>
                  {(control) => (
                    <Input
                      {...control}
                      value={rules[key]}
                      maxLength={200}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </ExpandPanel>
        </DrawerSection>
        <DrawerSection
          title={`Ручные решения · ${rules.overrides.length}`}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={overridesOpen}
              aria-controls="movement-overrides"
              onClick={() => setOverridesOpen(!overridesOpen)}
            >
              {overridesOpen ? "Скрыть" : "Показать"}
            </Button>
          }
        >
          <ExpandPanel id="movement-overrides" open={overridesOpen}>
            <div className="space-y-4">
              {rules.overrides.length > 0 && (
                <div className="divide-y">
                  {rules.overrides.map((o, i) => (
                    <div key={i} className="space-y-3 py-4 first:pt-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          Операция {o.sourceId ? `#${o.sourceId}` : ""}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Убрать решение"
                          data-tip="Убрать решение"
                          onClick={() =>
                            set(
                              "overrides",
                              rules.overrides.filter((_, index) => i !== index),
                            )
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field id={`movement-id-${i}`} label="Номер Quick Resto" required>
                          {(control) => (
                            <Input
                              {...control}
                              inputMode="numeric"
                              value={o.sourceId || ""}
                              onChange={(e) =>
                                patch(i, { sourceId: Number(e.target.value) })
                              }
                            />
                          )}
                        </Field>
                        <Field id={`movement-date-${i}`} label="Дата смены" required>
                          {(control) => (
                            <DatePicker
                              id={control.id}
                              value={o.date}
                              disabled={busy}
                              onChange={(date) => patch(i, { date })}
                            />
                          )}
                        </Field>
                      </div>
                      <Field id={`movement-amount-${i}`} label="Сумма" required>
                        {(control) => (
                          <AmountInput
                            id={control.id}
                            value={o.amountCents ? o.amountCents / 100 : null}
                            onChange={(v) =>
                              patch(i, {
                                amountCents: Math.round((v ?? 0) * 100),
                              })
                            }
                          />
                        )}
                      </Field>
                      <Field id={`movement-comment-${i}`} label="Исходный комментарий">
                        {(control) => (
                          <Input
                            {...control}
                            value={o.comment}
                            onChange={(e) => patch(i, { comment: e.target.value })}
                          />
                        )}
                      </Field>
                      <Choice
                        name={`movement-type-${i}`}
                        label="Тип кассовой операции"
                        value={o.sourceType ?? "cashOut"}
                        options={[
                          { id: "cashOut", name: "Изъятие из кассы" },
                          { id: "cashIn", name: "Внесение в кассу" },
                        ]}
                        onChange={(v) => patch(i, {
                          sourceType: v as "cashIn" | "cashOut",
                          route: "hold",
                          categoryId: undefined,
                        })}
                      />
                      <Choice
                        name={`movement-route-${i}`}
                        label="Решение"
                        value={o.route}
                        options={[
                          { id: "hold", name: "Оставить на проверке" },
                          ...((o.sourceType ?? "cashOut") === "cashIn" ? [
                            { id: "income", name: "Поступление по статье" },
                            { id: "safe", name: "Из сейфа в кассу" },
                            { id: "operating", name: "С операционного счёта в кассу" },
                          ] : [
                            { id: "safe", name: "Перевод в сейф" },
                            { id: "operating", name: "Перевод на операционный счёт" },
                          ]),
                        ]}
                        onChange={(v) => patch(i, {
                          route: v as typeof o.route,
                          categoryId: v === "income" ? o.categoryId : undefined,
                        })}
                      />
                      {o.route === "income" && (
                        <Choice
                          name={`movement-category-${i}`}
                          label="Статья поступления"
                          value={o.categoryId ?? ""}
                          options={data.categories.filter((c) => c.type === "income")}
                          onChange={(categoryId) => patch(i, { categoryId })}
                        />
                      )}
                      <Field id={`movement-reason-${i}`} label="Основание решения" required>
                        {(control) => (
                          <Textarea
                            {...control}
                            value={o.reason}
                            maxLength={1000}
                            onChange={(e) => patch(i, { reason: e.target.value })}
                          />
                        )}
                      </Field>
                    </div>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  set("overrides", [
                    ...rules.overrides,
                    {
                      sourceId: 0,
                      date: "",
                      amountCents: 0,
                      comment: "",
                      sourceType: "cashOut",
                      route: "hold",
                      reason: "",
                    },
                  ])
                }
              >
                <Plus className="size-4" />
                Добавить решение
              </Button>
              <p className="text-xs text-muted-foreground">
                Решение действует только для указанного типа, суммы, даты и комментария.
                Изменившаяся операция требует новой проверки.
              </p>
            </div>
          </ExpandPanel>
        </DrawerSection>
        <Field id="movement-reason" label="Основание изменения правил" required>
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Что изменили и почему"
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </fieldset>
    </EditDrawer>
  );
}
export function CashMovementSettingsSection({
  venueId,
  initial,
}: {
  venueId: string;
  /** Настройки, загруженные сервером: секция сразу рисуется заполненной. */
  initial?: ActionResult<MovementConfiguration>;
}) {
  const [servedVenueId] = useState(venueId);
  const [data, setData] = useState<MovementConfiguration | null>(initial?.ok ? initial.data : null),
    [error, setError] = useState<string | null>(initial && !initial.ok ? initial.error : null),
    [open, setOpen] = useState(false);
  // Форму держим смонтированной, пока панель уезжает (docs/motion.md);
  // каждое открытие — новый ключ, форма начинается с сохранённых данных.
  const [session, setSession] = useState(0);
  const openForm = () => {
    setSession((n) => n + 1);
    setOpen(true);
  };
  useEffect(() => {
    // Данные, присланные сервером для этого заведения, уже на экране —
    // запрос не нужен (секция не меняет высоту после загрузки скриптов).
    if (initial && venueId === servedVenueId) return;
    let live = true;
    loadMovementConfiguration(venueId)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [venueId, initial, servedVenueId]);
  // Нет права — секции нет (как у «Проведения финансовых операций»).
  if (error === NO_ACCESS) return null;
  return (
    <ProfileSection
      title="Инкассации и внесения"
      description="Переводы из кассы, такси и выдача чаевых"
      actions={
        data ? (
          <Button variant="outline" size="sm" onClick={() => openForm()}>
            <Settings2 />
            Настроить
          </Button>
        ) : null
      }
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {data && !data.versions.length && (
        <p className="text-[13px] text-muted-foreground">
          Счета и статьи пока не сопоставлены. Сверка не создаёт операций.
        </p>
      )}
      {!!data?.versions.length && (
        <RuleHistory count={data.versions.length}>
          <ol className="divide-y text-sm">
            {data.versions.map((v) => (
              <li key={v.id} className="space-y-1 py-3">
                <p>
                  Версия {v.version} · {v.actor_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDayMonthTime(v.created_at)} · {v.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  Повторная сверка за{" "}
                  {countRu(v.config.lookbackDays, "день", "дня", "дней")} ·{" "}
                  {v.config.autoRead
                    ? `каждые ${v.config.intervalMinutes} мин`
                    : "вручную"}{" "}
                  · ручных решений {v.config.overrides.length}
                </p>
              </li>
            ))}
          </ol>
        </RuleHistory>
      )}
      {data && (
        <Form
          key={session}
          open={open}
          data={data}
          onClose={() => setOpen(false)}
          onSaved={(d) => {
            setData(d);
            setOpen(false);
          }}
        />
      )}
    </ProfileSection>
  );
}
