"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { ProfileTabsList, Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { Money } from "@/components/shared/money";
import { PageHeaderActions } from "@/components/shared/page-header-actions";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection } from "@/components/shared/profile-section";
import { SaveBar } from "@/components/shared/save-bar";
import { formatInventoryQuantity } from "@/lib/format/amount";
import type {
  CounterpartyOption,
  IngredientDetail,
  IngredientHistoryEntry,
  IngredientJournalEntry,
  IngredientSupplier,
} from "@/lib/inventory/ingredients";
import { updateIngredientDescription } from "@/app/(dashboard)/inventory/_actions/catalog";

import { catalogPath, type CatalogKindConfig } from "../_lib/kinds";
import { NomenclatureHistory } from "./nomenclature-history";
import { NomenclaturePhotoDialog } from "./nomenclature-photo-dialog";
import { NomenclatureSuppliers } from "./nomenclature-suppliers";

type TabKey = "overview" | "suppliers" | "history" | "journal";

const READ_ONLY_MESSAGE = "Описание меняют те, кто управляет номенклатурой";

function journalLabel(entry: IngredientJournalEntry): string {
  switch (entry.eventType) {
    case "synced":
      return "Синхронизация с Quick Resto";
    case "description_updated":
      return "Изменено описание";
    case "photo_updated":
      if (entry.payload.source === "quickresto") {
        return entry.payload.removed ? "Фото из Quick Resto убрано" : "Фото из Quick Resto";
      }
      return entry.payload.removed ? "Удалено фото" : "Обновлено фото";
    case "supplier_added":
      return "Добавлен поставщик";
    case "supplier_updated":
      return "Изменены условия поставщика";
    case "supplier_removed":
      return "Удалён поставщик";
    default:
      return "Изменение карточки";
  }
}

/** Строка чтения: подпись 13px серая, значение 14px, пустое — «Не указано». */
function ReadRow({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "" || children === "—";
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-[13px] leading-snug text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">
        {empty ? <span className="text-muted-foreground">Не указано</span> : children}
      </dd>
    </div>
  );
}

function PhotoTile({ url }: { url: string | null }) {
  return (
    <span className="flex size-14 items-center justify-center overflow-hidden rounded-[14px] bg-muted text-muted-foreground">
      {url ? (
        // Подписанная ссылка хранилища: оптимизатор next/image её не ждёт.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <Package className="size-7" aria-hidden />
      )}
    </span>
  );
}

/**
 * Карточка позиции номенклатуры — одна на ингредиенты, блюда и
 * полуфабрикаты. Данные Quick Resto только для чтения; своё — фото,
 * описание и поставщики.
 */
export function NomenclatureCard({
  config,
  item,
  suppliers,
  history,
  journal,
  counterparties,
  canManage,
  canViewResults,
}: {
  config: CatalogKindConfig;
  item: IngredientDetail;
  suppliers: IngredientSupplier[];
  history: IngredientHistoryEntry[];
  journal: IngredientJournalEntry[];
  counterparties: CounterpartyOption[];
  canManage: boolean;
  canViewResults: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("overview");
  const [photoOpen, setPhotoOpen] = useState(false);
  const savedDescription = item.localDescription ?? "";
  const [description, setDescription] = useState(savedDescription);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  // Сравниваем без крайних пробелов: сервер их срезает, и иначе форма
  // оставалась бы «изменённой» после сохранения.
  const dirty = canManage && description.trim() !== savedDescription.trim();

  const saveDescription = async () => {
    setSaving(true);
    try {
      const result = await updateIngredientDescription({ ingredientId: item.id, description });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Описание сохранено");
      startRefresh(() => router.refresh());
    } catch {
      toast.error("Не удалось сохранить описание. Проверьте подключение и повторите");
    } finally {
      setSaving(false);
    }
  };

  const unit = item.measureUnitName;
  const canOpenPhoto = canManage || Boolean(item.imageUrl);

  return (
    <div className="flex flex-1 flex-col">
      <Breadcrumbs
        items={[
          { label: "Номенклатура" },
          { label: config.title, href: catalogPath(config) },
          { label: item.name },
        ]}
      />
      <PageHeaderActions>
        <EntityInfoPopover
          title={config.aboutTitle}
          id={item.id}
          extraRows={[{ label: "Код Quick Resto", value: item.externalId }]}
          createdLabel={config.addedLabel}
          createdAt={item.createdAt}
          createdByName={null}
          updatedLabel={config.syncedLabel}
          updatedAt={item.syncedAt}
          updatedByName={null}
          showTime
        />
      </PageHeaderActions>

      <ProfilePageFrame>
        <ProfileHeader
          name={item.name}
          wrapName
          avatar={<PhotoTile url={item.imageUrl} />}
          avatarEdit={
            canOpenPhoto
              ? {
                  label: canManage
                    ? item.imageUrl
                      ? "Фото позиции"
                      : "Загрузить фото"
                    : "Открыть фото",
                  onClick: () => setPhotoOpen(true),
                }
              : undefined
          }
        >
          {item.groupName ? (
            <span className="text-sm text-muted-foreground">{item.groupName}</span>
          ) : null}
          {item.archivedAt ? (
            <StatusBadge
              tone="neutral"
              tip="Позицию удалили в Quick Resto: в списке она в архиве, история в актах сохранена"
            >
              В архиве
            </StatusBadge>
          ) : null}
        </ProfileHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
          <ProfileTabsList>
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="suppliers">Поставщики</TabsTrigger>
            <TabsTrigger value="history">История</TabsTrigger>
            <TabsTrigger value="journal">Журнал</TabsTrigger>
          </ProfileTabsList>

          <TabsContent value="overview" className="flex flex-col gap-5">
            <ProfileSection
              title="Данные Quick Resto"
              description="Обновляются при синхронизации. Изменить их можно в Quick Resto"
            >
              <dl className="grid gap-4 sm:grid-cols-2">
                <ReadRow label="Единица измерения">{unit}</ReadRow>
                <ReadRow label="Себестоимость">
                  {item.currentPrimeCost != null ? (
                    <Money value={item.currentPrimeCost} fraction="auto" />
                  ) : null}
                </ReadRow>
                <ReadRow label="Остаток">
                  {item.storeQuantityKg != null
                    ? formatInventoryQuantity(item.storeQuantityKg, unit)
                    : null}
                </ReadRow>
                <ReadRow label="Лимит остатка">
                  {item.stockLimit != null ? formatInventoryQuantity(item.stockLimit, unit) : null}
                </ReadRow>
                <ReadRow label="Артикул">{item.article}</ReadRow>
                <ReadRow label="Штрих-код">{item.barcode}</ReadRow>
              </dl>
            </ProfileSection>

            <ProfileSection
              title="Описание"
              description="Своя заметка команды. Синхронизация с Quick Resto её не трогает"
              locked={canManage ? undefined : { tone: "locked", message: READ_ONLY_MESSAGE }}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (dirty && !saving) void saveDescription();
                }}
              >
                <Field id="nomenclature-description" label="Заметка">
                  {(control) => (
                    <Textarea
                      {...control}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      disabled={!canManage}
                      rows={4}
                      maxLength={4000}
                      placeholder={
                        canManage
                          ? "Например: где хранится и как отличить от похожей позиции"
                          : "Описания нет"
                      }
                    />
                  )}
                </Field>
              </form>
            </ProfileSection>
          </TabsContent>

          <TabsContent value="suppliers">
            <NomenclatureSuppliers
              ingredientId={item.id}
              suppliers={suppliers}
              counterparties={counterparties}
              canManage={canManage}
            />
          </TabsContent>

          <TabsContent value="history">
            <NomenclatureHistory
              history={history}
              canViewResults={canViewResults}
              itemNoun={config.itemNoun}
            />
          </TabsContent>

          <TabsContent value="journal">
            <ProfileSection title="Журнал" description="Синхронизации и правки карточки">
              {journal.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Событий пока нет</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {journal.map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                      <span className="text-sm font-medium">{journalLabel(entry)}</span>
                      <span className="text-[13px] text-muted-foreground">
                        {entry.actorName ? `${entry.actorName} · ` : ""}
                        <LocalDateTime value={entry.createdAt} variant="dayTime" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ProfileSection>
          </TabsContent>
        </Tabs>

        <SaveBar
          dirty={dirty}
          saving={saving || refreshing}
          onSave={() => void saveDescription()}
          onReset={() => setDescription(savedDescription)}
        />
      </ProfilePageFrame>

      <NomenclaturePhotoDialog
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        productId={item.id}
        name={item.name}
        imageUrl={item.imageUrl}
        canManage={canManage}
      />
    </div>
  );
}
