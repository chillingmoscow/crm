"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { CategoryPicker } from "@/components/finance/category-picker";
import type { ComboboxOption } from "@/components/finance/combobox";
import { CounterpartyPicker } from "@/components/finance/counterparty-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import type { RuleDirectories } from "@/lib/finance/posting-rules/context";
import {
  createPostingRule,
  deletePostingRule,
  updatePostingRule,
} from "@/lib/finance/posting-rules/server";
import type {
  PostingRule,
  PostingRuleActionField,
  PostingRuleActions,
  PostingRuleCondition,
} from "@/lib/finance/posting-rules/types";

import { ConditionRow, emptyCondition, nextFreeField, type ConditionOptions } from "./condition-row";

const ACTION_LABELS: Record<PostingRuleActionField, string> = {
  category_id: "Статья",
  counterparty_id: "Контрагент",
  venue_id: "Заведение",
};
const ACTION_ORDER: PostingRuleActionField[] = ["category_id", "counterparty_id", "venue_id"];

type Draft = {
  name: string;
  conditions: PostingRuleCondition[];
  actions: PostingRuleActions;
  /** Действия, добавленные в форму, — в том числе пока без значения. */
  shownActions: PostingRuleActionField[];
};

function draftOf(rule: PostingRule | null): Draft {
  if (!rule) {
    return { name: "", conditions: [emptyCondition("counterparty")], actions: {}, shownActions: [] };
  }
  return {
    name: rule.name ?? "",
    conditions: rule.conditions,
    actions: { ...rule.actions },
    shownActions: ACTION_ORDER.filter((field) => rule.actions[field]),
  };
}

const archived = (item: { archived_at?: string | null; deleted_at?: string | null }) =>
  Boolean(item.archived_at || item.deleted_at);

/** Действующие записи плюс уже выбранные в правиле архивные — с пометкой. */
function optionsOf<T extends { id: string; name: string; archived_at?: string | null; deleted_at?: string | null }>(
  items: T[],
  selected: Set<string>,
  hint?: (item: T) => string | undefined,
): ComboboxOption[] {
  return items
    .filter((item) => !archived(item) || selected.has(item.id))
    .map((item) => ({
      value: item.id,
      label: archived(item) ? `${item.name} (в архиве)` : item.name,
      hint: hint?.(item),
      keywords: hint?.(item) ? [hint(item) as string] : undefined,
    }));
}

export function RuleSheet({
  open,
  onOpenChange,
  rule,
  directories,
  allowedVenueIds,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: PostingRule | null;
  directories: RuleDirectories;
  allowedVenueIds: string[] | null;
  canManage: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setDraft(draftOf(rule));
      setError(null);
    }
  }, [open, rule]);

  const readOnly = !canManage;
  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of draft.conditions) if ("ids" in c) c.ids.forEach((id) => ids.add(id));
    for (const value of Object.values(draft.actions)) if (value) ids.add(value);
    return ids;
  }, [draft]);

  const conditionOptions: ConditionOptions = useMemo(
    () => ({
      counterparties: optionsOf(directories.counterparties, selectedIds, (c) => (c.inn ? `ИНН ${c.inn}` : undefined)),
      counterpartyGroups: directories.counterpartyGroups.map((g) => ({ value: g.id, label: g.name })),
      bankAccounts: optionsOf(directories.bankAccounts, selectedIds),
    }),
    [directories, selectedIds],
  );

  const typeCondition = draft.conditions.find((c) => c.field === "type");
  const ruleType = typeCondition?.field === "type" ? typeCondition.value : undefined;
  const categories = directories.categories
    .filter((c) => (!archived(c) || selectedIds.has(c.id)) && c.type !== "mixed")
    .map((c) => ({
      id: c.id,
      name: archived(c) ? `${c.name} (в архиве)` : c.name,
      type: c.type as "income" | "expense",
    }));
  const counterparties = directories.counterparties
    .filter((c) => !archived(c) || selectedIds.has(c.id))
    .map((c) => ({ id: c.id, name: archived(c) ? `${c.name} (в архиве)` : c.name, inn: c.inn }));
  const allowed = allowedVenueIds === null ? null : new Set(allowedVenueIds);
  const venues = directories.venues
    .filter((v) => (!archived(v) || selectedIds.has(v.id)) && (allowed === null || allowed.has(v.id)))
    .map((v) => ({ value: v.id, label: archived(v) ? `${v.name} (в архиве)` : v.name }));

  const usedFields = new Set(draft.conditions.map((c) => c.field));
  const freeActions = ACTION_ORDER.filter((field) => !draft.shownActions.includes(field));

  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));
  const setCondition = (index: number, next: PostingRuleCondition) =>
    patch({ conditions: draft.conditions.map((c, i) => (i === index ? next : c)) });
  const setAction = (field: PostingRuleActionField, value: string | null) =>
    patch({ actions: { ...draft.actions, [field]: value } });
  const removeAction = (field: PostingRuleActionField) => {
    const actions = { ...draft.actions };
    delete actions[field];
    patch({ actions, shownActions: draft.shownActions.filter((f) => f !== field) });
  };

  const save = () => {
    setError(null);
    const payload = {
      name: draft.name,
      enabled: rule?.enabled ?? true,
      conditions: draft.conditions,
      actions: draft.actions,
    };
    startTransition(async () => {
      const result = rule ? await updatePostingRule(rule.id, payload) : await createPostingRule(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success(rule ? "Правило сохранено" : "Правило добавлено");
      onOpenChange(false);
    });
  };

  const remove = () => {
    if (!rule) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deletePostingRule(rule.id);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      setConfirmDelete(false);
      toast.success("Правило удалено");
      onOpenChange(false);
    });
  };

  const title = rule ? (readOnly ? "Правило" : "Правило разнесения") : "Новое правило";

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          if (!pending) onOpenChange(next);
        }}
        title={title}
        description="Заполняет пустые поля операции, когда все условия выполнены"
        footer={
          readOnly ? null : (
            <>
              {rule ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmDelete(true);
                  }}
                  disabled={pending}
                  aria-label="Удалить правило"
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Отмена
              </Button>
              <Button type="button" onClick={save} disabled={pending}>
                {rule ? "Сохранить" : "Создать правило"}
              </Button>
            </>
          )
        }
      >
        <DrawerSection title="Если">
          <ol className="space-y-5">
            {draft.conditions.map((condition, index) => (
              <ConditionRow
                key={index}
                condition={condition}
                index={index}
                usedFields={usedFields}
                options={conditionOptions}
                disabled={readOnly || pending}
                canRemove={draft.conditions.length > 1}
                onChange={(next) => setCondition(index, next)}
                onRemove={() => patch({ conditions: draft.conditions.filter((_, i) => i !== index) })}
              />
            ))}
          </ol>
          {!readOnly && draft.conditions.length < 20 ? (
            <Button
              type="button"
              variant="ghost"
              className="-ml-2 text-brand hover:text-brand"
              onClick={() =>
                patch({ conditions: [...draft.conditions, emptyCondition(nextFreeField(draft.conditions))] })
              }
              disabled={pending}
            >
              <Plus className="size-4" />
              Добавить условие
            </Button>
          ) : null}
        </DrawerSection>

        <DrawerSection title="Тогда заполнить">
          {draft.shownActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Выберите, какие поля заполнит правило</p>
          ) : (
            <div className="space-y-4">
              {draft.shownActions.map((field) => (
                <div key={field} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label={ACTION_LABELS[field]}>
                      {(control) =>
                        field === "category_id" ? (
                          <CategoryPicker
                            categories={categories}
                            value={draft.actions.category_id ?? null}
                            onChange={(value) => setAction("category_id", value)}
                            type={ruleType}
                            disabled={readOnly || pending}
                            ariaLabel="Статья"
                          />
                        ) : field === "counterparty_id" ? (
                          <CounterpartyPicker
                            counterparties={counterparties}
                            value={draft.actions.counterparty_id ?? null}
                            onChange={(value) => setAction("counterparty_id", value)}
                            disabled={readOnly || pending}
                          />
                        ) : (
                          <OptionSelect
                            {...control}
                            value={draft.actions.venue_id ?? ""}
                            onValueChange={(value) => setAction("venue_id", value || null)}
                            options={venues}
                            placeholder="Выберите заведение"
                            disabled={readOnly || pending}
                          />
                        )
                      }
                    </Field>
                  </div>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground"
                      onClick={() => removeAction(field)}
                      disabled={pending}
                      aria-label={`Убрать действие «${ACTION_LABELS[field]}»`}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {!readOnly && freeActions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" className="-ml-2 text-brand hover:text-brand" disabled={pending}>
                  <Plus className="size-4" />
                  Добавить действие
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {freeActions.map((field) => (
                  <DropdownMenuItem
                    key={field}
                    onSelect={() => patch({ shownActions: [...draft.shownActions, field] })}
                  >
                    {ACTION_LABELS[field]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </DrawerSection>

        <DrawerSection>
          <Field label="Название" hint="Необязательно: нужно, когда правило длинное">
            {(control) => (
              <Input
                {...control}
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                maxLength={200}
                placeholder="Например, «Поставщики СБЕР»"
                disabled={readOnly || pending}
              />
            )}
          </Field>
        </DrawerSection>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </EditDrawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!pending) setConfirmDelete(next);
        }}
        title="Удалить правило?"
        description="Операции, которые правило уже заполнило, не изменятся."
        confirmLabel="Удалить правило"
        destructive
        busy={pending}
        error={deleteError}
        onConfirm={remove}
      />
    </>
  );
}
