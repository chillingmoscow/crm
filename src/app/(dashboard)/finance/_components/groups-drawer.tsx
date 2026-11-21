"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TableRowMenu } from "@/components/shared/table";
import { countRu } from "@/lib/format/plural";

export type GroupItem = {
  id: string;
  name: string;
  /** Сколько записей в группе (статей или контрагентов, включая архив). */
  count: number;
  /** Значение поля «Для каких», если оно есть у справочника. */
  kind?: string;
  /** Почему группу нельзя удалить; тип такой группы тоже не меняется. */
  locked?: string;
};

type Result = { error: string | null };

/**
 * Панель «Группы» справочника (статьи, контрагенты): список групп с правкой
 * на месте, удалением через подтверждение и формой новой группы. Записи
 * удалённой группы остаются, только без группы.
 */
export function GroupsDrawer({
  open,
  onOpenChange,
  title,
  description,
  noun,
  groups,
  kindField,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Склонение записей группы: ["статья", "статьи", "статей"]. */
  noun: [string, string, string];
  groups: GroupItem[];
  /** Второе поле группы — например, «Для статей»: доходов, расходов, любых. */
  kindField?: { label: string; options: OptionSelectOption[]; defaultValue: string; describe: (value: string) => string };
  onCreate: (input: { name: string; kind: string }) => Promise<Result>;
  onUpdate: (id: string, input: { name: string; kind: string }) => Promise<Result>;
  onDelete: (id: string) => Promise<Result>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(kindField?.defaultValue ?? "");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<GroupItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reset = () => {
    setName("");
    setKind(kindField?.defaultValue ?? "");
    setCreateError(null);
    setEditingId(null);
    setEditError(null);
  };

  const create = async () => {
    if (!name.trim()) {
      setCreateError("Укажите название группы");
      return;
    }
    setCreating(true);
    setCreateError(null);
    const result = await onCreate({ name, kind }).catch(() => ({
      error: "Не удалось создать группу. Проверьте соединение и повторите",
    }));
    setCreating(false);
    if (result.error) {
      setCreateError(result.error);
      return;
    }
    toast.success(`Группа «${name.trim()}» создана`);
    setName("");
  };

  const startEdit = (group: GroupItem) => {
    setEditingId(group.id);
    setEditName(group.name);
    setEditKind(group.kind ?? kindField?.defaultValue ?? "");
    setEditError(null);
  };

  const save = async () => {
    if (!editingId) return;
    if (!editName.trim()) {
      setEditError("Укажите название группы");
      return;
    }
    setSaving(true);
    setEditError(null);
    const result = await onUpdate(editingId, { name: editName, kind: editKind }).catch(() => ({
      error: "Не удалось сохранить группу. Проверьте соединение и повторите",
    }));
    setSaving(false);
    if (result.error) {
      setEditError(result.error);
      return;
    }
    setEditingId(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await onDelete(deleteTarget.id).catch(() => ({
      error: "Не удалось удалить группу. Проверьте соединение и повторите",
    }));
    setDeleting(false);
    if (result.error) {
      setDeleteError(result.error);
      return;
    }
    toast.success(`Группа «${deleteTarget.name}» удалена`);
    setDeleteTarget(null);
  };

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) reset();
        }}
        title={title}
        description={description}
      >
        <DrawerSection title="Новая группа">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Field id="new-group-name" label="Название" required error={createError}>
              {(control) => (
                <Input
                  {...control}
                  value={name}
                  maxLength={120}
                  onChange={(event) => {
                    setName(event.target.value);
                    setCreateError(null);
                  }}
                />
              )}
            </Field>
            {kindField ? (
              <Field id="new-group-kind" label={kindField.label}>
                {(control) => (
                  <OptionSelect {...control} value={kind} onValueChange={setKind} options={kindField.options} />
                )}
              </Field>
            ) : null}
            <div>
              <Button type="submit" variant="outline" disabled={creating} className="min-w-36">
                {creating ? "Создаём…" : "Добавить группу"}
              </Button>
            </div>
          </form>
        </DrawerSection>

        <DrawerSection title={groups.length > 0 ? `Группы · ${groups.length}` : "Группы"}>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Групп пока нет</p>
          ) : (
            <ul className="flex flex-col">
              {groups.map((group) => (
                <li key={group.id} className="border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
                  {editingId === group.id ? (
                    <form
                      className="flex flex-col gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                      }}
                    >
                      <Field id={`group-${group.id}-name`} label="Название" required error={editError}>
                        {(control) => (
                          <Input
                            {...control}
                            autoFocus
                            value={editName}
                            maxLength={120}
                            onChange={(event) => {
                              setEditName(event.target.value);
                              setEditError(null);
                            }}
                          />
                        )}
                      </Field>
                      {kindField && !group.locked ? (
                        <Field id={`group-${group.id}-kind`} label={kindField.label}>
                          {(control) => (
                            <OptionSelect
                              {...control}
                              value={editKind}
                              onValueChange={setEditKind}
                              options={kindField.options}
                            />
                          )}
                        </Field>
                      ) : null}
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setEditingId(null)} disabled={saving}>
                          Отмена
                        </Button>
                        <Button type="submit" disabled={saving} className="min-w-28">
                          {saving ? "Сохраняем…" : "Сохранить"}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" data-tip={group.name}>
                          {group.name}
                        </p>
                        <p className="truncate text-[13px] text-muted-foreground">
                          {[
                            group.count > 0 ? countRu(group.count, ...noun) : `${noun[2].charAt(0).toLocaleUpperCase("ru")}${noun[2].slice(1)} нет`,
                            kindField && group.kind !== undefined ? kindField.describe(group.kind) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <TableRowMenu
                        label={`Действия с группой «${group.name}»`}
                        actions={[
                          { label: "Изменить", icon: <Pencil />, onSelect: () => startEdit(group) },
                          {
                            label: "Удалить группу",
                            icon: <Trash2 />,
                            destructive: true,
                            separatorBefore: true,
                            onSelect: () => {
                              setDeleteError(null);
                              setDeleteTarget(group);
                            },
                          },
                        ]}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DrawerSection>
      </EditDrawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next && !deleting) setDeleteTarget(null);
        }}
        title={deleteTarget ? `Удалить группу «${deleteTarget.name}»?` : "Удалить группу?"}
        description={
          deleteTarget && deleteTarget.count > 0
            ? `Без группы останутся: ${countRu(deleteTarget.count, ...noun)}. Сами записи и операции по ним не изменятся`
            : "В группе ничего нет"
        }
        restriction={deleteTarget?.locked}
        confirmLabel="Удалить группу"
        pendingLabel="Удаляем…"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
