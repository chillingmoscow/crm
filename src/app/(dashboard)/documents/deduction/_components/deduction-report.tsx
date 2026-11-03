"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageFrame } from "@/components/shared/page-frame";
import { MonthPicker } from "@/components/shared/month-picker";
import { TableControlPin, TableControls, TablePageHeader } from "@/components/shared/table";
import { InventoryStatusBadge, WARNING_BADGE_CLASS } from "@/components/shared/inventory-status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { reconcileDeduction, type ReconcileRow, type ReconcileStatus } from "@/lib/stock/deduction-reconciliation";
import {
  matchSheetNames,
  normalizePersonName,
  parseSheetPaste,
  sheerlySideFor,
} from "@/lib/stock/deduction-sheet";
import { recalculateInventoryDeduction } from "@/app/(dashboard)/inventory/_actions/deduction";
import type { DeductionActionResult } from "@/app/(dashboard)/inventory/deduction-service";
import type { DeductionReportData } from "@/app/(dashboard)/inventory/deduction-report";

const money = (v: number) => `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const signedMoney = (v: number) =>
  `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2, signDisplay: "exceptZero" })} ₽`;

/** Значение `datetime-local` (время браузера) для текущего момента. */
function nowForInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const STATUS_VIEW: Record<ReconcileStatus, { palette: string; label: string }> = {
  match: { palette: "processed", label: "Совпало" },
  differs: { palette: "in_progress", label: "Расходится" },
  only_sheerly: { palette: "assigned", label: "Нет в таблице" },
  only_sheet: { palette: "ready_for_review", label: "Нет в расчёте" },
  unknown: { palette: "synced", label: "Сумма неизвестна" },
};
const STATUS_FILTERS: Array<{ value: "all" | "problems" | ReconcileStatus; label: string }> = [
  { value: "all", label: "Все" },
  { value: "problems", label: "Только расхождения" },
  { value: "match", label: "Совпало" },
  { value: "differs", label: "Расходится" },
  { value: "only_sheerly", label: "Нет в таблице" },
  { value: "unknown", label: "Сумма неизвестна" },
];

export function DeductionReport({ data }: { data: DeductionReportData }) {
  const router = useRouter();
  const pathname = usePathname();
  const { calc } = data;

  // Штамп времени пишется в часовом поясе заведения: обе стороны читаются в одной шкале.
  const stamp = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { timeZone: data.timezone, dateStyle: "short", timeStyle: "short" });

  // ── Таблица: вставка и момент снятия ──────────────────────────
  const [pasted, setPasted] = useState("");
  const [sheetAtInput, setSheetAtInput] = useState("");
  const stampEdited = useRef(false);
  const sheetAtIso = sheetAtInput ? new Date(sheetAtInput).toISOString() : null;

  function onPasteChange(text: string) {
    setPasted(text);
    // Момент снятия по умолчанию - когда вставили; ручную правку не затираем.
    if (!stampEdited.current) setSheetAtInput(text.trim() ? nowForInput() : "");
  }

  const parsed = useMemo(() => parseSheetPaste(pasted), [pasted]);
  const matching = useMemo(
    () => matchSheetNames(parsed.entries, data.employees),
    [parsed.entries, data.employees],
  );
  const nameById = useMemo(() => new Map(data.employees.map((e) => [e.id, e.name] as const)), [data.employees]);

  const rows = useMemo<ReconcileRow[]>(() => {
    if (!sheetAtIso) return [];
    const sheerly = sheerlySideFor({
      state: calc.state,
      capturedAt: calc.capturedAt,
      lines: calc.lines,
      knownEmployeeIds: matching.matched.map((m) => m.employeeId),
    });
    return reconcileDeduction(sheerly, {
      capturedAt: sheetAtIso,
      entries: matching.matched.map((m) => ({ employeeId: m.employeeId, amount: m.amount })),
    });
  }, [calc.state, calc.capturedAt, calc.lines, matching.matched, sheetAtIso]);

  // ── Фильтры таблицы ───────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]["value"]>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const visibleRows = useMemo(() => {
    const q = normalizePersonName(search);
    return rows
      .filter((r) =>
        statusFilter === "all"
          ? true
          : statusFilter === "problems"
            ? r.status !== "match"
            : r.status === statusFilter,
      )
      .filter((r) => !q || normalizePersonName(nameById.get(r.employeeId) ?? "").includes(q))
      .sort((a, b) => (nameById.get(a.employeeId) ?? "").localeCompare(nameById.get(b.employeeId) ?? "", "ru"));
  }, [rows, statusFilter, search, nameById]);

  // ── Итоги двух сторон ─────────────────────────────────────────
  // Сторона таблицы - все прочитанные строки вставки, найденные и ненайденные: деньги
  // не пропадают из итога из-за того, что имя не сопоставилось.
  const sheetTotal = parsed.entries.reduce((s, e) => s + (e.amount ?? 0), 0);
  const sheetHasGaps = parsed.entries.some((e) => e.amount === null) || parsed.errors.length > 0;
  const sheerlyTotal = calc.state === "incomplete" ? null : calc.employeesTotal;
  const totalDelta = sheerlyTotal === null ? null : Math.round((sheerlyTotal - sheetTotal) * 100) / 100;

  // ── Пересчёт месяца ───────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DeductionActionResult | null>(null);
  async function recalculate() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const result = await recalculateInventoryDeduction({ venueId: data.venueId, month: data.month });
      setOutcome(result);
      if (result.error) toast.error(result.error);
      else toast.success("Месяц пересчитан");
      // Отчёт читается заново: штамп расчёта и записанная строка обновятся.
      router.refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Не удалось пересчитать месяц";
      setOutcome({ error: text, summary: null });
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  const recordedBehind =
    data.recorded !== null &&
    !data.recorded.reversed &&
    calc.state === "ready" &&
    Math.round(data.recorded.employeesTotal * 100) !== Math.round(calc.employeesTotal * 100);

  return (
    <PageFrame className="min-w-0 space-y-6">
      <TablePageHeader
        // whitespace-normal: заголовок h1 в TablePageHeader усекается, а на 390 px длинное имя страницы должно переноситься.
        title={<span className="whitespace-normal">Удержание по недостаче</span>}
        subtitle="Сличение расчёта Sheerly с Google-таблицей. Страница читает: таблицу она не меняет."
        actions={
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Пересчитать месяц
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <MonthPicker
            value={data.month}
            min="2025-01-01"
            max={data.currentMonth}
            onChange={(v) => router.push(`${pathname}?month=${v}`)}
            variant="field"
            prefix=""
            ariaLabel="Месяц удержания"
          />
        </div>
      </div>

      {/* Результат ручного пересчёта: что вернулось, включая отказ. */}
      {outcome && (
        <div
          role="status"
          className={cn(
            "rounded-lg border p-4 text-sm",
            outcome.error ? "border-destructive/30 bg-destructive/10 text-destructive" : "bg-muted/40",
          )}
        >
          {outcome.error ?? outcome.summary}
          {!outcome.error && outcome.state === "incomplete" && outcome.unresolved && (
            <span className="mt-1 block text-muted-foreground">Полный перечень - в блоке «Чего не хватает» ниже.</span>
          )}
          {!outcome.error && outcome.inactive && outcome.inactive.length > 0 && (
            <span className="mt-1 block">
              Уволенным сотрудникам поставлено: {outcome.inactive.map((i) => `${i.name} (${money(Math.abs(i.amount))})`).join(", ")}.
            </span>
          )}
        </div>
      )}

      {/* Допуск 250 ₽: известная причина расхождения, называем там, где видны разницы. */}
      <div role="note" className="flex gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          Допуск 250 ₽ по ингредиентам расчёт Sheerly <strong>сознательно не применяет</strong>: как он должен
          работать, на реальной инвентаризации не проверено. Если таблица допуск учитывает, суммы будут расходиться
          из-за него. Это известная причина, а не ошибка расчёта.
        </p>
      </div>

      {/* Два момента снятия. Разница без них нечитаема: таблица живая. */}
      <section className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2" aria-label="Моменты снятия">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Расчёт Sheerly снят</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{stamp(calc.capturedAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Время заведения ({data.timezone})
            {calc.ruleVersion !== null && calc.ruleValidFrom
              ? `. Правила: версия ${calc.ruleVersion} с ${new Date(`${calc.ruleValidFrom.slice(0, 10)}T12:00:00`).toLocaleDateString("ru-RU")}`
              : ""}
          </p>
        </div>
        <div className="min-w-0">
          <label htmlFor="sheet-at" className="text-sm text-muted-foreground">
            Таблица снята
          </label>
          <input
            id="sheet-at"
            type="datetime-local"
            value={sheetAtInput}
            disabled={!pasted.trim()}
            onChange={(e) => {
              stampEdited.current = true;
              setSheetAtInput(e.target.value);
            }}
            className="mt-1 block h-10 w-full max-w-full rounded-md border border-input bg-background px-3 text-base tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-50 sm:text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {sheetAtIso
              ? `В часовом поясе заведения: ${stamp(sheetAtIso)}. Время подставляется при вставке; поправьте, если копировали раньше.`
              : "Появится, когда вставите данные из таблицы."}
          </p>
        </div>
        {data.recorded && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            В ведомость поставлено: расчёт от {stamp(data.recorded.capturedAt)}, удержано с сотрудников{" "}
            {money(data.recorded.employeesTotal)}
            {data.recorded.authorName ? `, поставил(а) ${data.recorded.authorName}` : ""}
            {data.recorded.reversed ? ". Позже сторнировано: месяц снова не посчитан" : ""}.
            {recordedBehind && (
              <span className={cn("ml-1 inline-block rounded-md border px-1.5 py-0.5", WARNING_BADGE_CLASS)}>
                Расчёт сейчас отличается от поставленного: нажмите «Пересчитать месяц»
              </span>
            )}
          </p>
        )}
      </section>

      {/* Неполный месяц - не нулевой: вместо цифр то, чего не хватает. */}
      {calc.state === "incomplete" && (
        <section role="alert" className={cn("space-y-3 rounded-lg border p-4 text-sm", WARNING_BADGE_CLASS)}>
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0" />
            Месяц {data.monthLabel} не посчитан до конца
          </p>
          <p>
            Это не нулевой месяц и не «удерживать нечего»: расчёта пока нет, поэтому сумм по сотрудникам здесь нет.
            Они появятся, когда данные будут дополнены и месяц пересчитан.
          </p>
          {calc.missing.map((g) => (
            <div key={g.kind}>
              <p className="font-medium">{g.title}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {g.items.map((it, i) => (
                  <li key={`${it.label}-${i}`} className="break-words">
                    {it.href ? (
                      <Link href={it.href} className="underline underline-offset-2">
                        {it.label}
                      </Link>
                    ) : (
                      it.label
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {calc.dataProblems.length > 0 && (
        <section className={cn("space-y-3 rounded-lg border p-4 text-sm", WARNING_BADGE_CLASS)} aria-label="Проблемы данных">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0" />
            Проблемы данных вне месяца
          </p>
          <p>Эти акты не относятся ни к одному месяцу, расчёт месяца они не блокируют, но в нём не учтены.</p>
          {calc.dataProblems.map((p) => (
            <div key={p.title}>
              <p className="font-medium">{p.title}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {p.items.map((it, i) => (
                  <li key={`${it.label}-${i}`} className="break-words">
                    {it.href ? (
                      <Link href={it.href} className="underline underline-offset-2">
                        {it.label}
                      </Link>
                    ) : (
                      it.label
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {calc.state === "disabled" && (
        <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">
          Правила удержаний за {data.monthLabel} выключены: недостачу целиком покрывает заведение, с сотрудников
          по расчёту ничего не удерживается.
        </p>
      )}

      {/* Итоги: обе суммы, у каждой свой момент снятия. */}
      <section className="grid grid-cols-1 gap-y-4 rounded-lg border bg-card py-5 sm:grid-cols-3" aria-label="Итоги сличения">
        <div className="px-4 sm:border-r sm:px-5">
          <p className="text-sm text-muted-foreground">Sheerly: удержано с сотрудников</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {sheerlyTotal === null ? <span className="text-muted-foreground">не посчитано</span> : money(sheerlyTotal)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Снято {stamp(calc.capturedAt)}</p>
        </div>
        <div className="px-4 sm:border-r sm:px-5">
          <p className="text-sm text-muted-foreground">Таблица: сумма вставленных строк</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {sheetAtIso ? money(sheetTotal) : <span className="text-muted-foreground">не вставлено</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sheetAtIso ? `Снято ${stamp(sheetAtIso)}` : "Вставьте столбцы из таблицы ниже"}
            {sheetAtIso && sheetHasGaps ? ". Итог неполный: есть пустые суммы или нечитаемые строки" : ""}
          </p>
        </div>
        <div className="px-4 sm:px-5">
          <p className="text-sm text-muted-foreground">Разница (Sheerly минус таблица)</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {sheetAtIso && totalDelta !== null ? signedMoney(totalDelta) : <span className="text-muted-foreground">нет данных</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Совпадение итогов не доказывает совпадения по людям: смотрите таблицу по сотрудникам.
          </p>
        </div>
      </section>

      {/* Вставка из таблицы. */}
      <section className="space-y-2" aria-label="Данные из таблицы">
        <label htmlFor="sheet-paste" className="text-sm font-medium">
          Колонка I из Google-таблицы
        </label>
        <Textarea
          id="sheet-paste"
          value={pasted}
          onChange={(e) => onPasteChange(e.target.value)}
          placeholder={"Иванов Иван\t1 500,50\nПетрова Анна\t300"}
          className="min-h-[120px] resize-y text-base sm:text-sm"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Скопируйте два столбца: имя сотрудника и сумма. Имя должно совпадать с именем в ведомости Sheerly. Подходят
          табуляция или точка с запятой, запятая или точка в копейках; первая строка-заголовок пропускается. Данные
          нигде не сохраняются: они живут только на этой странице.
        </p>
        {parsed.headerText !== null && (
          <p className="text-xs text-muted-foreground">Первая строка принята за заголовок и пропущена: «{parsed.headerText.replace(/\t/g, " | ")}»</p>
        )}
        {parsed.errors.length > 0 && (
          <div role="alert" className={cn("rounded-lg border p-3 text-sm", WARNING_BADGE_CLASS)}>
            <p className="font-medium">Не удалось разобрать строк: {parsed.errors.length}. Они не учтены в сличении.</p>
            <ul className="mt-1 space-y-0.5">
              {parsed.errors.map((e) => (
                <li key={e.line} className="break-words">
                  Строка {e.line}: «{e.text.replace(/\t/g, " | ")}» - {e.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {matching.unmatched.length > 0 && (
        <section className="space-y-2" aria-label="Не найдены в Sheerly">
          <h2 className="text-lg font-semibold">Не найдены в Sheerly</h2>
          <p className="text-sm text-muted-foreground">
            Эти строки таблицы не сопоставлены с сотрудником и не вошли в таблицу ниже. Их суммы входят в итог таблицы.
          </p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Имя в таблице</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                  <th className="px-3 py-2 font-medium">Причина</th>
                </tr>
              </thead>
              <tbody>
                {matching.unmatched.map((u) => (
                  <tr key={u.line} className="border-t">
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {u.amount === null ? <span className="text-muted-foreground">пусто</span> : money(u.amount)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {u.reason === "ambiguous"
                        ? `Имя подходит нескольким сотрудникам (${u.candidates?.join("; ")}): выбирать наугад нельзя`
                        : "Такого сотрудника нет в ведомости Sheerly"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Сличение по сотрудникам. */}
      {sheetAtIso && (
        <section className="space-y-4" aria-label="Сличение по сотрудникам">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">По сотрудникам</h2>
            <TableControls
              search={{
                value: search,
                onChange: setSearch,
                open: searchOpen,
                onOpenChange: setSearchOpen,
                placeholder: "Поиск",
              }}
              filters={{ active: statusFilter !== "all", onClick: () => setFiltersOpen(!filtersOpen) }}
            />
          </div>
          {(filtersOpen || statusFilter !== "all") && (
            <div className="flex flex-wrap items-center gap-2">
              <TableControlPin
                label={statusFilter === "all" ? "Статус" : (STATUS_FILTERS.find((f) => f.value === statusFilter)?.label ?? "Статус")}
                active={statusFilter !== "all"}
                onClear={() => setStatusFilter("all")}
              >
                <div className="space-y-0.5">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      type="button"
                      key={f.value}
                      onClick={() => setStatusFilter(f.value)}
                      className={cn(
                        "flex w-full items-center rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                        statusFilter === f.value && "bg-muted font-medium",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </TableControlPin>
            </div>
          )}
          {visibleRows.length === 0 ? (
            <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              {rows.length === 0
                ? "Нет ни одной сопоставленной строки: проверьте вставленные данные и имена."
                : "Под выбранный фильтр ничего не попало."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/60 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Сотрудник</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Sheerly
                      <span className="block text-xs font-normal">{stamp(calc.capturedAt)}</span>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Таблица
                      <span className="block text-xs font-normal">{stamp(sheetAtIso)}</span>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Разница</th>
                    <th className="px-3 py-2 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const view = STATUS_VIEW[r.status];
                    return (
                      <tr key={r.employeeId} className="border-t">
                        <td className="px-3 py-2 font-medium">{nameById.get(r.employeeId) ?? "Сотрудник вне справочника"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.sheerly === null ? <span className="text-muted-foreground">не посчитано</span> : money(r.sheerly)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.sheet === null ? (
                            <span className="text-muted-foreground">{r.status === "only_sheerly" ? "нет в таблице" : "ячейка пуста"}</span>
                          ) : (
                            money(r.sheet)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.delta === null ? <span className="text-muted-foreground">нет данных</span> : signedMoney(r.delta)}
                        </td>
                        <td className="px-3 py-2">
                          <InventoryStatusBadge status={view.palette} label={view.label} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Пересчитать удержание за {data.monthLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              Если месяц посчитан до конца, строки удержания будут поставлены в зарплатную ведомость Sheerly (прежние
              сторнируются). Таблицу это не меняет. Если данных не хватает, в ведомость ничего не попадёт, а страница
              покажет, чего не хватает.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void recalculate()}>Пересчитать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  );
}
