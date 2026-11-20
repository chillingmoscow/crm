"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  ExternalLink,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryItem,
} from "@/components/ui/drawer-blocks";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/finance/combobox";
import { AmountInput } from "@/components/finance/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import {
  ProfileSection,
  ProfileSectionAddButton,
} from "@/components/shared/profile-section";
import { TableRowMenu } from "@/components/shared/table";
import type { CounterpartyOption, IngredientSupplier } from "@/lib/inventory/ingredients";
import {
  addIngredientSupplier,
  removeIngredientSupplier,
  updateIngredientSupplier,
} from "@/app/(dashboard)/inventory/_actions/catalog";

type DrawerState =
  | { mode: "closed" }
  | { mode: "view"; supplier: IngredientSupplier }
  | { mode: "edit"; supplier: IngredientSupplier }
  | { mode: "create" };

type Draft = {
  counterpartyId: string | null;
  article: string;
  price: number | null;
  note: string;
  isPreferred: boolean;
};

const emptyDraft: Draft = {
  counterpartyId: null,
  article: "",
  price: null,
  note: "",
  isPreferred: false,
};

function draftFrom(supplier: IngredientSupplier): Draft {
  return {
    counterpartyId: supplier.counterpartyId,
    article: supplier.supplierArticle ?? "",
    price: supplier.supplierPrice,
    note: supplier.note ?? "",
    isPreferred: supplier.isPreferred,
  };
}

/**
 * Вкладка «Поставщики»: у кого закупают позицию. Поставщики есть у всех
 * видов номенклатуры — в Quick Resto поставка может идти и на блюдо (банка
 * колы без техкарты), и на полуфабрикат.
 */
export function NomenclatureSuppliers({
  ingredientId,
  suppliers,
  counterparties,
  canManage,
}: {
  ingredientId: string;
  suppliers: IngredientSupplier[];
  counterparties: CounterpartyOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [removeTarget, setRemoveTarget] = useState<IngredientSupplier | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();

  const takenIds = new Set(suppliers.map((supplier) => supplier.counterpartyId));
  const counterpartyOptions = counterparties.map((cp) => ({
    value: cp.id,
    label: cp.name,
    hint: cp.inn ? `ИНН ${cp.inn}` : undefined,
    keywords: cp.inn ? [cp.inn] : undefined,
    disabled: takenIds.has(cp.id),
  }));

  const openCreate = () => {
    setDraft(emptyDraft);
    setSaveError(null);
    setDrawer({ mode: "create" });
  };
  const openEdit = (supplier: IngredientSupplier) => {
    setDraft(draftFrom(supplier));
    setSaveError(null);
    setDrawer({ mode: "edit", supplier });
  };
  const close = () => setDrawer({ mode: "closed" });

  const save = () => {
    if (drawer.mode !== "create" && drawer.mode !== "edit") return;
    setSaveError(null);
    const payload = {
      supplierArticle: draft.article.trim() || null,
      supplierPrice: draft.price,
      isPreferred: draft.isPreferred,
      note: draft.note.trim() || null,
    };
    startSave(async () => {
      try {
        const result =
          drawer.mode === "edit"
            ? await updateIngredientSupplier({ supplierId: drawer.supplier.id, ...payload })
            : await addIngredientSupplier({
                ingredientId,
                counterpartyId: draft.counterpartyId ?? "",
                ...payload,
              });
        if (result.error) {
          setSaveError(result.error);
          return;
        }
        toast.success(drawer.mode === "edit" ? "Поставщик сохранён" : "Поставщик добавлен");
        close();
        router.refresh();
      } catch {
        setSaveError("Не удалось сохранить. Проверьте подключение и повторите");
      }
    });
  };

  const remove = () => {
    if (!removeTarget) return;
    setRemoveError(null);
    startRemove(async () => {
      try {
        const result = await removeIngredientSupplier({ supplierId: removeTarget.id });
        if (result.error) {
          setRemoveError(result.error);
          return;
        }
        toast.success("Поставщик удалён");
        setRemoveTarget(null);
        close();
        router.refresh();
      } catch {
        setRemoveError("Не удалось удалить. Проверьте подключение и повторите");
      }
    });
  };

  const askRemove = (supplier: IngredientSupplier) => {
    setRemoveError(null);
    setRemoveTarget(supplier);
  };

  const formOpen = drawer.mode === "create" || drawer.mode === "edit";
  const viewed = drawer.mode === "view" ? drawer.supplier : null;
  const noCounterparties = counterparties.length === 0;

  return (
    <>
      <ProfileSection
        title="Поставщики"
        description="У кого закупать позицию. Поставщиков может быть несколько"
        actions={
          canManage ? (
            <span
              className="inline-flex"
              data-tip={noCounterparties ? "Сначала добавьте контрагента в разделе «Контрагенты»" : undefined}
            >
              <ProfileSectionAddButton onClick={openCreate} disabled={noCounterparties}>
                Добавить поставщика
              </ProfileSectionAddButton>
            </span>
          ) : undefined
        }
      >
        {suppliers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Поставщиков пока нет
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {suppliers.map((supplier) => (
              <li
                key={supplier.id}
                className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/30"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                >
                  <Building2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDrawer({ mode: "view", supplier })}
                      className="min-w-0 truncate text-left text-sm font-medium hover:underline"
                      data-tip={supplier.counterpartyName}
                    >
                      {supplier.counterpartyName}
                    </button>
                    {supplier.isPreferred ? (
                      <StatusBadge tone="info" className="shrink-0">
                        Основной
                      </StatusBadge>
                    ) : null}
                  </div>
                  <SupplierMeta supplier={supplier} />
                </div>
                <Money value={supplier.supplierPrice} fraction="auto" className="shrink-0 text-sm" />
                {canManage ? (
                  <TableRowMenu
                    actions={[
                      {
                        label: "Изменить",
                        icon: <Pencil />,
                        onSelect: () => openEdit(supplier),
                      },
                      {
                        label: "Удалить",
                        icon: <Trash2 />,
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => askRemove(supplier),
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      {/* Просмотр поставщика: контакты контрагента и условия по этой позиции. */}
      <EditDrawer
        open={viewed !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={viewed?.counterpartyName ?? "Поставщик"}
        titleAccessory={
          viewed?.isPreferred ? <DrawerStatus label="Основной" tone="info" /> : undefined
        }
        description={viewed?.counterpartyInn ? `ИНН ${viewed.counterpartyInn}${viewed.counterpartyKpp ? ` · КПП ${viewed.counterpartyKpp}` : ""}` : "Поставщик позиции"}
        footer={
          viewed ? (
            <>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Удалить поставщика"
                  data-tip="Удалить поставщика"
                  onClick={() => askRemove(viewed)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
              <Button variant="outline" asChild>
                <Link href={`/finance/counterparties/${viewed.counterpartyId}`}>
                  <ExternalLink className="size-4" />
                  Карточка контрагента
                </Link>
              </Button>
              {canManage ? <Button onClick={() => openEdit(viewed)}>Изменить</Button> : null}
            </>
          ) : undefined
        }
      >
        {viewed ? <SupplierView supplier={viewed} /> : null}
      </EditDrawer>

      {/* Добавление и правка условий поставки. */}
      <EditDrawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={drawer.mode === "edit" ? "Условия поставки" : "Новый поставщик"}
        description={drawer.mode === "edit" ? drawer.supplier.counterpartyName : undefined}
        footer={
          <>
            {drawer.mode === "edit" ? (
              <Button
                variant="ghost"
                size="icon"
                className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label="Удалить поставщика"
                data-tip="Удалить поставщика"
                onClick={() => askRemove(drawer.supplier)}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
            <Button variant="outline" onClick={close}>
              Отмена
            </Button>
            <Button
              className="min-w-32"
              onClick={save}
              disabled={saving || (drawer.mode === "create" && !draft.counterpartyId)}
            >
              {saving ? "Сохраняем…" : drawer.mode === "edit" ? "Сохранить" : "Добавить поставщика"}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) save();
          }}
        >
          <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
          {drawer.mode === "create" ? (
            <Field label="Контрагент" required>
              {() => (
                <Combobox
                  ariaLabel="Контрагент"
                  options={counterpartyOptions}
                  value={draft.counterpartyId}
                  onChange={(value) => setDraft((d) => ({ ...d, counterpartyId: value }))}
                  placeholder="Выберите контрагента"
                  searchPlaceholder="Название или ИНН"
                  emptyText="Контрагент не найден"
                />
              )}
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="supplier-article"
              label="Артикул у поставщика"
              hint="Код позиции в прайсе поставщика"
            >
              {(control) => (
                <Input
                  {...control}
                  value={draft.article}
                  onChange={(event) => setDraft((d) => ({ ...d, article: event.target.value }))}
                  maxLength={120}
                />
              )}
            </Field>
            <Field id="supplier-price" label="Цена закупки">
              {(control) => (
                <AmountInput
                  id={control.id}
                  value={draft.price}
                  onChange={(value) => setDraft((d) => ({ ...d, price: value }))}
                />
              )}
            </Field>
          </div>
          <Field id="supplier-note" label="Заметка">
            {(control) => (
              <Input
                {...control}
                value={draft.note}
                onChange={(event) => setDraft((d) => ({ ...d, note: event.target.value }))}
                placeholder="Например: заказ по вторникам"
                maxLength={500}
              />
            )}
          </Field>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="supplier-preferred">Основной поставщик</Label>
              <p className="text-xs text-muted-foreground">
                Показывается первым, когда решают, у кого заказать
              </p>
            </div>
            <Switch
              id="supplier-preferred"
              checked={draft.isPreferred}
              onCheckedChange={(value) => setDraft((d) => ({ ...d, isPreferred: value }))}
            />
          </div>
          {saveError ? (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          ) : null}
        </form>
      </EditDrawer>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            setRemoveError(null);
          }
        }}
        title={`Удалить поставщика «${removeTarget?.counterpartyName ?? ""}»?`}
        description="Контрагент останется в разделе «Контрагенты», пропадут только условия поставки этой позиции"
        confirmLabel="Удалить поставщика"
        pendingLabel="Удаляем…"
        destructive
        busy={removing}
        error={removeError}
        onConfirm={remove}
      />
    </>
  );
}

/** Вторая строка поставщика: артикул и заметка, а если их нет — ИНН. */
function SupplierMeta({ supplier }: { supplier: IngredientSupplier }) {
  const text =
    [supplier.supplierArticle ? `Арт. ${supplier.supplierArticle}` : null, supplier.note]
      .filter(Boolean)
      .join(" · ") || (supplier.counterpartyInn ? `ИНН ${supplier.counterpartyInn}` : "");
  if (!text) return null;
  return (
    <div className="truncate text-[13px] text-muted-foreground" data-tip={text}>
      {text}
    </div>
  );
}

function SupplierView({ supplier }: { supplier: IngredientSupplier }) {
  const contacts = [
    supplier.counterpartyContactPerson
      ? { icon: <UserRound />, label: "Контактное лицо", value: supplier.counterpartyContactPerson }
      : null,
    supplier.counterpartyPhone
      ? {
          icon: <Phone />,
          label: "Телефон",
          value: (
            <a href={`tel:${supplier.counterpartyPhone}`} className="hover:underline">
              {supplier.counterpartyPhone}
            </a>
          ),
        }
      : null,
    supplier.counterpartyEmail
      ? {
          icon: <Mail />,
          label: "Email",
          value: (
            <a href={`mailto:${supplier.counterpartyEmail}`} className="hover:underline">
              {supplier.counterpartyEmail}
            </a>
          ),
        }
      : null,
    supplier.counterpartyAddress
      ? { icon: <MapPin />, label: "Адрес", value: supplier.counterpartyAddress }
      : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  const terms = [
    supplier.supplierPrice != null
      ? { label: "Цена закупки", value: <Money value={supplier.supplierPrice} fraction="auto" /> }
      : null,
    supplier.supplierArticle ? { label: "Артикул у поставщика", value: supplier.supplierArticle } : null,
    supplier.note ? { label: "Заметка", value: supplier.note } : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <>
      {contacts.length > 0 ? (
        <DrawerSummary label="Контакты поставщика">
          {contacts.map((row) => (
            <DrawerSummaryItem key={row.label} icon={row.icon} label={row.label}>
              {row.value}
            </DrawerSummaryItem>
          ))}
        </DrawerSummary>
      ) : (
        <p className="text-sm text-muted-foreground">
          Контакты не заполнены. Их добавляют в карточке контрагента
        </p>
      )}
      <DrawerSection title="Условия поставки">
        {terms.length > 0 ? (
          <dl className="grid gap-3">
            {terms.map((row) => (
              <div key={row.label} className="grid gap-0.5">
                <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
                <dd className="text-sm">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Условия не указаны</p>
        )}
      </DrawerSection>
      {supplier.counterpartyDescription ? (
        <DrawerSection title="О контрагенте">
          <p className="whitespace-pre-wrap text-sm">{supplier.counterpartyDescription}</p>
        </DrawerSection>
      ) : null}
    </>
  );
}
