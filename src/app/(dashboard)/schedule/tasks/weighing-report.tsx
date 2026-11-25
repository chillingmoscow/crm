"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Camera, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { fileLabelFocusClass } from "@/components/ui/field-styles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { unwrapAction } from "@/lib/actions/result";
import { dayLabel } from "@/lib/schedule/utils";
import {
  taskStatus,
  type CalendarTaskData,
  type StockCommitInfo,
  type TaskOccurrence,
} from "@/lib/schedule/tasks";
import {
  batchNetGrams,
  countConfigSchema,
  netKgBySection,
  parseGramsInput,
  submitErrors,
  weighingDraftSchema,
  weighingWarnings,
  type CountConfig,
  type WeighingBatch,
  type WeighingDraft,
} from "@/lib/stock-count/tobacco-weighing";
import { WeighingRetryButton } from "@/app/(dashboard)/documents/inventory/[id]/_components/weighing-retry-button";
import { TaskScreen } from "./tasks-client";
import {
  saveWeighingDraft,
  submitWeighing,
  uploadWeighingPhoto,
  weighingPhotoUrls,
} from "./weighing-actions";

type Section = WeighingDraft["sections"][string];

const grams = new Intl.NumberFormat("ru-RU");
const kg = (value: number) => value.toFixed(3).replace(".", ",") + " кг";

function readDraft(o: TaskOccurrence, config: CountConfig | null): WeighingDraft {
  const stored = weighingDraftSchema.safeParse(
    (o.answers as Record<string, unknown> | null)?.weighing,
  );
  const base = stored.success ? stored.data : { startedAt: null, sections: {} };
  const sections: WeighingDraft["sections"] = {};
  for (const s of config?.sections ?? [])
    sections[s.key] = base.sections[s.key] ?? { empty: false, batches: [] };
  return { startedAt: base.startedAt, sections };
}

function initialTexts(draft: WeighingDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of Object.values(draft.sections))
    for (const b of s.batches) out[b.id] = b.grams > 0 ? String(b.grams) : "";
  return out;
}

function commitLine(commit: StockCommitInfo | undefined): string | null {
  if (!commit) return null;
  if (commit.status === "done")
    return commit.documentNumber ? `Акт № ${commit.documentNumber} проведён` : "Акт проведён";
  if (commit.status === "failed")
    return `Ошибка проведения: ${commit.lastError || "причина не указана"}`;
  return "Акт проводится…";
}

export function WeighingReport({
  occurrence: o,
  data,
  onClose,
  onSaved,
}: {
  occurrence: TaskOccurrence;
  data: Pick<CalendarTaskData, "userId" | "stockCommits" | "permissions">;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const parsedConfig = useMemo(
    () => countConfigSchema.safeParse(o.snapshot.count_config),
    [o.snapshot.count_config],
  );
  const config = parsedConfig.success ? parsedConfig.data : null;
  const [draft, setDraft] = useState(() => readDraft(o, config));
  const [texts, setTexts] = useState(() => initialTexts(draft));
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const editable =
    !o.planned &&
    o.user_id === data.userId &&
    ["assigned", "in_progress", "returned"].includes(o.status);
  const commit = data.stockCommits?.[o.id];
  const canRetry =
    data.permissions.includes("schedule.review") || data.permissions.includes("inventory.finalize_results");

  // Сервер обновил задание (сохранение, сдача) — берём его состояние.
  useEffect(() => {
    const next = readDraft(o, config);
    setDraft(next);
    setTexts(initialTexts(next));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.version]);

  // Адреса сохранённых фото.
  const photoPaths = useMemo(
    () =>
      Object.values(draft.sections)
        .flatMap((s) => s.batches.map((b) => b.photo))
        .filter((p): p is string => !!p && !urls[p]),
    [draft, urls],
  );
  useEffect(() => {
    if (!photoPaths.length) return;
    let alive = true;
    weighingPhotoUrls(o.id, photoPaths)
      .then(unwrapAction)
      .then((found) => alive && setUrls((u) => ({ ...u, ...found })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [photoPaths, o.id]);

  // Пока акт проводится, подтягиваем статус.
  const processing = o.status === "completed" && (!commit || commit.status === "pending" || commit.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void onSaved().catch(() => {}), 10_000);
    return () => clearInterval(timer);
  }, [processing, onSaved]);

  if (!config) {
    return (
      <TaskScreen onBack={onClose} backLabel="К расписанию" backHref="/schedule" title={o.snapshot.name}>
        <p className="text-sm text-destructive">
          Настройка взвешивания повреждена. Обратитесь к управляющему.
        </p>
      </TaskScreen>
    );
  }

  /** Черновик с граммами из полей ввода: недопустимый текст считается нулём. */
  const view: WeighingDraft = {
    ...draft,
    sections: Object.fromEntries(
      Object.entries(draft.sections).map(([key, s]) => [
        key,
        {
          ...s,
          batches: s.batches.map((b) => {
            const p = parseGramsInput(texts[b.id] ?? "");
            return { ...b, grams: "grams" in p ? p.grams : 0 };
          }),
        },
      ]),
    ),
  };
  const nets = netKgBySection(view, config);

  function inputProblem(): string | null {
    for (const section of config!.sections) {
      const s = draft.sections[section.key];
      if (!s || s.empty) continue;
      for (const [i, b] of s.batches.entries()) {
        const raw = texts[b.id] ?? "";
        if (raw.trim() === "") continue; // пустой вес сохраняется как 0, сдать с ним нельзя
        const p = parseGramsInput(raw);
        if ("error" in p) return `${section.title}, партия ${i + 1}: ${p.error}`;
      }
    }
    return null;
  }

  function patchSection(key: string, fn: (s: Section) => Section) {
    setDraft((d) => ({
      ...d,
      sections: { ...d.sections, [key]: fn(d.sections[key] ?? { empty: false, batches: [] }) },
    }));
    setDirty(true);
  }
  function patchBatch(key: string, id: string, fn: (b: WeighingBatch) => WeighingBatch) {
    patchSection(key, (s) => ({ ...s, batches: s.batches.map((b) => (b.id === id ? fn(b) : b)) }));
  }
  function addBatch(key: string) {
    const first = config!.sections.find((s) => s.key === key)?.tares[0];
    const batch: WeighingBatch = {
      id: crypto.randomUUID(),
      grams: 0,
      tares: first ? [{ tareKey: first.key, count: 0 }] : [],
      photo: null,
    };
    patchSection(key, (s) => ({ ...s, batches: [...s.batches, batch] }));
  }

  /** Черновик для сервера: граммы из полей. */
  function payload(source: WeighingDraft = draft): WeighingDraft {
    return {
      ...source,
      sections: Object.fromEntries(
        Object.entries(source.sections).map(([key, s]) => [
          key,
          {
            ...s,
            batches: s.batches.map((b) => {
              const p = parseGramsInput(texts[b.id] ?? "");
              return { ...b, grams: "grams" in p ? p.grams : 0 };
            }),
          },
        ]),
      ),
    };
  }

  async function save(
    source: WeighingDraft = draft,
    silent = false,
  ): Promise<{ version: number; startedAt: string | null } | null> {
    const problem = inputProblem();
    if (problem) {
      if (!silent) toast.error(problem);
      return null;
    }
    const saved = unwrapAction(
      await saveWeighingDraft({ occurrenceId: o.id, version: o.version, draft: payload(source) }),
    );
    return saved;
  }

  async function onSave() {
    setBusy(true);
    try {
      const saved = await save();
      if (!saved) return;
      setDirty(false);
      toast.success("Взвешивание сохранено");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить взвешивание");
    } finally {
      setBusy(false);
    }
  }

  function askFinish() {
    const problem = inputProblem();
    if (problem) return toast.error(problem);
    // Время начала ставит сохранение, которое идёт перед сдачей.
    const errors = submitErrors({ ...payload(), startedAt: draft.startedAt ?? "pending" }, config!);
    if (errors.length) return toast.error(errors[0]);
    setConfirmError(null);
    setConfirm(true);
  }

  async function finish() {
    setBusy(true);
    setConfirmError(null);
    try {
      const saved = await save();
      if (!saved) {
        setConfirm(false);
        return;
      }
      unwrapAction(
        await submitWeighing({
          occurrenceId: o.id,
          version: saved.version,
          draft: { ...payload(), startedAt: saved.startedAt },
        }),
      );
      setDirty(false);
      setConfirm(false);
      toast.success("Взвешивание завершено");
      await onSaved();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Не удалось завершить взвешивание");
      // Сохранение уже прошло и подняло версию — берём свежую, чтобы повтор не упал на «задание изменилось».
      await onSaved().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function removeBatch(key: string, batchId: string) {
    const s = draft.sections[key];
    if (!s) return;
    const next: WeighingDraft = {
      ...draft,
      sections: { ...draft.sections, [key]: { ...s, batches: s.batches.filter((b) => b.id !== batchId) } },
    };
    setDraft(next);
    setDirty(true);
    setBusy(true);
    try {
      if (await save(next, true)) {
        setDirty(false);
        await onSaved();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить взвешивание");
    } finally {
      setBusy(false);
    }
  }

  async function upload(key: string, batchId: string, file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("occurrenceId", o.id);
      form.set("file", file);
      const r = unwrapAction(await uploadWeighingPhoto(form));
      setUrls((u) => ({ ...u, [r.path]: r.url }));
      patchBatch(key, batchId, (b) => ({ ...b, photo: r.path }));
      // Фото уже в хранилище — сразу фиксируем его в черновике, чтобы оно не осиротело.
      const s = draft.sections[key];
      if (s) {
        const next: WeighingDraft = {
          ...draft,
          sections: {
            ...draft.sections,
            [key]: { ...s, batches: s.batches.map((b) => (b.id === batchId ? { ...b, photo: r.path } : b)) },
          },
        };
        if (await save(next, true)) {
          setDirty(false);
          await onSaved();
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить фото");
    } finally {
      setBusy(false);
    }
  }

  const warnings = weighingWarnings(view, config);
  const summary = config.sections.map((s) => `${s.title} ${kg(nets[s.key] ?? 0)}`).join(" · ");
  const line = commitLine(commit);

  return (
    <TaskScreen
      onBack={onClose}
      backLabel="К расписанию"
      backHref="/schedule"
      dirty={dirty}
      busy={busy}
      title={o.snapshot.name}
      description={`${dayLabel(o.business_date)} · ${o.planned ? "План" : taskStatus[o.status]} · ${o.employee_name || "Без сотрудника"}`}
      actions={
        editable ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void onSave()}>
              Сохранить
            </Button>
            <Button disabled={busy} onClick={askFinish}>
              Завершить взвешивание
            </Button>
          </div>
        ) : undefined
      }
    >
      {editable && (
        <p role="status" className="text-sm text-muted-foreground">
          {busy ? "Сохраняем…" : dirty ? "Есть несохранённые изменения" : "Сохранено"}
        </p>
      )}
      {line && (
        <div className="space-y-2">
          <p
            role="status"
            className={
              commit?.status === "failed"
                ? "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                : "rounded-md border bg-muted/50 px-3 py-2 text-sm"
            }
          >
            {line}
          </p>
          {commit?.status === "failed" && canRetry && <WeighingRetryButton commitId={commit.id} onDone={() => onSaved().catch(() => {})} />}
        </div>
      )}
      {config.sections.map((section) => {
        const s = draft.sections[section.key] ?? { empty: false, batches: [] };
        const sectionView = view.sections[section.key] ?? s;
        return (
          <section key={section.key} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <h2 className="min-w-0 text-base font-semibold">{section.title}</h2>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                нетто {kg(nets[section.key] ?? 0)}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{section.hint}</p>
            {editable && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={s.empty}
                  onCheckedChange={(v) => patchSection(section.key, (x) => ({ ...x, empty: v === true }))}
                />
                В разделе ничего нет
              </label>
            )}
            {s.empty ? (
              !editable && <p className="text-sm text-muted-foreground">В разделе ничего нет</p>
            ) : (
              <>
                {s.batches.map((b, i) => {
                  const net = batchNetGrams(sectionView.batches[i] ?? b, section.tares);
                  const text = texts[b.id] ?? "";
                  const parsed = text === "" ? null : parseGramsInput(text);
                  const gramsError = parsed && "error" in parsed ? parsed.error : null;
                  const url = b.photo ? urls[b.photo] : undefined;
                  return (
                    <div key={b.id} className="min-w-0 space-y-3 rounded-lg border p-3">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="text-sm font-medium">Партия {i + 1}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`text-sm tabular-nums ${net < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            нетто {grams.format(net)} г
                          </span>
                          {editable && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Удалить партию ${i + 1}`}
                              disabled={busy}
                              onClick={() => void removeBatch(section.key, b.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm text-muted-foreground" htmlFor={`g-${b.id}`}>
                          Вес на весах, г
                        </label>
                        <Input
                          id={`g-${b.id}`}
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="например, 7458"
                          value={text}
                          readOnly={!editable}
                          aria-invalid={!!gramsError}
                          onChange={(e) => {
                            setTexts((t) => ({ ...t, [b.id]: e.target.value }));
                            setDirty(true);
                          }}
                        />
                        {gramsError && <p className="text-sm text-destructive">{gramsError}</p>}
                      </div>
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">Тара</span>
                        {b.tares.map((t, ti) => (
                          <div key={ti} className="flex min-w-0 items-center gap-2">
                            <Select
                              value={t.tareKey}
                              disabled={!editable}
                              onValueChange={(v) =>
                                patchBatch(section.key, b.id, (x) => ({
                                  ...x,
                                  tares: x.tares.map((y, yi) => (yi === ti ? { ...y, tareKey: v } : y)),
                                }))
                              }
                            >
                              <SelectTrigger aria-label="Тип тары" className="min-w-0 flex-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {section.tares.map((tare) => (
                                  <SelectItem key={tare.key} value={tare.key}>
                                    {tare.title} ({tare.grams} г)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              inputMode="numeric"
                              aria-label="Количество"
                              placeholder="шт."
                              className="w-20 shrink-0"
                              value={t.count ? String(t.count) : ""}
                              readOnly={!editable}
                              onChange={(e) => {
                                const count = Number(e.target.value.replace(/\D/g, "").slice(0, 4) || 0);
                                patchBatch(section.key, b.id, (x) => ({
                                  ...x,
                                  tares: x.tares.map((y, yi) => (yi === ti ? { ...y, count } : y)),
                                }));
                              }}
                            />
                            {editable && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Убрать тару"
                                onClick={() =>
                                  patchBatch(section.key, b.id, (x) => ({
                                    ...x,
                                    tares: x.tares.filter((_, yi) => yi !== ti),
                                  }))
                                }
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                        {editable && b.tares.length < section.tares.length && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const used = new Set(b.tares.map((t) => t.tareKey));
                              const next = section.tares.find((t) => !used.has(t.key));
                              if (!next) return;
                              patchBatch(section.key, b.id, (x) => ({
                                ...x,
                                tares: [...x.tares, { tareKey: next.key, count: 0 }],
                              }));
                            }}
                          >
                            <Plus className="mr-1 h-4 w-4" />
                            Ещё тара
                          </Button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {url && (
                          <Image
                            src={url}
                            alt={`Фото: ${section.title}, партия ${i + 1}`}
                            width={420}
                            height={280}
                            className="max-h-72 w-full rounded-md object-contain"
                            unoptimized
                          />
                        )}
                        {editable && (
                          <label
                            className={`touch-target inline-flex cursor-pointer items-center gap-2 text-sm text-primary ${fileLabelFocusClass}`}
                          >
                            <Camera className="h-4 w-4" />
                            {b.photo ? "Заменить фото" : "Добавить фото"}
                            <input
                              aria-label={`Фото: ${section.title}, партия ${i + 1}`}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="sr-only"
                              disabled={busy}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                void upload(section.key, b.id, file);
                              }}
                            />
                          </label>
                        )}
                        {!editable && !b.photo && <p className="text-sm text-muted-foreground">Без фото</p>}
                      </div>
                    </div>
                  );
                })}
                {editable && (
                  <Button variant="outline" disabled={busy} onClick={() => addBatch(section.key)}>
                    <Plus className="mr-1 h-4 w-4" />
                    Партия
                  </Button>
                )}
              </>
            )}
          </section>
        );
      })}
      {editable && warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={(open) => !busy && setConfirm(open)}
        title="Завершить взвешивание?"
        description={
          <>
            Итог: {summary}. После завершения акт будет проведён и попадёт в удержания кальянного
            подразделения.
            {warnings.length > 0 && (
              <span className="mt-2 block text-amber-700 dark:text-amber-400">
                Проверьте: {warnings.join("; ")}.
              </span>
            )}
          </>
        }
        confirmLabel="Завершить взвешивание"
        pendingLabel="Завершаем…"
        busy={busy}
        error={confirmError}
        onConfirm={() => void finish()}
      />
    </TaskScreen>
  );
}
