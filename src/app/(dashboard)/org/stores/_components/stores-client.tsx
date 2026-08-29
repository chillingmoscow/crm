"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateInventoryStoreVenue } from "@/app/(dashboard)/inventory/_actions/documents";

type StoreRow = {
  id: string;
  external_id: string;
  title: string;
  store_code: string | null;
  description: string | null;
  local_venue_id: string | null;
};

type VenueRow = {
  id: string;
  name: string;
  archived_at: string | null;
};

export function StoresClient({
  stores,
  venues,
  canManage,
}: {
  stores: StoreRow[];
  venues: VenueRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Архивное заведение выбрать нельзя: резолвер привязки его тоже обходит
  // (src/lib/inventory/default-venue.ts), и предлагать то, что автоматика
  // считает нерабочим, — значит вести пользователя в тупик.
  const activeVenues = venues.filter((venue) => !venue.archived_at);
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));

  /**
   * Опции для конкретного склада. Текущая привязка обязана быть среди них,
   * иначе нативный <select> со значением, которого нет в списке, выберет
   * первую опцию — «Не привязан» — и покажет, что склад не привязан, хотя он
   * привязан.
   *
   * Два случая, когда текущего заведения нет в общем списке:
   *  - оно архивное (мы сами их отфильтровали) — показываем с пометкой;
   *  - его не видно пользователю. Списки приходят из политик РАЗНОЙ ширины:
   *    склады видны целиком по inventory.manage_stores (миграция 230), а
   *    заведения — только те, где у человека активная роль (миграция 198).
   *    Управляющий одной точки штатно видит склад, привязанный к соседней.
   *    Имени такого заведения у нас нет, поэтому показываем нейтральную
   *    подпись — но показываем, чтобы не соврать про привязку.
   */
  const optionsFor = (currentVenueId: string | null) => {
    if (!currentVenueId) return activeVenues;
    const current = venueById.get(currentVenueId);
    if (!current) {
      return [...activeVenues, { id: currentVenueId, name: "Другое заведение (нет доступа)", archived_at: null }];
    }
    if (!current.archived_at) return activeVenues;
    return [...activeVenues, current];
  };

  const updateVenue = (storeId: string, venueId: string) => {
    startTransition(async () => {
      const result = await updateInventoryStoreVenue({
        storeId,
        venueId: venueId || null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Склад обновлен");
      router.refresh();
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="grid grid-cols-[1fr_220px] items-center border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid-cols-[1.2fr_.8fr_280px]">
        <div>Склад Quick Resto</div>
        <div className="hidden md:block">Код</div>
        <div>Заведение</div>
      </div>
      {stores.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          Склады не найдены. Запустите синхронизацию на странице актов.
        </div>
      ) : (
        stores.map((store) => (
          <div
            key={store.id}
            className="grid grid-cols-[1fr_220px] items-center gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[1.2fr_.8fr_280px]"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{store.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">QR #{store.external_id}</div>
            </div>
            <div className="hidden text-sm md:block">{store.store_code ?? "—"}</div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60"
                value={store.local_venue_id ?? ""}
                disabled={!canManage || isPending}
                onChange={(event) => updateVenue(store.id, event.target.value)}
              >
                <option value="">Не привязан</option>
                {optionsFor(store.local_venue_id).map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                    {venue.archived_at ? " (в архиве)" : ""}
                  </option>
                ))}
              </select>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
