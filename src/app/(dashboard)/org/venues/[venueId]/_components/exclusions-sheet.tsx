"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderTree, Loader2, Package, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useIsMobile } from "@/hooks/use-mobile";
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
  return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU");
}

/** Первое число месяца выбранной даты (YYYY-MM-01). */
function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

/**
 * Строка «Исключения · N» с кнопкой «Открыть» и окном со списком правил, и
 * граница заведения «Исключения меняют акты начиная с».
 */
export function ExclusionsRow({ venueId }: { venueId: string }) {
  const isMobile = useIsMobile();
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
  const [confirmApply, setConfirmApply] = useState(false);
  const [savingFrom, setSavingFrom] = useState(false);

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
    if (!removing) return;
    if (!removeReason.trim()) {
      toast.error("Укажите основание");
      return;
    }
    setBusy(true);
    try {
      const res = await removeExclusionRule({
        ruleId: removing.id,
        reason: removeReason.trim(),
      });
      if (report(res, "Удалено")) {
        setRemoving(null);
        setRemoveReason("");
        await reload();
      }
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const res = await applyPendingExclusionRules();
      if (report(res, "Применено")) await reload();
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  }

  async function saveFrom(value: string) {
    const from = value ? monthStart(value) : null;
    setSavingFrom(true);
    try {
      const res = await setInventoryExclusionsFrom({ venueId, from });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setData((d) => (d ? { ...d, exclusionsFrom: res.from ?? null } : d));
      toast.success("Сохранено");
    } finally {
      setSavingFrom(false);
    }
  }

  const rules = data?.items.filter((i) => i.kind !== "legacy_name") ?? [];
  const legacy = data?.items.filter((i) => i.kind === "legacy_name") ?? [];
  const canEdit = !!data?.canEdit;

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

      <div className="max-w-sm space-y-2">
        <Label htmlFor="exclusions-from">Исключения меняют акты начиная с</Label>
        <DatePicker
          id="exclusions-from"
          value={data?.exclusionsFrom ?? ""}
          onChange={(v) => void saveFrom(v)}
          disabled={!data || !canEdit || savingFrom}
          placeholder="Со всех незакрытых месяцев"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          Акты более ранних месяцев не меняются, даже если зарплата за них не
          зафиксирована.
        </p>
      </div>

      <Sheet
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setQuery("");
            setMatching(null);
          }
        }}
      >
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className="flex max-h-[90dvh] w-full flex-col gap-4 overflow-hidden p-0 sm:max-h-none sm:max-w-lg"
        >
          <SheetHeader className="px-6 pr-12 pt-6">
            <SheetTitle>Исключения</SheetTitle>
            <SheetDescription>
              Товары и группы, которые не попадают в результаты инвентаризации.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
            {loadError && (
              <p role="alert" className="text-sm text-destructive">
                {loadError}
              </p>
            )}

            {canEdit && data && data.pendingRetro > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-sm">
                  {data.pendingRetro} исключений ещё не применены к прошлым актам
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmApply(true)}
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
                            {(c.path || c.productCount !== null) && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {[
                                  c.path,
                                  c.kind === "group" && c.productCount !== null
                                    ? `${c.productCount} товаров`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
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
                      {(r.path || r.productCount !== null) && (
                        <p className="truncate text-xs text-muted-foreground">
                          {[
                            r.path,
                            r.kind === "group" && r.productCount !== null
                              ? `${r.productCount} товаров`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          SOURCE_LABEL[r.source],
                          r.createdByName,
                          formatDate(r.createdAt),
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
                        disabled={busy}
                        onClick={() => {
                          setRemoveReason("");
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
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Не найдено в Quick Resto — выберите вручную
                </h3>
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
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!removing}
        onOpenChange={(v) => {
          if (!v && !busy) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить исключение</DialogTitle>
            <DialogDescription>{removing?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="exclusion-remove-reason">Основание</Label>
            <Textarea
              id="exclusion-remove-reason"
              rows={3}
              maxLength={1000}
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              className="text-base md:text-sm"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !removeReason.trim()}
              onClick={() => void remove()}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmApply} onOpenChange={setConfirmApply}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Применить исключения</AlertDialogTitle>
            <AlertDialogDescription>
              Акты незакрытых месяцев будут пересчитаны
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void apply();
              }}
            >
              Применить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
