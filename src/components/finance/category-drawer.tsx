"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  FileText,
  Folder,
  Hash,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryItem,
  DrawerSummaryTotal,
} from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { Money } from "@/components/shared/money";
import { TableRowMenu, type TableRowMenuAction } from "@/components/shared/table";
import { CategoryColorDot, CategoryColorPicker } from "@/components/finance/category-color";
import { createFinanceCategory, updateFinanceCategory } from "@/lib/finance/categories";
import { formatDateCell } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";

export type CategoryKind = "income" | "expense";

export type CategoryDrawerGroup = {
  id: string;
  name: string;
  type: string | null;
  isPayroll: boolean;
};

export type CategoryDrawerCategory = {
  id: string;
  name: string;
  type: CategoryKind;
  groupId: string | null;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  isPayroll: boolean;
  archivedAt: string | null;
  operations: number | null;
  lastDate: string | null;
  total: number | null;
};

export const CATEGORY_TYPE_LABEL: Record<CategoryKind, string> = {
  income: "Доход",
  expense: "Расход",
};

const TYPE_OPTIONS = [
  { value: "expense", label: "Расход" },
  { value: "income", label: "Доход" },
];

type Form = {
  name: string;
  type: CategoryKind;
  groupId: string;
  color: string | null;
  description: string;
};

const fromCategory = (category: CategoryDrawerCategory): Form => ({
  name: category.name,
  type: category.type,
  groupId: category.groupId ?? "",
  color: category.color,
  description: category.description ?? "",
});

/** Группа подходит статье: без ограничения, «любые» или того же типа. ФОТ — только сама. */
const groupFits = (group: CategoryDrawerGroup, type: CategoryKind) =>
  !group.isPayroll && (!group.type || group.type === "mixed" || group.type === type);

/**
 * Панель статьи. Открытая статья — просмотр: сводка (сумма и число операций,
 * тип, группа, описание) и «Изменить» в подвале. «Изменить» и создание —
 * форма в той же панели. Из формы операции панель открывается сразу формой
 * с заданным типом и отдаёт id новой статьи через `onSaved`.
 */
export function CategoryDrawer({
  open,
  onOpenChange,
  category,
  createType = "expense",
  lockType = false,
  groups,
  canManage,
  menu = [],
  operationsHref,
  onRestore,
  restoring = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` — новая статья. */
  category: CategoryDrawerCategory | null;
  createType?: CategoryKind;
  /** Тип задан операцией, из которой создают статью. */
  lockType?: boolean;
  /** Без списка групп поле «Группа» не показывается (создание из операции). */
  groups?: CategoryDrawerGroup[];
  canManage: boolean;
  /** Редкие действия просмотра (архив, удаление) — в меню «⋯» шапки. */
  menu?: TableRowMenuAction[];
  /** Ссылка на операции по статье; `null` — нет доступа к операциям. */
  operationsHref?: string | null;
  /** Вернуть статью из архива — главная кнопка у архивной статьи. */
  onRestore?: () => void;
  restoring?: boolean;
  onSaved?: (id: string) => void;
}) {
  const creating = category === null;
  const [editing, setEditing] = useState(creating);
  const [form, setForm] = useState<Form>(() =>
    category
      ? fromCategory(category)
      : { name: "", type: createType, groupId: "", color: null, description: "" },
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Панель переиспользуется: при каждом открытии — свежая форма.
  useEffect(() => {
    if (!open) return;
    setEditing(category === null);
    setForm(
      category
        ? fromCategory(category)
        : { name: "", type: createType, groupId: "", color: null, description: "" },
    );
    setNameError(null);
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id, createType]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setServerError(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const nameLocked = Boolean(category && (category.isSystem || category.isPayroll));
  const groupLocked = Boolean(category?.isPayroll);
  const fittingGroups = (groups ?? []).filter(
    (group) => groupFits(group, form.type) || group.id === form.groupId,
  );

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      setNameError("Укажите название статьи");
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      if (creating) {
        const { id, error } = await createFinanceCategory({
          name,
          type: form.type,
          group_id: groups ? form.groupId || null : null,
          color: form.color,
          description: form.description.trim() || null,
        });
        if (error || !id) {
          setServerError(error ?? "Не удалось создать статью");
          return;
        }
        toast.success(`Статья «${name}» создана`);
        onSaved?.(id);
        onOpenChange(false);
        return;
      }
      const { error } = await updateFinanceCategory(category.id, {
        ...(nameLocked ? {} : { name }),
        ...(groups && !groupLocked ? { group_id: form.groupId || null } : {}),
        color: form.color,
        description: form.description.trim() || null,
      });
      if (error) {
        setServerError(error);
        return;
      }
      toast.success("Статья сохранена");
      onSaved?.(category.id);
      setEditing(false);
    } catch {
      setServerError("Не удалось сохранить. Проверьте соединение и повторите");
    } finally {
      setSaving(false);
    }
  };

  const archived = Boolean(category?.archivedAt);
  const groupName = category?.groupId
    ? (groups ?? []).find((group) => group.id === category.groupId)?.name ?? null
    : null;

  // ── Просмотр ─────────────────────────────────────────────
  if (category && !editing) {
    const facts = [
      category.type === "income" ? "Статья доходов" : "Статья расходов",
      groupName ? `группа «${groupName}»` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <EditDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={category.name}
        description={facts}
        titleAccessory={archived ? <DrawerStatus label="В архиве" /> : undefined}
        headerActions={menu.length > 0 ? <TableRowMenu label="Действия со статьёй" actions={menu} /> : undefined}
        footer={
          operationsHref || (canManage && !archived) || (archived && onRestore) ? (
            <>
              {operationsHref ? (
                <Button asChild variant="outline">
                  <Link href={operationsHref}>Операции по статье</Link>
                </Button>
              ) : null}
              {archived && onRestore ? (
                <Button onClick={onRestore} disabled={restoring} className="min-w-40">
                  {restoring ? "Возвращаем…" : "Вернуть из архива"}
                </Button>
              ) : canManage && !archived ? (
                <Button onClick={() => setEditing(true)}>Изменить</Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        <DrawerSummary label="Данные статьи">
          {category.total !== null && (category.operations ?? 0) > 0 ? (
            <DrawerSummaryTotal
              label={category.type === "income" ? "Получено по статье" : "Потрачено по статье"}
              hint="За всё время, без удалённых операций"
            >
              <Money value={category.total} />
            </DrawerSummaryTotal>
          ) : null}
          <DrawerSummaryItem
            icon={category.type === "income" ? <ArrowDownLeft /> : <ArrowUpRight />}
            label="Тип"
          >
            {CATEGORY_TYPE_LABEL[category.type]}
          </DrawerSummaryItem>
          {groupName ? (
            <DrawerSummaryItem icon={<Folder />} label="Группа">
              {groupName}
            </DrawerSummaryItem>
          ) : null}
          {category.operations !== null ? (
            <DrawerSummaryItem icon={<Hash />} label="Операций">
              {category.operations > 0
                ? countRu(category.operations, "операция", "операции", "операций")
                : "Операций пока нет"}
            </DrawerSummaryItem>
          ) : null}
          {category.lastDate ? (
            <DrawerSummaryItem icon={<CalendarDays />} label="Последняя операция">
              <span className="tabular-nums">{formatDateCell(category.lastDate)}</span>
            </DrawerSummaryItem>
          ) : null}
          {category.color ? (
            <DrawerSummaryItem icon={<CategoryColorDot color={category.color} />} label="Цвет">
              Отмечает статью в списках операций
            </DrawerSummaryItem>
          ) : null}
          {category.description ? (
            <DrawerSummaryItem icon={<FileText />} label="Описание">
              <span className="whitespace-pre-line">{category.description}</span>
            </DrawerSummaryItem>
          ) : null}
        </DrawerSummary>
        {category.isPayroll || category.isSystem ? (
          <DrawerSection>
            <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {category.isPayroll
                ? "Статья ФОТ: по ней платят зарплату должности. Название и группу задаёт должность, в архив статью можно отправить после архива должности"
                : "Системная статья: её нельзя переименовать или отправить в архив. Цвет, группу и описание менять можно"}
            </p>
          </DrawerSection>
        ) : null}
      </EditDrawer>
    );
  }

  // ── Форма: создание и правка ─────────────────────────────
  const title = creating
    ? form.type === "income"
      ? "Новая статья доходов"
      : "Новая статья расходов"
    : "Изменение статьи";
  return (
    <EditDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => (creating ? onOpenChange(false) : setEditing(false))}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={saving} className="min-w-36">
            {saving ? (creating ? "Создаём…" : "Сохраняем…") : creating ? "Создать статью" : "Сохранить"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
        <Field
          id="category-name"
          label="Название"
          required
          error={nameError}
          hint={
            nameLocked
              ? category?.isPayroll
                ? "Название совпадает с должностью и меняется вместе с ней"
                : "Системную статью нельзя переименовать"
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              autoFocus={!nameLocked}
              value={form.name}
              maxLength={120}
              readOnly={nameLocked}
              placeholder={form.type === "income" ? "Например: Банкеты" : "Например: Закупка продуктов"}
              onChange={(event) => {
                setNameError(null);
                set("name", event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          id="category-type"
          label="Тип"
          hint={!creating ? "Тип не меняется: операции по статье остались бы в чужом разделе" : undefined}
        >
          {(control) => (
            <OptionSelect
              {...control}
              value={form.type}
              disabled={!creating || lockType}
              options={TYPE_OPTIONS}
              onValueChange={(value) => {
                const type = value as CategoryKind;
                const current = (groups ?? []).find((group) => group.id === form.groupId);
                setForm((prev) => ({
                  ...prev,
                  type,
                  // Группа другого типа статье не подходит — сбрасываем.
                  groupId: current && !groupFits(current, type) ? "" : prev.groupId,
                }));
              }}
            />
          )}
        </Field>
        {groups ? (
          <Field
            id="category-group"
            label="Группа"
            hint={groupLocked ? "Статьи должностей всегда в группе «Фонд оплаты труда»" : undefined}
          >
            {(control) => (
              <OptionSelect
                {...control}
                value={form.groupId}
                disabled={groupLocked}
                onValueChange={(value) => set("groupId", value)}
                options={[
                  { value: "", label: "Без группы" },
                  ...fittingGroups.map((group) => ({ value: group.id, label: group.name })),
                ]}
              />
            )}
          </Field>
        ) : null}
        <CategoryColorPicker value={form.color} onChange={(color) => set("color", color)} />
        <Field id="category-description" label="Описание">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={1000}
              value={form.description}
              placeholder="Что сюда относится, чтобы коллеги выбирали статью одинаково"
              onChange={(event) => set("description", event.target.value)}
            />
          )}
        </Field>
        {serverError ? (
          <p role="alert" className="text-xs text-destructive">
            {serverError}
          </p>
        ) : null}
      </form>
    </EditDrawer>
  );
}
