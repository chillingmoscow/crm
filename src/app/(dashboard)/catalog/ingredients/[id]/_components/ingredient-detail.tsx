"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ClipboardList,
  ExternalLink,
  Info,
  Loader2,
  Package,
  Pencil,
  ScrollText,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { formatAmount, type AmountRoundingScale } from "@/lib/format/amount";
import type {
  CounterpartyOption,
  IngredientDetail as IngredientDetailModel,
  IngredientJournalEntry,
  IngredientSupplier,
  IngredientUsage,
} from "@/lib/inventory/ingredients";
import {
  addIngredientSupplier,
  removeIngredientSupplier,
  updateIngredientDescription,
  updateIngredientSupplier,
} from "@/app/(dashboard)/inventory/actions";
import { ProductImageUpload } from "../../_components/product-image-upload";

type Props = {
  ingredient: IngredientDetailModel;
  suppliers: IngredientSupplier[];
  usage: IngredientUsage[];
  journal: IngredientJournalEntry[];
  counterparties: CounterpartyOption[];
  canManage: boolean;
  amountRoundingScale: AmountRoundingScale;
};

const EVENT_LABELS: Record<string, string> = {
  synced: "Синхронизация с QuickResto",
  description_updated: "Изменено описание",
  photo_updated: "Обновлено фото",
  supplier_added: "Добавлен поставщик",
  supplier_updated: "Изменён поставщик",
  supplier_removed: "Удалён поставщик",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value ?? "—"}</span>
    </div>
  );
}

export function IngredientDetail({
  ingredient,
  suppliers,
  usage,
  journal,
  counterparties,
  canManage,
  amountRoundingScale,
}: Props) {
  const router = useRouter();
  const [description, setDescription] = useState(ingredient.localDescription ?? "");
  const [savingDescription, startSaveDescription] = useTransition();
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [sheetSupplier, setSheetSupplier] = useState<IngredientSupplier | null>(null);

  const dirty = (ingredient.localDescription ?? "") !== description;
  const isArchived = Boolean(ingredient.archivedAt);

  const saveDescription = () => {
    startSaveDescription(async () => {
      const result = await updateIngredientDescription({
        ingredientId: ingredient.id,
        description,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Описание сохранено");
      router.refresh();
    });
  };

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <Link
          href="/catalog/ingredients"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Ингредиенты
        </Link>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        {/* Header — плашка-иконка + H1 + бейджи (как карточка должности) */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center bg-muted text-muted-foreground">
            <Package className="w-7 h-7" />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[28px] font-bold tracking-tight leading-tight">
                {ingredient.name}
              </h1>
              <Badge
                variant="secondary"
                className="font-medium text-muted-foreground"
              >
                Quick Resto
              </Badge>
              {isArchived && (
                <Badge variant="outline" className="text-amber-700 border-amber-300">
                  Архивирован
                </Badge>
              )}
            </div>
            {ingredient.groupName && (
              <p className="text-sm text-muted-foreground leading-snug">
                {ingredient.groupName}
              </p>
            )}
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="justify-center">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="suppliers">Поставщики</TabsTrigger>
            <TabsTrigger value="usage">Где используется</TabsTrigger>
            <TabsTrigger value="journal">Журнал</TabsTrigger>
            <TabsTrigger
              value="danger"
              className="data-[state=active]:text-destructive data-[state=active]:border-destructive"
            >
              Опасная зона
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="mx-auto w-full max-w-[920px]">
              <div className="flex flex-col gap-6 md:flex-row">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                    {ingredient.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ingredient.imageUrl}
                        alt={ingredient.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  {canManage ? <ProductImageUpload productId={ingredient.id} /> : null}
                </div>

                <div className="grid flex-1 grid-cols-2 gap-4 md:grid-cols-3">
                  <Field label="Название" value={ingredient.name} />
                  <Field label="Группа" value={ingredient.groupName} />
                  <Field label="Ед. изм." value={ingredient.measureUnitName} />
                  <Field label="Артикул" value={ingredient.article} />
                  <Field label="Штрих-код" value={ingredient.barcode} />
                  <Field label="QR external id" value={ingredient.externalId} />
                  <Field
                    label="Себестоимость"
                    value={formatAmount(ingredient.currentPrimeCost, amountRoundingScale)}
                  />
                  <Field label="Остаток QR" value={ingredient.storeQuantityKg ?? "—"} />
                  <Field label="Лимит" value={ingredient.stockLimit ?? "—"} />
                  <Field
                    label="Синхронизирован"
                    value={
                      ingredient.syncedAt
                        ? new Date(ingredient.syncedAt).toLocaleString("ru-RU")
                        : "—"
                    }
                  />
                </div>
              </div>

              <div className="mt-8 max-w-2xl">
                <label className="mb-1 block text-sm font-medium">Описание</label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Локальное поле. Не перезаписывается синхронизацией QuickResto.
                </p>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={!canManage || savingDescription}
                  rows={4}
                  placeholder={canManage ? "Заметка по ингредиенту…" : "Описание не задано"}
                />
                {canManage ? (
                  <Button
                    type="button"
                    className="mt-3"
                    disabled={!dirty || savingDescription}
                    onClick={saveDescription}
                  >
                    {savingDescription ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Сохранить описание
                  </Button>
                ) : null}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="suppliers">
            <div className="mx-auto w-full max-w-[920px]">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Где закупать этот ингредиент. Один ингредиент может поставляться
                  несколькими контрагентами.
                </p>
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddSupplier((value) => !value);
                      setEditingSupplierId(null);
                    }}
                  >
                    {showAddSupplier ? "Отмена" : "Добавить поставщика"}
                  </Button>
                ) : null}
              </div>

              {showAddSupplier && canManage ? (
                <SupplierForm
                  ingredientId={ingredient.id}
                  counterparties={counterparties}
                  onDone={() => {
                    setShowAddSupplier(false);
                    router.refresh();
                  }}
                />
              ) : null}

              {suppliers.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  title="Поставщики не добавлены"
                  description={
                    canManage
                      ? "Добавьте контрагента, у которого закупаете ингредиент, чтобы новому менеджеру было понятно, где брать товар."
                      : "Список поставщиков пока пуст."
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Контрагент</th>
                        <th className="px-3 py-2 text-left">
                          <span className="inline-flex items-center gap-1">
                            Артикул у поставщика
                            <IconTooltip
                              label="Артикул у поставщика"
                              description="Код этой позиции в каталоге или прайсе самого поставщика. По нему быстрее оформлять заказ — необязательное поле."
                            >
                              <span className="cursor-help text-muted-foreground">
                                <Info className="h-3.5 w-3.5" />
                              </span>
                            </IconTooltip>
                          </span>
                        </th>
                        <th className="px-3 py-2 text-left">Цена</th>
                        <th className="px-3 py-2 text-left">Заметка</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {suppliers.map((supplier) => (
                        <SupplierRow
                          key={supplier.id}
                          supplier={supplier}
                          ingredientId={ingredient.id}
                          counterparties={counterparties}
                          canManage={canManage}
                          editing={editingSupplierId === supplier.id}
                          onOpenCounterparty={() => setSheetSupplier(supplier)}
                          onEdit={() => {
                            setEditingSupplierId(supplier.id);
                            setShowAddSupplier(false);
                          }}
                          onDone={() => {
                            setEditingSupplierId(null);
                            router.refresh();
                          }}
                          amountRoundingScale={amountRoundingScale}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="usage">
            <div className="mx-auto w-full max-w-[920px]">
              {usage.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="Пока нет документов"
                  description="Ингредиент ещё не встречается ни в одном акте инвентаризации. Он появится здесь после синхронизации актов с QuickResto."
                />
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Документ</th>
                        <th className="px-3 py-2 text-left">Дата</th>
                        <th className="px-3 py-2 text-left">Статус</th>
                        <th className="px-3 py-2 text-left">Факт</th>
                        <th className="px-3 py-2 text-left">Расчёт</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.map((item) => (
                        <tr key={item.documentId} className="border-t">
                          <td className="px-3 py-2">
                            <Link
                              href={`/documents/inventory/${item.documentId}`}
                              className="text-foreground underline-offset-2 hover:underline"
                            >
                              {item.documentNumber}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            {item.invoiceDate
                              ? new Date(item.invoiceDate).toLocaleDateString("ru-RU")
                              : "—"}
                          </td>
                          <td className="px-3 py-2">{item.status}</td>
                          <td className="px-3 py-2">{item.actualAmount ?? "—"}</td>
                          <td className="px-3 py-2">{item.calculatedAmount ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="journal">
            <div className="mx-auto w-full max-w-[920px]">
              {journal.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  title="Событий пока нет"
                  description="Здесь появятся записи о синхронизациях, правках описания и изменениях списка поставщиков."
                />
              ) : (
                <ul className="space-y-2">
                  {journal.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-4 rounded-lg border bg-background px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium">
                          {EVENT_LABELS[entry.eventType] ?? entry.eventType}
                        </div>
                        {entry.actorName ? (
                          <div className="text-xs text-muted-foreground">
                            {entry.actorName}
                          </div>
                        ) : null}
                      </div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString("ru-RU")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="danger">
            <div className="mx-auto w-full max-w-[720px] rounded-[14px] border bg-card p-6 flex flex-col gap-3">
              <h3 className="text-base font-semibold text-foreground">
                Удаление ингредиента
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Источник этого ингредиента — QuickResto, поэтому вручную удалить
                его нельзя: при следующей полной синхронизации он бы создался
                заново, а ссылки из актов инвентаризации потерялись бы.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Если ингредиент удалён в QuickResto, при ближайшей полной
                синхронизации он будет автоматически{" "}
                <span className="font-medium text-foreground">архивирован</span>:
                скрыт из дерева, но сохранён ради истории в актах и локальных
                данных (фото, описание, поставщики, журнал). Если он вернётся в
                выгрузку QuickResto — архивирование снимется автоматически.
              </p>
              <div className="rounded-lg bg-muted px-4 py-3 text-sm">
                Статус:{" "}
                {isArchived ? (
                  <span className="font-medium text-amber-700">
                    архивирован{" "}
                    {ingredient.archivedAt
                      ? new Date(ingredient.archivedAt).toLocaleString("ru-RU")
                      : ""}
                  </span>
                ) : (
                  <span className="font-medium text-foreground">активен</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Ручное создание и удаление позиций (вне QuickResto) появится
                позже, вместе с другими типами номенклатуры.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Sheet
        open={sheetSupplier !== null}
        onOpenChange={(open) => {
          if (!open) setSheetSupplier(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {sheetSupplier ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {sheetSupplier.counterpartyName}
                  {sheetSupplier.isPreferred ? (
                    <Badge variant="secondary">Предпочтительный</Badge>
                  ) : null}
                </SheetTitle>
                <SheetDescription>Контрагент-поставщик</SheetDescription>
              </SheetHeader>

              <div className="mt-6 flex flex-col gap-4">
                <CounterpartyField
                  label="Контактное лицо"
                  value={sheetSupplier.counterpartyContactPerson}
                />
                <CounterpartyField
                  label="Телефон"
                  value={
                    sheetSupplier.counterpartyPhone ? (
                      <a
                        href={`tel:${sheetSupplier.counterpartyPhone}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {sheetSupplier.counterpartyPhone}
                      </a>
                    ) : null
                  }
                />
                <CounterpartyField
                  label="Email"
                  value={
                    sheetSupplier.counterpartyEmail ? (
                      <a
                        href={`mailto:${sheetSupplier.counterpartyEmail}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {sheetSupplier.counterpartyEmail}
                      </a>
                    ) : null
                  }
                />
                <CounterpartyField label="ИНН" value={sheetSupplier.counterpartyInn} />
                <CounterpartyField label="КПП" value={sheetSupplier.counterpartyKpp} />
                <CounterpartyField
                  label="Адрес"
                  value={sheetSupplier.counterpartyAddress}
                />
                <CounterpartyField
                  label="Описание"
                  value={sheetSupplier.counterpartyDescription}
                />

                <div className="mt-2 rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">
                    Условия поставки этого ингредиента
                  </div>
                  <div className="mt-1 text-sm">
                    Артикул у поставщика: {sheetSupplier.supplierArticle ?? "—"}
                  </div>
                  <div className="text-sm">
                    Заметка: {sheetSupplier.note ?? "—"}
                  </div>
                </div>

                <Link
                  href={`/finance/counterparties/${sheetSupplier.counterpartyId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-2 hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  Открыть полную карточку контрагента
                </Link>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CounterpartyField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value ?? "—"}</span>
    </div>
  );
}

function SupplierForm({
  ingredientId,
  counterparties,
  supplier,
  onDone,
}: {
  ingredientId: string;
  counterparties: CounterpartyOption[];
  supplier?: IngredientSupplier;
  onDone: () => void;
}) {
  const [counterpartyId, setCounterpartyId] = useState(supplier?.counterpartyId ?? "");
  const [article, setArticle] = useState(supplier?.supplierArticle ?? "");
  const [price, setPrice] = useState(
    supplier?.supplierPrice != null ? String(supplier.supplierPrice) : "",
  );
  const [isPreferred, setIsPreferred] = useState(supplier?.isPreferred ?? false);
  const [note, setNote] = useState(supplier?.note ?? "");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const payload = {
        supplierArticle: article || null,
        supplierPrice: price.trim() === "" ? null : price,
        isPreferred,
        note: note || null,
      };
      const result = supplier
        ? await updateIngredientSupplier({ supplierId: supplier.id, ...payload })
        : await addIngredientSupplier({ ingredientId, counterpartyId, ...payload });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(supplier ? "Поставщик обновлён" : "Поставщик добавлен");
      onDone();
    });
  };

  return (
    <div className="mb-4 grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-2">
      {supplier ? (
        <div className="md:col-span-2 text-sm font-medium">{supplier.counterpartyName}</div>
      ) : (
        <select
          value={counterpartyId}
          onChange={(event) => setCounterpartyId(event.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
        >
          <option value="">Выберите контрагента-поставщика…</option>
          {counterparties.map((cp) => (
            <option key={cp.id} value={cp.id}>
              {cp.name}
              {cp.inn ? ` · ИНН ${cp.inn}` : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-col gap-1">
        <Input
          value={article}
          onChange={(event) => setArticle(event.target.value)}
          placeholder="Артикул у поставщика"
        />
        <span className="text-xs text-muted-foreground">
          Код позиции в каталоге/прайсе поставщика — по нему быстрее заказывать.
          Необязательно.
        </span>
      </div>
      <Input
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        placeholder="Цена закупки"
        inputMode="decimal"
      />
      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Заметка"
        className="md:col-span-2"
      />
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={isPreferred} onCheckedChange={setIsPreferred} />
        Предпочтительный поставщик
      </label>
      <div className="flex justify-end gap-2 md:col-span-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Отмена
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={pending || (!supplier && !counterpartyId)}
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {supplier ? "Сохранить" : "Добавить"}
        </Button>
      </div>
    </div>
  );
}

function SupplierRow({
  supplier,
  ingredientId,
  counterparties,
  canManage,
  editing,
  onOpenCounterparty,
  onEdit,
  onDone,
  amountRoundingScale,
}: {
  supplier: IngredientSupplier;
  ingredientId: string;
  counterparties: CounterpartyOption[];
  canManage: boolean;
  editing: boolean;
  onOpenCounterparty: () => void;
  onEdit: () => void;
  onDone: () => void;
  amountRoundingScale: AmountRoundingScale;
}) {
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <tr>
        <td colSpan={5} className="p-3">
          <SupplierForm
            ingredientId={ingredientId}
            counterparties={counterparties}
            supplier={supplier}
            onDone={onDone}
          />
        </td>
      </tr>
    );
  }

  const remove = () => {
    startTransition(async () => {
      const result = await removeIngredientSupplier({ supplierId: supplier.id });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Поставщик удалён");
      onDone();
    });
  };

  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCounterparty}
            className="text-left font-medium text-foreground underline-offset-2 hover:underline"
          >
            {supplier.counterpartyName}
          </button>
          {supplier.isPreferred ? <Badge variant="secondary">Предпочтительный</Badge> : null}
        </div>
        {supplier.counterpartyInn ? (
          <div className="text-xs text-muted-foreground">ИНН {supplier.counterpartyInn}</div>
        ) : null}
      </td>
      <td className="px-3 py-2">{supplier.supplierArticle ?? "—"}</td>
      <td className="px-3 py-2">
        {supplier.supplierPrice != null
          ? formatAmount(supplier.supplierPrice, amountRoundingScale)
          : "—"}
      </td>
      <td className="px-3 py-2">{supplier.note ?? "—"}</td>
      <td className="px-3 py-2">
        {canManage ? (
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="icon" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={remove}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
