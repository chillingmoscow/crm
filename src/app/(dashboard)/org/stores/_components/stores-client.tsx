"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  updateInventoryStoreDepartment,
  updateInventoryStoreVenue,
} from "@/app/(dashboard)/inventory/_actions/documents";

type StoreRow = {
  id: string;
  external_id: string;
  title: string;
  store_code: string | null;
  description: string | null;
  local_venue_id: string | null;
  department_id: string | null;
  department_scope: "unset" | "shared" | "department";
};

type DepartmentRow = {
  id: string;
  name: string;
  venue_id: string;
  archived_at: string | null;
};

type VenueRow = {
  id: string;
  name: string;
  archived_at: string | null;
};

export function StoresClient({
  stores,
  venues,
  departments,
  canManage,
}: {
  stores: StoreRow[];
  venues: VenueRow[];
  departments: DepartmentRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Спиннер только на той строке, которую меняют: список общий, а запись одна.
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null);

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

  // Подразделения принадлежат заведению: складу предлагаем только подразделения
  // его заведения. Выбор из чужого заведения база всё равно отклонит.
  // Архивное подразделение, как и архивное заведение, не предлагаем к выбору.
  const departmentsByVenue = new Map<string, DepartmentRow[]>();
  for (const department of departments) {
    if (department.archived_at) continue;
    const list = departmentsByVenue.get(department.venue_id) ?? [];
    list.push(department);
    departmentsByVenue.set(department.venue_id, list);
  }
  const departmentById = new Map(departments.map((department) => [department.id, department]));

  /**
   * Три состояния привязки в одном значении <select>: «unset» (ещё не
   * настроено), «shared» (платит общий пул) и «department:<id>». «Не задано»
   * — рабочее состояние: владелец настраивает склады по ходу, и оно должно
   * быть видно в списке, а не выглядеть как «общий склад».
   */
  const departmentValue = (store: StoreRow) =>
    store.department_scope === "department" && store.department_id
      ? `department:${store.department_id}`
      : store.department_scope === "shared"
        ? "shared"
        : "unset";

  const updateDepartment = (storeId: string, value: string) => {
    setPendingStoreId(storeId);
    startTransition(async () => {
      const result = await updateInventoryStoreDepartment(
        value.startsWith("department:")
          ? { storeId, scope: "department", departmentId: value.slice("department:".length) }
          : { storeId, scope: value === "shared" ? "shared" : "unset", departmentId: null },
      );
      setPendingStoreId(null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Склад обновлен");
      router.refresh();
    });
  };

  const updateVenue = (storeId: string, venueId: string) => {
    setPendingStoreId(storeId);
    startTransition(async () => {
      const result = await updateInventoryStoreVenue({
        storeId,
        venueId: venueId || null,
      });
      setPendingStoreId(null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Склад обновлен");
      router.refresh();
    });
  };

  const selectClass =
    "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-base disabled:opacity-60 sm:text-sm";

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="hidden grid-cols-[1.2fr_.6fr_240px_240px] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
        <div>Склад Quick Resto</div>
        <div>Код</div>
        <div>Заведение</div>
        <div>Подразделение</div>
      </div>
      {stores.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          Склады не найдены. Запустите синхронизацию на странице актов.
        </div>
      ) : (
        stores.map((store) => {
          const storeDepartments = store.local_venue_id ? (departmentsByVenue.get(store.local_venue_id) ?? []) : [];
          const value = departmentValue(store);
          // Текущее подразделение обязано быть среди опций, иначе нативный
          // <select> молча выбрал бы первую («Не задано») и соврал бы про
          // привязку. Не попадает в список оно в двух случаях: подразделение
          // в архиве (мы его отфильтровали) или не видно среди загруженных.
          const currentDepartment = store.department_id ? departmentById.get(store.department_id) : undefined;
          const extraDepartment =
            store.department_id && !storeDepartments.some((department) => department.id === store.department_id)
              ? currentDepartment
                ? `${currentDepartment.name}${currentDepartment.archived_at ? " (в архиве)" : ""}`
                : "Другое подразделение"
              : null;
          const rowPending = isPending && pendingStoreId === store.id;
          return (
            <div
              key={store.id}
              className="grid grid-cols-1 items-start gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[1.2fr_.6fr_240px_240px] md:items-center"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{store.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  QR #{store.external_id}
                  {store.store_code ? <span className="md:hidden"> · {store.store_code}</span> : null}
                </div>
              </div>
              <div className="hidden text-sm md:block">{store.store_code ?? "—"}</div>
              <div className="min-w-0">
                <div className="mb-1 text-xs text-muted-foreground md:hidden">Заведение</div>
                <div className="flex items-center gap-2">
                  <select
                    className={selectClass}
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
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-xs text-muted-foreground md:hidden">Подразделение</div>
                <div className="flex items-center gap-2">
                  <select
                    className={`${selectClass} ${value === "unset" ? "text-muted-foreground" : ""}`}
                    value={value}
                    disabled={!canManage || isPending}
                    onChange={(event) => updateDepartment(store.id, event.target.value)}
                  >
                    <option value="unset">Не задано</option>
                    <option value="shared">Общий склад</option>
                    {storeDepartments.length > 0 || extraDepartment ? (
                      <optgroup label="Подразделения">
                        {storeDepartments.map((department) => (
                          <option key={department.id} value={`department:${department.id}`}>
                            {department.name}
                          </option>
                        ))}
                        {extraDepartment ? (
                          <option value={`department:${store.department_id}`}>{extraDepartment}</option>
                        ) : null}
                      </optgroup>
                    ) : null}
                  </select>
                  {rowPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
                </div>
                {!store.local_venue_id ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Подразделение можно выбрать после привязки к заведению
                  </div>
                ) : storeDepartments.length === 0 ? (
                  <div className="mt-1 text-xs text-muted-foreground">В этом заведении пока нет подразделений</div>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
