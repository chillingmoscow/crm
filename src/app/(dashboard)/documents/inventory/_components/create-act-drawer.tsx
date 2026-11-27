"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import { countRu } from "@/lib/format/plural";
import {
  filterEligibleOptions,
  type InventoryAssignmentEligibility,
} from "@/lib/inventory/act-assignment";
import {
  CREATE_ACT_COMMENT_MAX,
  CREATE_ACT_KINDS,
  CREATE_ACT_KIND_LABELS,
  CREATE_ACT_MAX_ITEMS,
  collectGroupSubtree,
  countSelectedItems,
  defaultActComment,
  groupTreeRows,
  groupsWithSelectedDescendants,
} from "@/lib/inventory/act-create";
import {
  createInventoryAct,
  loadCreateActOptions,
  type CreateActOptions,
} from "@/app/(dashboard)/inventory/_actions/create";
import { AssigneeAvatar, type AssigneeOption } from "./assignee-select";

function todayLocal(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function newAttemptId(): string {
  return crypto.randomUUID();
}

/**
 * Панель «Новый акт инвентаризации»: склад, дата, группы каталога, исполнитель
 * и проверяющий. Акт создаётся в Quick Resto и сразу появляется в списке.
 *
 * Id попытки живёт, пока панель открыта: повторное «Создать акт» после сбоя
 * продолжает тот же акт, а не заводит второй (см. createInventoryAct).
 */
export function CreateActDrawer({
  open,
  onOpenChange,
  staff,
  eligibility,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: AssigneeOption[];
  eligibility: InventoryAssignmentEligibility | null;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<CreateActOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [attemptId, setAttemptId] = useState(newAttemptId);
  const [storeId, setStoreId] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [commentTouched, setCommentTouched] = useState(false);
  const [assignedTo, setAssignedTo] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Данные панели — при каждом открытии: каталог могли синхронизировать.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadCreateActOptions()
      .then((result) => {
        if (cancelled) return;
        if (result.error || !result.options) {
          setLoadError(result.error ?? "Не удалось загрузить данные для нового акта.");
          return;
        }
        setOptions(result.options);
        setStoreId((current) =>
          current || (result.options && result.options.stores.length === 1 ? result.options.stores[0].id : ""),
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить данные для нового акта.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadKey]);

  const reset = () => {
    setAttemptId(newAttemptId());
    setStoreId("");
    setDate(todayLocal());
    setSelected([]);
    setComment("");
    setCommentTouched(false);
    setAssignedTo("");
    setReviewerId("");
    setQuery("");
    setExpanded(new Set());
    setSaveError(null);
  };

  const groups = useMemo(() => options?.groups ?? [], [options]);
  const counts = useMemo(() => new Map(Object.entries(options?.productCountByGroup ?? {})), [options]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  // Группа, выбранная вместе с родителем, уже входит в акт через него.
  const implied = useMemo(() => {
    const out = new Set<string>();
    for (const id of collectGroupSubtree(groups, selected)) if (!selected.includes(id)) out.add(id);
    return out;
  }, [groups, selected]);

  const itemCount = useMemo(
    () => countSelectedItems({ groups, productCountByGroup: counts, selectedGroupIds: selected }),
    [groups, counts, selected],
  );

  const selectedNames = selected
    .map((id) => groupById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
  const effectiveComment = commentTouched ? comment : defaultActComment(selectedNames);

  const store = options?.stores.find((option) => option.id === storeId) ?? null;
  const venueIds = store ? [store.venueId] : [];
  const assigneeOptions = eligibility
    ? filterEligibleOptions({ options: staff, eligibility, role: "assignee", venueIds })
    : staff;
  const reviewerOptions = eligibility
    ? filterEligibleOptions({ options: staff, eligibility, role: "reviewer", venueIds })
    : staff;

  // Свёрнутое дерево: подгруппы (бренды внутри «Табака» и т. п.) видны по
  // раскрытию; поиск сам раскрывает родителей найденной группы.
  const rows = useMemo(() => groupTreeRows({ nodes: groups, expanded, query }), [groups, expanded, query]);
  const partial = useMemo(() => groupsWithSelectedDescendants(groups, selected), [groups, selected]);
  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tooMany = itemCount > CREATE_ACT_MAX_ITEMS;
  const canSubmit =
    Boolean(options) && Boolean(storeId) && Boolean(date) && selected.length > 0 && !tooMany && !pending;
  const dirty = selected.length > 0 || Boolean(assignedTo) || Boolean(reviewerId) || commentTouched;

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (pending) return; // акт создаётся — закрыть нельзя, иначе не увидим результат
    if (dirty) return setConfirmClose(true);
    close();
  };

  const toggle = (id: string, checked: boolean) => {
    setSaveError(null);
    setSelected((current) => {
      if (!checked) return current.filter((value) => value !== id);
      // Родитель включает подгруппы: отдельно отмеченные подгруппы больше не нужны
      // (и не попадут в комментарий акта второй раз).
      const inside = collectGroupSubtree(groups, [id]);
      return [...current.filter((value) => !inside.has(value)), id];
    });
  };

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setSaveError(null);
    try {
      const result = await createInventoryAct({
        attemptId,
        storeId,
        date,
        groupIds: selected,
        comment: effectiveComment,
        assignedTo: assignedTo || null,
        reviewerId: reviewerId || null,
      });
      if (result.error || !result.documentId) {
        setSaveError(result.error ?? "Не удалось создать акт. Попробуйте ещё раз.");
        router.refresh();
        return;
      }
      const documentId = result.documentId;
      toast.success("Акт создан", {
        description: result.warning,
        action: { label: "Открыть", onClick: () => router.push(`/documents/inventory/${documentId}`) },
      });
      close();
      router.refresh();
    } catch {
      setSaveError("Не удалось создать акт. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  };

  const staffOptions = (list: AssigneeOption[], blocked: string) => [
    {
      value: "",
      label: (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <UserPlus className="h-4 w-4" />
          Не назначен
        </span>
      ),
    },
    ...list.map((person) => ({
      value: person.id,
      label: (
        <span className="inline-flex min-w-0 items-center gap-2">
          <AssigneeAvatar name={person.name} src={person.avatarUrl} />
          <span className="truncate">{person.name}</span>
        </span>
      ),
      disabled: person.id === blocked,
    })),
  ];

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={requestClose}
        title="Новый акт инвентаризации"
        description="Акт появится в Quick Resto и сразу в этом списке"
        footer={
          <>
            <Button variant="outline" onClick={() => requestClose(false)} disabled={pending}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создаём акт…
                </>
              ) : (
                "Создать акт"
              )}
            </Button>
          </>
        }
      >
        {loading && !options ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем склады и группы…
          </div>
        ) : loadError && !options ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Повторить
            </Button>
          </div>
        ) : options ? (
          <>
            <DrawerSection title="Акт">
              <Field label="Склад" required>
                {(control) => (
                  <OptionSelect
                    {...control}
                    value={storeId}
                    onValueChange={(value) => {
                      setStoreId(value);
                      setAssignedTo("");
                      setReviewerId("");
                    }}
                    placeholder={options.stores.length === 0 ? "Нет складов" : "Выберите склад"}
                    options={options.stores.map((option) => ({ value: option.id, label: option.title }))}
                    disabled={pending}
                  />
                )}
              </Field>
              <Field label="Дата акта" required>
                {(control) => (
                  <DatePicker {...control} value={date} onChange={setDate} clearable={false} disabled={pending} />
                )}
              </Field>
              <Field label="Комментарий">
                {(control) => (
                  <Input
                    {...control}
                    value={effectiveComment}
                    maxLength={CREATE_ACT_COMMENT_MAX}
                    placeholder="Например, «Еда» или «Пиво»"
                    onChange={(event) => {
                      setCommentTouched(true);
                      setComment(event.target.value);
                    }}
                    disabled={pending}
                  />
                )}
              </Field>
            </DrawerSection>

            <DrawerSection
              title="Что пересчитываем"
              description="Группа берётся целиком, вместе с подгруппами — как кнопка «Добавить группы» в Quick Resto"
            >
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  В каталоге нет групп с позициями. Синхронизируйте номенклатуру и откройте панель снова.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Найти группу"
                      aria-label="Найти группу"
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-80 overflow-y-auto rounded-md border border-border py-1">
                    {CREATE_ACT_KINDS.map((kind) => {
                      const ofKind = rows.filter((row) => row.node.kind === kind);
                      if (ofKind.length === 0) return null;
                      return (
                        <div key={kind} className="py-1">
                          <p className="px-3 py-1 text-xs font-medium text-muted-foreground">
                            {CREATE_ACT_KIND_LABELS[kind]}
                          </p>
                          {ofKind.map(({ node: group, hasChildren, open: isOpen }) => {
                            const isImplied = implied.has(group.id);
                            const isSelected = isImplied || selected.includes(group.id);
                            const checked = isSelected ? true : partial.has(group.id) ? "indeterminate" : false;
                            return (
                              <div
                                key={group.id}
                                className={cn(
                                  "flex items-center gap-1 pr-3 text-sm hover:bg-accent",
                                  isImplied && "text-muted-foreground hover:bg-transparent",
                                )}
                                style={{ paddingLeft: 4 + group.depth * 20 }}
                              >
                                {hasChildren ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(group.id)}
                                    aria-expanded={isOpen}
                                    aria-label={isOpen ? `Свернуть «${group.name}»` : `Показать подгруппы «${group.name}»`}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                                  >
                                    <ChevronRight
                                      className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-90")}
                                    />
                                  </button>
                                ) : (
                                  <span className="h-7 w-7 shrink-0" aria-hidden="true" />
                                )}
                                <label
                                  className={cn(
                                    "flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5",
                                    isImplied && "cursor-default",
                                  )}
                                >
                                  <Checkbox
                                    checked={checked}
                                    disabled={isImplied || pending}
                                    onCheckedChange={(value) => toggle(group.id, value === true)}
                                  />
                                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {group.itemCount}
                                  </span>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {rows.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">Ничего не нашли</p>
                    ) : null}
                  </div>
                  {selected.length > 0 ? (
                    <p className={cn("text-xs", tooMany ? "text-destructive" : "text-muted-foreground")}>
                      {tooMany
                        ? `В акт попадёт ${countRu(itemCount, "позиция", "позиции", "позиций")} — больше ${CREATE_ACT_MAX_ITEMS}. Разделите группы на несколько актов.`
                        : `В акт попадёт ${countRu(itemCount, "позиция", "позиции", "позиций")}`}
                    </p>
                  ) : null}
                </div>
              )}
            </DrawerSection>

            <DrawerSection title="Кто считает">
              <Field label="Исполнитель">
                {(control) => (
                  <OptionSelect
                    {...control}
                    value={assignedTo}
                    onValueChange={setAssignedTo}
                    options={staffOptions(assigneeOptions, reviewerId)}
                    disabled={pending || !storeId}
                    placeholder={storeId ? "Не назначен" : "Сначала выберите склад"}
                  />
                )}
              </Field>
              <Field label="Проверяющий">
                {(control) => (
                  <OptionSelect
                    {...control}
                    value={reviewerId}
                    onValueChange={setReviewerId}
                    options={staffOptions(reviewerOptions, assignedTo)}
                    disabled={pending || !storeId}
                    placeholder={storeId ? "Не назначен" : "Сначала выберите склад"}
                  />
                )}
              </Field>
            </DrawerSection>

            {pending ? (
              <p className="text-xs text-muted-foreground">
                Добавляем позиции в Quick Resto по одной — большой раздел занимает пару минут. Не закрывайте панель.
              </p>
            ) : null}
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
          </>
        ) : null}
      </EditDrawer>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Закрыть новый акт?"
        description="Выбранные группы и назначения не сохранятся."
        confirmLabel="Закрыть без создания"
        onConfirm={() => {
          setConfirmClose(false);
          close();
        }}
      />
    </>
  );
}
