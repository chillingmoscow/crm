"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderTree, Loader2, Package, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MonthPicker } from "@/components/shared/month-picker";
import { useSaveSection } from "@/components/shared/save-bar";
import { formatDayMonth } from "@/lib/format/date";
import { countRu, pluralRu } from "@/lib/format/plural";
import {
  addExclusionRule,
  applyPendingExclusionRules,
  listExclusionRules,
  removeExclusionRule,
  searchExclusionCandidates,
  setInventoryExclusionsFrom,
  type ExclusionCandidate,
  type ExclusionListItem,
} from "@/app/(dashboard)/inventory/_actions/exclusion-list";

const SOURCE_LABEL: Record<ExclusionListItem["source"], string> = {
  act: "из акта",
  manual: "вручную",
  glide: "из Glide",
};

type Loaded = {
  items: ExclusionListItem[];
  canEdit: boolean;
  pendingRetro: number;
  exclusionsFrom: string | null;
};

function KindIcon({ kind }: { kind: "product" | "group" | "legacy_name" }) {
  const Icon = kind === "group" ? FolderTree : Package;
  return (
    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}

/** Путь группы и число товаров в ней: «Бар / Сиропы · 12 товаров». */
function itemMeta(i: {
  kind: string;
  path: string | null;
  productCount: number | null;
}) {
  return [
    i.path,
    i.kind === "group" && i.productCount !== null
      ? countRu(i.productCount, "товар", "товара", "товаров")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Первое число месяца выбранной даты (YYYY-MM-01). */
function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

/**
 * Строка «Исключения · N» с кнопкой «Открыть» и панелью со списком правил, и
 * граница заведения «Исключения меняют акты начиная с».
 *
 * Список открывается всем, кто видит результаты инвентаризации; добавлять,
 * удалять и применять исключения можно только с правом на правку итогов
 * (`canEdit` из загрузчика). Граница сохраняется общей полосой `SaveBar`
 * карточки заведения.
 */
export function ExclusionsRow({
  venueId,
  today,
}: {
  venueId: string;
  /** Сегодня в поясе заведения (`YYYY-MM-DD`): месяц по умолчанию для границы. */
  today?: string;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ExclusionCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [matching, setMatching] = useState<ExclusionListItem | null>(null);
  const searchSeq = useRef(0);

  const [removing, setRemoving] = useState<ExclusionListItem | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listExclusionRules({ venueId });
    if ("error" in res) {
      setLoadError(res.error);
      return;
    }
    setLoadError("");
    setData(res);
  }, [venueId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Поиск с задержкой 250 мс; устаревшие ответы отбрасываем.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      searchSeq.current += 1;
      setCandidates([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(() => {
      void searchExclusionCandidates(q)
        .then((r) => {
          if (seq === searchSeq.current) setCandidates(r);
        })
        .catch(() => {
          if (seq === searchSeq.current) setCandidates([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  function report(res: { error: string | null; notice?: string | null }, ok: string) {
    if (res.error) {
      toast.error(res.error);
      return false;
    }
    toast.success(ok);
    if (res.notice) toast.message(res.notice);
    return true;
  }

  async function add(c: ExclusionCandidate) {
    setBusy(true);
    try {
      const res = await addExclusionRule({
        kind: c.kind,
        id: c.id,
        replacesLegacyId: matching?.id,
      });
      if (report(res, "Добавлено")) {
        setQuery("");
        setCandidates([]);
        setMatching(null);
        await reload();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing || !removeReason.trim()) return;
    setBusy(true);
    setRemoveError(null);
    try {
      const res = await removeExclusionRule({
        ruleId: removing.id,
        reason: removeReason.trim(),
      });
      if (res.error) {
        setRemoveError(res.error);
        return;
      }
      toast.success("Удалено");
      if (res.notice) toast.message(res.notice);
      setRemoving(null);
      setRemoveReason("");
      await reload();
    } catch (e) {
      setRemoveError(
        e instanceof Error ? e.message : "Не удалось удалить исключение",
      );
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setApplyError(null);
    try {
      const res = await applyPendingExclusionRules();
      if (res.error) {
        setApplyError(res.error);
        return;
      }
      toast.success("Применено");
      if (res.notice) toast.message(res.notice);
      setConfirmApply(false);
      await reload();
    } catch (e) {
      setApplyError(
        e instanceof Error ? e.message : "Не удалось применить исключения",
      );
    } finally {
      setBusy(false);
    }
  }

  // ── Граница «Исключения меняют акты начиная с» — через общую полосу ──
  const canEdit = !!data?.canEdit;
  const savedFrom = data?.exclusionsFrom ?? null;
  const [fromDraft, setFromDraft] = useState<string | null>(savedFrom);
  const [savingFrom, setSavingFrom] = useState(false);
  useEffect(() => {
    setFromDraft(savedFrom);
  }, [savedFrom]);
  const defaultMonth = monthStart(
    today ?? new Date().toLocaleDateString("sv-SE"),
  );
  async function saveFrom() {
    setSavingFrom(true);
    try {
      const res = await setInventoryExclusionsFrom({ venueId, from: fromDraft });
      if (res.error) {
        toast.error(res.error);
        return false;
      }
      setData((d) => (d ? { ...d, exclusionsFrom: res.from ?? null } : d));
      toast.success("Граница исключений сохранена");
      return true;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось сохранить границу исключений",
      );
      return false;
    } finally {
      setSavingFrom(false);
    }
  }
  const saveBar = useSaveSection({
    dirty: canEdit && !!data && fromDraft !== savedFrom,
    saving: savingFrom,
    save: saveFrom,
    reset: () => setFromDraft(savedFrom),
  });

  const rules = data?.items.filter((i) => i.kind !== "legacy_name") ?? [];
  const legacy = data?.items.filter((i) => i.kind === "legacy_name") ?? [];
  const fromDisabled = !data || !canEdit || savingFrom;

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <span className="min-w-0 text-sm font-medium">
          Исключения{data ? ` · ${rules.length}` : ""}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!data && !loadError}
          onClick={() => setOpen(true)}
        >
          Открыть
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="exclusions-from-mode" label="Исключения меняют акты">
            {(control) => (
              <OptionSelect
                {...control}
                value={fromDraft ? "from" : "all"}
                disabled={fromDisabled}
                onValueChange={(v) =>
                  setFromDraft(v === "from" ? (savedFrom ?? defaultMonth) : null)
                }
                options={[
                  { value: "all", label: "Всех незакрытых месяцев" },
                  { value: "from", label: "Начиная с месяца" },
                ]}
              />
            )}
          </Field>
          {fromDraft && (
            <Field id="exclusions-from" label="Начиная с" required>
              {(control) => (
                <MonthPicker
                  {...control}
                  variant="field"
                  prefix=""
                  min="2020-01-01"
                  value={fromDraft}
                  disabled={fromDisabled}
                  onChange={(month) => setFromDraft(monthStart(month))}
                />
              )}
            </Field>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Акты более ранних месяцев не меняются, даже если зарплата за них не
          зафиксирована.
        </p>
      </div>
      {saveBar}

      <EditDrawer
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setQuery("");
            setMatching(null);
          }
        }}
        title="Исключения"
        description="Товары и группы, которые не попадают в результаты инвентаризации"
      >
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}

        {canEdit && data && data.pendingRetro > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0">
              {countRu(data.pendingRetro, "изменение", "изменения", "изменений")}{" "}
              исключений ещё{" "}
              {pluralRu(data.pendingRetro, "не применено", "не применены", "не применены")}{" "}
              к прошлым актам
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setApplyError(null);
                setConfirmApply(true);
              }}
            >
              Применить
            </Button>
          </div>
        )}

        {canEdit && (
          <div className="space-y-2">
            {matching && (
              <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  Сопоставляем: «{matching.name}»
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setMatching(null)}
                >
                  Отмена
                </Button>
              </div>
            )}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                role="combobox"
                aria-expanded={candidates.length > 0}
                aria-label="Найти товар или группу"
                placeholder="Найти товар или группу"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 pl-9"
                disabled={busy}
              />
              {searching && (
                <Loader2 className="absolute right-3 top-3 size-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {query.trim().length >= 2 && !searching && candidates.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">Ничего не найдено</p>
            )}
            {candidates.length > 0 && (
              <ul
                role="listbox"
                aria-label="Результаты поиска"
                className="max-h-64 divide-y overflow-y-auto overscroll-contain rounded-lg border"
              >
                {candidates.map((c) => (
                  <li key={`${c.kind}:${c.id}`} role="option" aria-selected={false}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void add(c)}
                      className="flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
                    >
                      <KindIcon kind={c.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.name}</span>
                        {itemMeta(c) && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {itemMeta(c)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {data && rules.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Исключений пока нет
          </p>
        )}
        {rules.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {rules.map((r) => (
              <li key={r.id} className="flex min-w-0 items-start gap-2 p-3">
                <KindIcon kind={r.kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  {itemMeta(r) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {itemMeta(r)}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      SOURCE_LABEL[r.source],
                      r.createdByName,
                      formatDayMonth(r.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Удалить исключение ${r.name}`}
                    data-tip="Удалить исключение"
                    disabled={busy}
                    onClick={() => {
                      setRemoveReason("");
                      setRemoveError(null);
                      setRemoving(r);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {legacy.length > 0 && (
          <DrawerSection title="Не найдено в Quick Resto: выберите вручную">
            <ul className="divide-y rounded-lg border">
              {legacy.map((r) => (
                <li
                  key={r.id}
                  className="flex min-w-0 flex-wrap items-center gap-2 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[r.source]}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setMatching(r);
                          setQuery(r.name);
                        }}
                      >
                        Сопоставить
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setRemoveReason("");
                          setRemoveError(null);
                          setRemoving(r);
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </DrawerSection>
        )}
      </EditDrawer>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
        title={`Удалить исключение «${removing?.name ?? ""}»?`}
        description="Позиция снова попадёт в результаты инвентаризации."
        confirmLabel="Удалить исключение"
        pendingLabel="Удаляем…"
        destructive
        busy={busy}
        confirmDisabled={!removeReason.trim()}
        error={removeError}
        onConfirm={() => void remove()}
      >
        <Field id="exclusion-remove-reason" label="Основание" required>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={1000}
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmApply}
        onOpenChange={setConfirmApply}
        title="Применить исключения к прошлым актам?"
        description={
          data
            ? `${countRu(data.pendingRetro, "изменение", "изменения", "изменений")} исключений. Акты незакрытых месяцев будут пересчитаны.`
            : "Акты незакрытых месяцев будут пересчитаны."
        }
        confirmLabel="Применить исключения"
        pendingLabel="Применяем…"
        busy={busy}
        error={applyError}
        onConfirm={() => void apply()}
      />
    </>
  );
}
