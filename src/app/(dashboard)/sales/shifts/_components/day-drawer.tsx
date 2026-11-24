"use client";
import { unwrapAction } from "@/lib/actions/result";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryTotal,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AmountInput } from "@/components/finance/amount-input";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import { Money } from "@/components/shared/money";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import {
  effectiveMetrics,
  metricHints,
  metricKeys,
  metricLabels,
  type MetricKey,
  type Metrics,
  type SalesDay,
  type SalesEvent,
} from "@/lib/sales/types";
import { formatCount, money, weekdayLabel } from "@/lib/sales/format";
import { salesErrorText } from "@/lib/sales/errors";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import { adjustSales, salesHistory } from "../actions";

import { PayrollDayPanel } from "@/app/(dashboard)/people/payroll/_components/payroll-context";
import { DayDiscussionPanel } from "../../_components/day-discussion";
import { SettlementPanel } from "./settlement-panel";
import { CashControlPanel } from "./cash-control-panel";
import { CashControlHistory } from "./cash-control-history";
import { CashMovementsPanel, CashMovementHistory } from "./cash-movements-panel";
import { NativeFinancePanel } from "./native-finance-panel";
import { salesDayStatus, salesStatuses } from "./sales-status-badge";

/** Показатели смены группами — так их легче проверить по кассовому отчёту. */
const groups: { title: string; keys: MetricKey[] }[] = [
  { title: "Выручка", keys: ["turnover", "hookah", "bar"] },
  { title: "Чаевые и сервисный сбор", keys: ["tips", "service", "tips_total"] },
  {
    title: "Касса и чеки",
    keys: ["checks", "staff_checks", "deposits", "parking", "taxi"],
  },
];
const isCount = (k: MetricKey) => k === "checks";
const show = (k: MetricKey, v: number | null | undefined) =>
  isCount(k) ? formatCount(v ?? null) : money(v ?? null);

export function DayDrawer({
  day,
  tab,
  timezone,
  canAdjust,
  onClose,
  onSaved,
}: {
  day: SalesDay;
  tab: string;
  timezone: string;
  canAdjust: boolean;
  onClose: () => void;
  onSaved: (d: SalesDay) => void;
}) {
  const original = effectiveMetrics(day);
  const [values, setValues] = useState<Metrics>(() => ({ ...original }));
  /** Показатели, у которых снимается ручное исправление. */
  const [resets, setResets] = useState<MetricKey[]>([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(day.note);
  const [activeTab, setActiveTab] = useState(tab);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [events, setEvents] = useState<SalesEvent[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const changes: Partial<Metrics> = {};
  const empty: MetricKey[] = [];
  for (const k of metricKeys) {
    if (resets.includes(k)) changes[k] = null;
    else if (values[k] !== original[k]) {
      if (values[k] === null) empty.push(k);
      else changes[k] = values[k];
    }
  }
  const dirty =
    Object.keys(changes).length > 0 || empty.length > 0 || note !== day.note;
  const { guard, dialog } = useDiscardGuard(
    dirty,
    "Исправления показателей не сохранятся",
  );
  const close = () => {
    if (!saving) guard(onClose);
  };

  useEffect(() => {
    if (activeTab !== "history" || events) return;
    let live = true;
    salesHistory(day.id)
      .then(unwrapAction)
      .then((v) => {
        if (live) {
          setEvents(v);
          setHistoryError(null);
        }
      })
      .catch(() => {
        if (live) setHistoryError("Не удалось загрузить историю. Откройте вкладку ещё раз");
      });
    return () => {
      live = false;
    };
  }, [activeTab, day.id, events]);

  const reasonError =
    reason.trim().length < 3
      ? "Напишите, почему меняете показатели, не короче 3 символов"
      : null;
  const checksError =
    values.checks !== null &&
    values.checks !== original.checks &&
    (!Number.isInteger(values.checks) || values.checks < 0)
      ? "Целое число"
      : null;
  const save = async () => {
    setError(null);
    setShowErrors(true);
    // Ошибка может быть ниже края панели — переводим фокус на первое поле с ней.
    const invalid = empty[0]
      ? `metric-${empty[0]}`
      : checksError
        ? "metric-checks"
        : reasonError
          ? "sales-reason"
          : null;
    if (invalid) {
      document.getElementById(invalid)?.focus();
      return;
    }
    setSaving(true);
    try {
      const updated = unwrapAction(await adjustSales({
        id: day.id,
        version: day.version,
        changes,
        reason: reason.trim(),
        note,
      }));
      toast.success("Исправления сохранены");
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить исправления");
    } finally {
      setSaving(false);
    }
  };
  const reset = (k: MetricKey) => {
    setResets((r) => [...r.filter((x) => x !== k), k]);
    setValues((v) => ({ ...v, [k]: day.calculated[k] ?? null }));
  };
  const change = (k: MetricKey, v: number | null) => {
    setResets((r) => r.filter((x) => x !== k));
    setValues((old) => ({ ...old, [k]: v }));
  };

  const status = salesDayStatus(day);
  const adjusted = Object.keys(day.overrides).length > 0;
  const synced = day.synced_at
    ? `обновлено ${formatDayMonthTime(day.synced_at, new Date(), timezone)}`
    : "ещё не обновлялась";
  const weekday = weekdayLabel(day.business_date);
  const syncError = salesErrorText(day.sync_error);
  const editing = canAdjust && activeTab === "values";

  const metricField = (k: MetricKey) => {
    const overridden = k in day.overrides && !resets.includes(k);
    const hint = resets.includes(k) ? (
      <>Исправление будет снято, вернётся {show(k, day.calculated[k])}</>
    ) : overridden ? (
      <>
        Исправлено вручную, исходное {show(k, day.calculated[k])} ·{" "}
        <button
          type="button"
          className="text-brand hover:underline"
          onClick={() => reset(k)}
        >
          Вернуть исходное
        </button>
      </>
    ) : undefined;
    const fieldError =
      showErrors && empty.includes(k)
        ? "Укажите значение или верните исходное"
        : showErrors && k === "checks"
          ? checksError
          : null;
    return (
      <Field
        key={k}
        id={`metric-${k}`}
        label={<span data-tip={metricHints[k]}>{metricLabels[k]}</span>}
        hint={hint}
        error={fieldError}
      >
        {(control) =>
          isCount(k) ? (
            <Input
              {...control}
              inputMode="numeric"
              className="tabular-nums"
              value={values[k] === null ? "" : String(values[k])}
              placeholder="Нет данных"
              onChange={(e) => {
                const raw = e.target.value.replace(/\s/g, "");
                change(k, raw === "" ? null : Number(raw));
              }}
            />
          ) : (
            <AmountInput
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              aria-invalid={control["aria-invalid"]}
              allowNegative
              placeholder="Нет данных"
              value={values[k]}
              onChange={(v) => change(k, v)}
            />
          )
        }
      </Field>
    );
  };

  return (
    <>
      <EditDrawer
        open
        onOpenChange={(v) => {
          if (!v) close();
        }}
        title={`Смена ${formatDayMonth(day.business_date) ?? ""}`}
        description={`${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${synced}`}
        titleAccessory={
          <>
            <DrawerStatus
              label={salesStatuses[status].label}
              tone={salesStatuses[status].tone}
            />
            {adjusted && (
              <DrawerStatus
                label={salesStatuses.adjusted.label}
                tone={salesStatuses.adjusted.tone}
              />
            )}
          </>
        }
        footer={
          editing ? (
            <>
              <Button variant="outline" disabled={saving} onClick={close}>
                Отмена
              </Button>
              <Button
                className="min-w-32"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                {saving ? "Сохраняем…" : "Сохранить"}
              </Button>
            </>
          ) : undefined
        }
      >
        {syncError && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {syncError}. Показаны последние сохранённые значения
          </p>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab} className={tabStyle.tabs}>
          <TabsList aria-label="Разделы смены">
            <TabsTrigger value="values">Показатели</TabsTrigger>
            <TabsTrigger value="employees">Команда</TabsTrigger>
            <TabsTrigger value="comments">Комментарии</TabsTrigger>
            <TabsTrigger value="history">История</TabsTrigger>
          </TabsList>
          <TabsContent value="values" className="space-y-9">
            {canAdjust ? (
              <>
                {groups.map((g) => (
                  <DrawerSection key={g.title} title={g.title}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {g.keys.map(metricField)}
                    </div>
                  </DrawerSection>
                ))}
                <DrawerSection title="Исправление">
                  <Field id="sales-note" label="Комментарий к смене">
                    {(control) => (
                      <Textarea
                        {...control}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={5000}
                        placeholder="Заметка о смене"
                      />
                    )}
                  </Field>
                  <Field
                    id="sales-reason"
                    label="Причина исправления"
                    required
                    hint="Сохранится в истории смены. Исправления не теряются при обновлении из Quick Resto"
                    error={showErrors ? reasonError : null}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        aria-required
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={1000}
                        placeholder="Почему меняете показатели"
                      />
                    )}
                  </Field>
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                </DrawerSection>
              </>
            ) : (
              <>
                <DrawerSummary label="Показатели смены">
                  <DrawerSummaryTotal label={metricLabels.turnover}>
                    <Money value={original.turnover} />
                  </DrawerSummaryTotal>
                </DrawerSummary>
                {groups.map((g) => (
                  <DrawerSection key={g.title} title={g.title}>
                    <dl className="divide-y">
                      {g.keys
                        .filter((k) => k !== "turnover")
                        .map((k) => (
                          <div
                            key={k}
                            className="flex justify-between gap-3 py-2.5 text-sm"
                          >
                            <dt
                              className="text-muted-foreground"
                              data-tip={metricHints[k]}
                            >
                              {metricLabels[k]}
                            </dt>
                            <dd className="tabular-nums">
                              {isCount(k) ? (
                                formatCount(original[k])
                              ) : (
                                <Money value={original[k]} />
                              )}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </DrawerSection>
                ))}
                {day.note && (
                  <DrawerSection title="Комментарий к смене">
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {day.note}
                    </p>
                  </DrawerSection>
                )}
              </>
            )}
            <SettlementPanel venueId={day.venue_id} date={day.business_date} />
            <CashControlPanel venueId={day.venue_id} date={day.business_date} />
            <CashMovementsPanel venueId={day.venue_id} date={day.business_date} />
            <NativeFinancePanel
              key={day.venue_id + day.business_date}
              venueId={day.venue_id}
              date={day.business_date}
            />
          </TabsContent>
          <TabsContent value="employees">
            <PayrollDayPanel date={day.business_date} />
          </TabsContent>
          <TabsContent value="comments">
            <DayDiscussionPanel
              venueId={day.venue_id}
              date={day.business_date}
            />
          </TabsContent>
          <TabsContent value="history" className="space-y-9">
            <DrawerSection title="Показатели">
              {historyError ? (
                <p role="alert" className="text-sm text-destructive">
                  {historyError}
                </p>
              ) : events === null ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Загружаем историю…
                </p>
              ) : events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Изменений пока нет
                </p>
              ) : (
                <DrawerTimeline>
                  {events.map((event, index) => {
                    const who =
                      event.kind === "adjustment"
                        ? event.actor_name || "Сотрудник"
                        : event.kind === "import"
                          ? "Перенос из прежнего учёта"
                          : "Quick Resto";
                    return (
                      <DrawerTimelineItem
                        key={event.id}
                        last={index === events.length - 1}
                        avatar={<DrawerAvatar name={who} />}
                        title={
                          event.kind === "adjustment"
                            ? "Исправлены показатели"
                            : event.kind === "import"
                              ? "Смена перенесена"
                              : "Показатели обновлены"
                        }
                        meta={`${who} · ${formatDayMonthTime(event.created_at, new Date(), timezone)}`}
                      >
                        {event.reason && (
                          <p className="break-words">{event.reason}</p>
                        )}
                        {event.kind === "adjustment" &&
                          Object.entries(event.changes).map(([k, raw]) => {
                            const c = raw as {
                              before: unknown;
                              after: unknown;
                              reset?: boolean;
                            };
                            const label =
                              k === "note"
                                ? "Комментарий"
                                : (metricLabels[k as MetricKey] ?? "Показатель");
                            const fmt = (v: unknown) =>
                              k === "note"
                                ? String(v || "—")
                                : show(k as MetricKey, v as number | null);
                            return (
                              <p
                                key={k}
                                className="break-words text-muted-foreground"
                              >
                                {label}: {fmt(c.before)} → {fmt(c.after)}
                                {c.reset ? " · возвращено исходное" : ""}
                              </p>
                            );
                          })}
                      </DrawerTimelineItem>
                    );
                  })}
                </DrawerTimeline>
              )}
            </DrawerSection>
            <CashControlHistory venueId={day.venue_id} date={day.business_date} />
            <CashMovementHistory venueId={day.venue_id} date={day.business_date} />
            <NativeFinancePanel
              key={day.venue_id + day.business_date}
              venueId={day.venue_id}
              date={day.business_date}
              history
            />
          </TabsContent>
        </Tabs>
      </EditDrawer>
      {dialog}
    </>
  );
}
