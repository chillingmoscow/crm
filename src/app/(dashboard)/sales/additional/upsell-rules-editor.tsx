"use client";
import { useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AmountInput } from "@/components/finance/amount-input";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { defaultAdditionalRules } from "@/lib/sales/additional";
import { lineKey, type UpsellTarget } from "@/lib/sales/upsell";
import {
  prefillUpsell,
  upsellStartVersion,
  type UpsellPickerItem,
  type UpsellPrefill,
} from "@/lib/sales/upsell-prefill";
import { unwrapAction } from "@/lib/actions/result";
import { saveUpsellRules, type AdditionalData, type UpsellDepartment } from "./actions";

export const TARGET_LABEL: Record<UpsellTarget, string> = {
  dish: "Блюдо",
  dish_group: "Категория",
  modifier: "Модификатор",
  modifier_group: "Группа модификаторов",
};
const SEARCH_LIMIT = 50;
const NAMES_SHOWN = 8;

/** Ставка в редакторе: null — поле пустое. */
type Row = { target: UpsellTarget; external_id: string; name: string; rate: number | null };

const validRate = (r: number | null): r is number =>
  r !== null && Number.isFinite(r) && r >= 0 && r <= 1_000_000;
const rowKey = (r: Pick<Row, "target" | "external_id">) => lineKey(r);

/**
 * Начало правки подразделения. Снимок берётся один раз при открытии вкладки:
 * опрос страницы обновляет `data`, но черновик сохраняется с той версией,
 * которую видел пользователь, — иначе чужое сохранение прошло бы проверку
 * «Правила изменились» и было бы молча перезаписано.
 */
type Draft = {
  depId: string;
  version: number;
  nextFrom: string;
  lines: Row[];
  prefill: UpsellPrefill | null;
  /** Дата другой версии, назначенной позже `nextFrom`. */
  laterFrom: string | null;
};

function initialDraft(data: AdditionalData, dep: UpsellDepartment): Draft {
  const { start, later } = upsellStartVersion(data.upsellRules, dep.id, data.nextFrom);
  const base = {
    depId: dep.id,
    version: dep.version,
    nextFrom: data.nextFrom,
    laterFrom: later?.valid_from ?? null,
  };
  if (start) return { ...base, lines: start.lines.map((l) => ({ ...l })), prefill: null };
  if (!dep.legacyKind) return { ...base, lines: [], prefill: null };
  const prefill = prefillUpsell({
    legacyKind: dep.legacyKind,
    // Как старый редактор: прежние правила, действующие на `nextFrom`.
    oldRules:
      data.rules.find((r) => r.valid_from <= data.nextFrom)?.config ?? defaultAdditionalRules,
    picker: data.picker,
  });
  return { ...base, lines: prefill.lines.map((l) => ({ ...l })), prefill };
}

function NameList({ title, names }: { title: string; names: string[] }) {
  if (!names.length) return null;
  const shown = names.slice(0, NAMES_SHOWN).join(", ");
  const rest = names.length - NAMES_SHOWN;
  return (
    <p>
      <span className="font-medium">{title}:</span> {shown}
      {rest > 0 && ` и ещё ${rest}`}
    </p>
  );
}

function AddPosition({
  picker,
  taken,
  onAdd,
}: {
  picker: UpsellPickerItem[];
  taken: Set<string>;
  onAdd: (p: UpsellPickerItem) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru");
    const live = picker.filter((p) => !p.archived);
    if (!q) return live.slice(0, SEARCH_LIMIT);
    const rank = (p: UpsellPickerItem) => {
      const name = p.name.toLocaleLowerCase("ru");
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      return p.path.toLocaleLowerCase("ru").includes(q) ? 2 : -1;
    };
    return live
      .map((p) => ({ p, r: rank(p) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .slice(0, SEARCH_LIMIT + 1)
      .map((x) => x.p);
  }, [picker, query]);
  const more = results.length > SEARCH_LIMIT;
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button ref={trigger} type="button" variant="outline" size="sm" aria-expanded={open}>
          <Plus className="size-4" />
          Добавить позицию
        </Button>
      </PopoverTrigger>
      {/* Внутри панели: прокрутка списка не упирается в блокировку модального окна. */}
      <PopoverContent
        portalContainer={trigger.current?.closest<HTMLElement>('[role="dialog"]')}
        align="start"
        className="w-96 max-w-[calc(100vw-32px)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Блюдо, категория или модификатор"
          />
          <CommandList className="max-h-[min(320px,50dvh)] overscroll-contain touch-pan-y [scrollbar-width:thin]">
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            {results.slice(0, SEARCH_LIMIT).map((p) => {
              const added = taken.has(p.key);
              return (
                <CommandItem
                  key={p.key}
                  value={p.key}
                  disabled={added}
                  className="items-start gap-3 px-3 py-2"
                  onSelect={() => {
                    onAdd(p);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {TARGET_LABEL[p.target]}
                      {p.path && ` · ${p.path}`}
                    </p>
                  </div>
                  {added && <Check aria-label="Уже добавлена" className="mt-0.5 size-3.5 shrink-0" />}
                </CommandItem>
              );
            })}
            {more && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Показаны первые {SEARCH_LIMIT}. Уточните поиск
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function UpsellRulesEditor({
  data,
  onClose,
  onSaved,
}: {
  data: AdditionalData;
  onClose: () => void;
  onSaved: (d: AdditionalData) => void;
}) {
  const [initial, setInitial] = useState<Draft | null>(() =>
    data.departments[0] ? initialDraft(data, data.departments[0]) : null,
  );
  const depId = initial?.depId ?? "";
  const dep = data.departments.find((d) => d.id === depId) ?? null;
  const [lines, setLines] = useState<Row[]>(() => initial?.lines ?? []);
  const [from, setFrom] = useState(initial?.nextFrom ?? data.nextFrom),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [showErrors, setShowErrors] = useState(false);

  const dirty =
    JSON.stringify(lines) !== JSON.stringify(initial?.lines ?? []) ||
    reason.trim() !== "" ||
    from !== (initial?.nextFrom ?? data.nextFrom);
  const { guard, dialog } = useDiscardGuard(dirty, "Новые правила подразделения не сохранятся");
  const pickerByKey = useMemo(() => new Map(data.picker.map((p) => [p.key, p])), [data.picker]);
  const taken = useMemo(() => new Set(lines.map(rowKey)), [lines]);
  const versions = data.upsellRules.filter((r) => r.department_id === depId);
  const prefill = initial?.prefill ?? null;
  const reasonError = reason.trim().length < 3 ? "Напишите причину, не короче 3 символов" : null;
  const ratesValid = lines.every((l) => validRate(l.rate));

  function switchTo(id: string) {
    const next = data.departments.find((d) => d.id === id);
    if (!next) return;
    const draft = initialDraft(data, next);
    setInitial(draft);
    setLines(draft.lines);
    setFrom(draft.nextFrom);
    setReason("");
    setError(null);
    setShowErrors(false);
  }

  async function save() {
    if (!dep || !initial) return;
    setShowErrors(true);
    setError(null);
    if (!ratesValid) {
      setError("Проверьте ставки: нужно неотрицательное число в каждой строке");
      return;
    }
    if (reasonError || !from) {
      document.getElementById("upsell-reason")?.focus();
      return;
    }
    setBusy(true);
    try {
      const next = unwrapAction(await saveUpsellRules({
        venueId: data.venueId,
        departmentId: dep.id,
        version: initial.version,
        from,
        lines: lines.map((l) => ({
          target: l.target,
          external_id: l.external_id,
          // Название из номенклатуры: после переименования в Quick Resto версия не отстаёт.
          name: pickerByKey.get(rowKey(l))?.name ?? l.name,
          rate: Math.round((l.rate as number) * 100) / 100,
        })),
        reason: reason.trim(),
      }));
      onSaved(next);
      toast.success(`Новая версия правил «${dep.name}» сохранена`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <EditDrawer
        open
        onOpenChange={(v) => {
          if (!v && !busy) guard(onClose);
        }}
        title="Правила допродаж"
        description="Прибавка за каждую проданную позицию, по подразделениям"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => guard(onClose)}>
              Отмена
            </Button>
            <Button
              className="min-w-32"
              disabled={busy || !dep || (!dirty && !prefill)}
              onClick={() => void save()}
            >
              {busy ? "Сохраняем…" : "Сохранить версию"}
            </Button>
          </>
        }
      >
        {!dep ? (
          <p className="text-sm text-muted-foreground">В заведении нет подразделений</p>
        ) : (
          <>
            <Tabs
              value={depId}
              onValueChange={(v) => {
                if (v !== depId && !busy) guard(() => switchTo(v));
              }}
              className={tabStyle.tabs}
            >
              <TabsList aria-label="Подразделение">
                {data.departments.map((d) => (
                  <TabsTrigger key={d.id} value={d.id}>
                    {d.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={depId} className="space-y-9">
                <DrawerSection
                  title="Прибавка за продажу"
                  description={
                    prefill
                      ? "Первая версия: строки перенесены из прежних правил. Проверьте ставки и сохраните"
                      : "Рублей за одну проданную позицию. Ставка категории действует на каждую позицию внутри"
                  }
                >
                  {initial?.laterFrom && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                      С {formatDayMonth(initial.laterFrom)} запланирована другая версия
                    </p>
                  )}
                  {prefill &&
                    (prefill.notFound.length > 0 ||
                      prefill.taggedWithoutRate.length > 0 ||
                      prefill.ratedWithoutTag.length > 0) && (
                      <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                        <NameList title="Нет в номенклатуре" names={prefill.notFound} />
                        <NameList
                          title="С тегом «Продажи / Бар», но без ставки"
                          names={prefill.taggedWithoutRate}
                        />
                        <NameList
                          title="Со ставкой, но без тега «Продажи / Бар»"
                          names={prefill.ratedWithoutTag}
                        />
                      </div>
                    )}
                  {lines.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">Позиций пока нет</p>
                  ) : (
                    <ul className="divide-y">
                      {lines.map((l, i) => {
                        const key = rowKey(l);
                        const item = pickerByKey.get(key);
                        const invalid = showErrors && !validRate(l.rate);
                        return (
                          <li key={key} className="flex items-center gap-3 py-3">
                            <div className="min-w-0 flex-1">
                              <label htmlFor={`upsell-rate-${key}`} className="block truncate text-sm font-medium">
                                {item?.name ?? l.name}
                              </label>
                              <p className="truncate text-[13px] text-muted-foreground">
                                {TARGET_LABEL[l.target]}
                                {item?.path && ` · ${item.path}`}
                              </p>
                              {(!item || item.archived) && (
                                <p className="text-xs text-amber-700 dark:text-amber-400">
                                  {item ? "В архиве Quick Resto" : "Нет в номенклатуре"}
                                </p>
                              )}
                            </div>
                            <AmountInput
                              id={`upsell-rate-${key}`}
                              aria-invalid={invalid || undefined}
                              className="w-32 shrink-0"
                              value={l.rate}
                              onChange={(v) =>
                                setLines((ls) => ls.map((x, j) => (j === i ? { ...x, rate: v } : x)))
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                              aria-label={`Убрать «${l.name}»`}
                              data-tip="Убрать из правил"
                              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div>
                    <AddPosition
                      picker={data.picker}
                      taken={taken}
                      onAdd={(p) =>
                        setLines((ls) => [
                          ...ls,
                          { target: p.target, external_id: p.external_id, name: p.name, rate: null },
                        ])
                      }
                    />
                  </div>
                </DrawerSection>
              </TabsContent>
            </Tabs>
            <DrawerSection title="Новая версия">
              <Field id="upsell-from" label="Действует с" required hint="Уже посчитанные дни не меняются">
                {(control) => (
                  <DatePicker
                    id={control.id}
                    value={from}
                    onChange={setFrom}
                    fromDate={new Date(data.nextFrom + "T00:00:00")}
                    clearable={false}
                  />
                )}
              </Field>
              <Field
                id="upsell-reason"
                label="Причина изменения"
                required
                error={showErrors ? reasonError : null}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    aria-required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={1000}
                    placeholder="Например, новые позиции в барной карте"
                  />
                )}
              </Field>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </DrawerSection>
            {versions.length > 0 && (
              <DrawerSection title="История правил">
                <ul className="divide-y text-sm">
                  {versions.map((r) => (
                    <li key={r.id} className="space-y-1 py-3">
                      <p className="font-medium">С {formatDayMonth(r.valid_from)}</p>
                      {r.reason && <p className="break-words text-muted-foreground">{r.reason}</p>}
                      <p className="text-xs text-muted-foreground">
                        {formatDayMonthTime(r.created_at, new Date(), data.timezone)}
                        {" · "}
                        {countRu(r.lines.length, "позиция", "позиции", "позиций")}
                      </p>
                    </li>
                  ))}
                </ul>
              </DrawerSection>
            )}
          </>
        )}
      </EditDrawer>
      {dialog}
    </>
  );
}
