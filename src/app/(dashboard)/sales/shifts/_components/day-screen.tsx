"use client";
import { unwrapAction } from "@/lib/actions/result";
import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ProfileTabsList,
  Tabs,
  TabsContent,
  TabsTrigger,
} from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { AmountInput } from "@/components/finance/amount-input";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import { Money } from "@/components/shared/money";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection } from "@/components/shared/profile-section";
import { SaveBar } from "@/components/shared/save-bar";
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
import { TimelineSkeleton } from "../../_components/section-skeleton";
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

/** Вкладки экрана смены; `values` — для старых ссылок `?tab=…`. */
export const DAY_TABS = ["values", "cash", "employees", "comments", "history"];

/**
 * Блок кассы из боковой панели на странице — карточкой, как разделы
 * профиля. Пустой (панель ничего не нарисовала) не показывается.
 */
function PanelCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border bg-card p-5 empty:hidden">
      {children}
    </div>
  );
}

/**
 * Карточка смены во всю колонку вместо боковой панели: показатели
 * разложены просторно, касса, команда, обсуждение и история — вкладками.
 * Исправления сохраняются полосой внизу, как в других карточках.
 */
export function DayScreen({
  day,
  tab,
  timezone,
  canAdjust,
  onBack,
  onSaved,
}: {
  day: SalesDay;
  tab: string;
  timezone: string;
  canAdjust: boolean;
  onBack: () => void;
  onSaved: (d: SalesDay) => void;
}) {
  const original = effectiveMetrics(day);
  const [values, setValues] = useState<Metrics>(() => ({ ...original }));
  /** Показатели, у которых снимается ручное исправление. */
  const [resets, setResets] = useState<MetricKey[]>([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(day.note);
  const [activeTab, setActiveTab] = useState(
    DAY_TABS.includes(tab) ? tab : "values",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [events, setEvents] = useState<SalesEvent[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const screen = useRef<HTMLElement>(null);

  // Экран открывается сверху, как новая страница.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    screen.current?.focus({ preventScroll: true });
  }, []);

  const changes: Partial<Metrics> = {};
  const empty: MetricKey[] = [];
  for (const k of metricKeys) {
    if (resets.includes(k)) changes[k] = null;
    else if (values[k] !== original[k]) {
      if (values[k] === null) empty.push(k);
      else changes[k] = values[k];
    }
  }
  const metricsChanged = Object.keys(changes).length > 0 || empty.length > 0;
  const dirty = metricsChanged || note !== day.note;
  const { guard, dialog } = useDiscardGuard(
    dirty,
    "Исправления показателей не сохранятся",
  );
  const back = () => {
    if (!saving) guard(onBack);
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

  // Причина нужна, когда меняются показатели; правка одного комментария
  // уходит с готовой причиной.
  const reasonError =
    metricsChanged && reason.trim().length < 3
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
    const invalid = empty[0]
      ? `metric-${empty[0]}`
      : checksError
        ? "metric-checks"
        : reasonError
          ? "sales-reason"
          : null;
    if (invalid) {
      setActiveTab("values");
      requestAnimationFrame(() => document.getElementById(invalid)?.focus());
      return;
    }
    setSaving(true);
    try {
      const updated = unwrapAction(await adjustSales({
        id: day.id,
        version: day.version,
        changes,
        reason: metricsChanged ? reason.trim() : "Изменён комментарий к смене",
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
  const resetForm = () => {
    setValues({ ...original });
    setResets([]);
    setReason("");
    setNote(day.note);
    setShowErrors(false);
    setError(null);
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
  const title = `Смена ${formatDayMonth(day.business_date) ?? ""}`;

  const metricField = (k: MetricKey) => {
    const overridden = k in day.overrides && !resets.includes(k);
    const hint = resets.includes(k) ? (
      <>Вернётся исходное {show(k, day.calculated[k])}</>
    ) : overridden ? (
      <>
        Исправлено, было {show(k, day.calculated[k])} ·{" "}
        <button
          type="button"
          className="text-brand hover:underline"
          onClick={() => reset(k)}
        >
          Вернуть
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
              className="text-right tabular-nums"
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

  const metricValue = (k: MetricKey) => (
    <div key={k} className="min-w-0 space-y-1">
      <dt className="text-sm text-muted-foreground" data-tip={metricHints[k]}>
        {metricLabels[k]}
      </dt>
      <dd className="text-lg font-semibold tabular-nums">
        {isCount(k) ? formatCount(original[k]) : <Money value={original[k]} />}
      </dd>
    </div>
  );

  return (
    <section
      ref={screen}
      tabIndex={-1}
      aria-label={title}
      className="mx-auto w-full max-w-[720px] space-y-6 outline-none"
    >
      <Breadcrumbs
        items={[
          { label: "Продажи" },
          {
            label: "Смены",
            href: "/sales/shifts",
            onClick: (event) => {
              event.preventDefault();
              back();
            },
          },
          { label: title },
        ]}
      />
      <ProfileHeader
        name={title}
        avatar={
          <div
            aria-hidden
            className="flex size-14 items-center justify-center rounded-[14px] bg-muted text-muted-foreground"
          >
            <CalendarDays className="size-7" />
          </div>
        }
      >
        <span className="text-sm text-muted-foreground">
          {weekday.charAt(0).toUpperCase()}
          {weekday.slice(1)} · {synced}
        </span>
        <StatusBadge tone={salesStatuses[status].tone}>
          {salesStatuses[status].label}
        </StatusBadge>
        {adjusted && (
          <StatusBadge tone={salesStatuses.adjusted.tone}>
            {salesStatuses.adjusted.label}
          </StatusBadge>
        )}
      </ProfileHeader>
      {syncError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {syncError}. Показаны последние сохранённые значения
        </p>
      )}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <ProfileTabsList aria-label="Разделы смены">
          <TabsTrigger value="values">Показатели</TabsTrigger>
          <TabsTrigger value="cash">Касса</TabsTrigger>
          <TabsTrigger value="employees">Команда</TabsTrigger>
          <TabsTrigger value="comments">Обсуждение</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </ProfileTabsList>
        <TabsContent value="values" className="space-y-5">
          {groups.map((g) => (
            <ProfileSection key={g.title} title={g.title}>
              {canAdjust ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  {g.keys.map(metricField)}
                </div>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-3">
                  {g.keys.map(metricValue)}
                </dl>
              )}
            </ProfileSection>
          ))}
          {canAdjust ? (
            <ProfileSection title="Комментарий к смене">
              <Field
                id="sales-note"
                label={<span className="sr-only">Комментарий к смене</span>}
                className="gap-0"
              >
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
            </ProfileSection>
          ) : (
            day.note && (
              <ProfileSection title="Комментарий к смене">
                <p className="whitespace-pre-wrap break-words text-sm">
                  {day.note}
                </p>
              </ProfileSection>
            )
          )}
          {canAdjust && metricsChanged && (
            <ProfileSection
              title="Причина исправления"
              description="Сохранится в истории смены. Исправления не теряются при обновлении из Quick Resto"
            >
              <Field
                id="sales-reason"
                label={<span className="sr-only">Причина исправления</span>}
                className="gap-0 [&>p]:mt-2"
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
            </ProfileSection>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </TabsContent>
        <TabsContent value="cash" className="space-y-5">
          <PanelCard>
            <SettlementPanel venueId={day.venue_id} date={day.business_date} />
          </PanelCard>
          <PanelCard>
            <CashControlPanel venueId={day.venue_id} date={day.business_date} />
          </PanelCard>
          <PanelCard>
            <CashMovementsPanel venueId={day.venue_id} date={day.business_date} />
          </PanelCard>
          <PanelCard>
            <NativeFinancePanel
              key={day.venue_id + day.business_date}
              venueId={day.venue_id}
              date={day.business_date}
            />
          </PanelCard>
        </TabsContent>
        <TabsContent value="employees">
          <PanelCard>
            <PayrollDayPanel date={day.business_date} />
          </PanelCard>
        </TabsContent>
        <TabsContent value="comments">
          <PanelCard>
            <DayDiscussionPanel
              venueId={day.venue_id}
              date={day.business_date}
            />
          </PanelCard>
        </TabsContent>
        <TabsContent value="history" className="space-y-5">
          <PanelCard>
            <DrawerSection title="Показатели">
              {historyError ? (
                <p role="alert" className="text-sm text-destructive">
                  {historyError}
                </p>
              ) : events === null ? (
                <TimelineSkeleton label="Загружаем историю" />
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
          </PanelCard>
          <PanelCard>
            <CashControlHistory venueId={day.venue_id} date={day.business_date} />
          </PanelCard>
          <PanelCard>
            <CashMovementHistory venueId={day.venue_id} date={day.business_date} />
          </PanelCard>
          <PanelCard>
            <NativeFinancePanel
              key={day.venue_id + day.business_date}
              venueId={day.venue_id}
              date={day.business_date}
              history
            />
          </PanelCard>
        </TabsContent>
      </Tabs>
      {canAdjust && (
        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={() => void save()}
          onReset={resetForm}
        />
      )}
      {dialog}
    </section>
  );
}
