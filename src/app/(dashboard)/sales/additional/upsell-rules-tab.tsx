"use client";
import { useMemo, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AmountInput } from "@/components/finance/amount-input";
import {
  ProfileSection,
  ProfileSectionAddButton,
} from "@/components/shared/profile-section";
import { useSaveSection } from "@/components/shared/save-bar";
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
import { saveUpsellRules, type UpsellEditorData } from "./actions";
import { TARGET_LABEL } from "./upsell-labels";

const SEARCH_LIMIT = 50;
const NAMES_SHOWN = 8;

/** Ставка в редакторе: null — поле пустое. */
type Row = {
  target: UpsellTarget;
  external_id: string;
  name: string;
  rate: number | null;
};

const validRate = (r: number | null): r is number =>
  r !== null && Number.isFinite(r) && r >= 0 && r <= 1_000_000;
const rowKey = (r: Pick<Row, "target" | "external_id">) => lineKey(r);

/**
 * Начало правки подразделения. Снимок берётся один раз при открытии вкладки:
 * черновик сохраняется с той версией, которую видел пользователь, — иначе
 * чужое сохранение прошло бы проверку «Правила изменились» и было бы молча
 * перезаписано.
 */
type Draft = {
  version: number;
  nextFrom: string;
  lines: Row[];
  prefill: UpsellPrefill | null;
  /** Дата другой версии, назначенной позже `nextFrom`. */
  laterFrom: string | null;
};

function initialDraft(data: UpsellEditorData): Draft {
  const dep = data.department;
  const { start, later } = upsellStartVersion(
    data.upsellRules,
    dep.id,
    data.nextFrom,
  );
  const base = {
    version: dep.version,
    nextFrom: data.nextFrom,
    laterFrom: later?.valid_from ?? null,
  };
  if (start)
    return {
      ...base,
      lines: start.lines.map((l) => ({ ...l })),
      prefill: null,
    };
  if (!dep.legacyKind) return { ...base, lines: [], prefill: null };
  const prefill = prefillUpsell({
    legacyKind: dep.legacyKind,
    // Прежние правила, действующие на `nextFrom`.
    oldRules:
      data.rules.find((r) => r.valid_from <= data.nextFrom)?.config ??
      defaultAdditionalRules,
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
        <ProfileSectionAddButton aria-expanded={open}>
          Добавить позицию
        </ProfileSectionAddButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-32px)] p-0">
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
                  {added && (
                    <Check
                      aria-label="Уже добавлена"
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                  )}
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

/**
 * Вкладка «Допродажи» карточки подразделения: ставки за проданные позиции,
 * новая версия правил и история. Сохраняется общей полосой карточки.
 */
export function UpsellRulesTab({
  initial: initialData,
}: {
  initial: UpsellEditorData;
}) {
  const [data, setData] = useState(initialData);
  const [initial, setInitial] = useState<Draft>(() =>
    initialDraft(initialData),
  );
  const dep = data.department;
  const [lines, setLines] = useState<Row[]>(() => initial.lines);
  const [from, setFrom] = useState(initial.nextFrom),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [showErrors, setShowErrors] = useState(false);

  // Подставленная первая версия считается изменением, только когда её начали
  // править: иначе полоса висела бы на любой вкладке карточки.
  const dirty =
    JSON.stringify(lines) !== JSON.stringify(initial.lines) ||
    reason.trim() !== "" ||
    from !== initial.nextFrom;
  const prefill = initial.prefill;
  const pickerByKey = useMemo(
    () => new Map(data.picker.map((p) => [p.key, p])),
    [data.picker],
  );
  const taken = useMemo(() => new Set(lines.map(rowKey)), [lines]);
  const versions = data.upsellRules;
  const reasonError =
    reason.trim().length < 3 ? "Напишите причину, не короче 3 символов" : null;
  const ratesValid = lines.every((l) => validRate(l.rate));
  // Пустая первая версия ничего не оплачивает, но вывела бы подразделение
  // на «Допродажи». Пустая следующая — законный способ выключить допродажи.
  const blocked = !lines.length && !versions.length
    ? "Добавьте в правила допродаж хотя бы одну позицию"
    : !ratesValid
    ? "Укажите ставку допродаж в каждой строке"
    : reasonError
      ? "Напишите причину изменения правил допродаж"
      : !from
        ? "Укажите, с какого дня действуют правила допродаж"
        : null;

  function startDraft(next: Draft) {
    setInitial(next);
    setLines(next.lines);
    setFrom(next.nextFrom);
    setReason("");
    setShowErrors(false);
  }

  async function save(): Promise<boolean> {
    setShowErrors(true);
    if (blocked) return false;
    setBusy(true);
    try {
      const next = unwrapAction(
        await saveUpsellRules({
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
        }),
      );
      setData(next);
      startDraft(initialDraft(next));
      toast.success("Новая версия правил допродаж сохранена");
      return true;
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Не удалось сохранить правила допродаж",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  const bar = useSaveSection({
    dirty,
    saving: busy,
    blocked: dirty ? blocked : null,
    save,
    reset: () => startDraft({ ...initial }),
  });

  return (
    <div className="flex flex-col gap-5">
      <ProfileSection
        title="Прибавка за продажу"
        description={
          prefill
            ? "Первая версия: строки перенесены из прежних правил. Проверьте ставки, напишите причину и сохраните"
            : "Рублей за одну проданную позицию. Ставка категории действует на каждую позицию внутри"
        }
        actions={
          <AddPosition
            picker={data.picker}
            taken={taken}
            onAdd={(p) =>
              setLines((ls) => [
                ...ls,
                {
                  target: p.target,
                  external_id: p.external_id,
                  name: p.name,
                  rate: null,
                },
              ])
            }
          />
        }
      >
        {initial.laterFrom && (
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
                <li
                  key={key}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`upsell-rate-${key}`}
                      className="block truncate text-sm font-medium"
                    >
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
                      setLines((ls) =>
                        ls.map((x, j) => (j === i ? { ...x, rate: v } : x)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Убрать «${l.name}»`}
                    data-tip="Убрать из правил"
                    onClick={() =>
                      setLines((ls) => ls.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </ProfileSection>
      <ProfileSection
        title="Новая версия"
        description="Правила меняются новой версией с выбранного дня. Уже посчитанные дни не меняются"
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,240px)_1fr]">
          <Field id="upsell-from" label="Действует с" required>
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
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                placeholder="Например, новые позиции в барной карте"
              />
            )}
          </Field>
        </div>
      </ProfileSection>
      {versions.length > 0 && (
        <ProfileSection title="История версий">
          <ul className="divide-y text-sm">
            {versions.map((r) => (
              <li key={r.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <p className="font-medium">С {formatDayMonth(r.valid_from)}</p>
                {r.reason && (
                  <p className="break-words text-muted-foreground">
                    {r.reason}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDayMonthTime(r.created_at, new Date(), data.timezone)}
                  {" · "}
                  {countRu(r.lines.length, "позиция", "позиции", "позиций")}
                </p>
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}
      {bar}
    </div>
  );
}
