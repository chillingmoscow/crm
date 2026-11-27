import type { Metadata } from "next";
import { integrationPageScope, integrationVenues } from "@/lib/integrations/settings";
import { unwrapAction } from "@/lib/actions/result";
import { getCachedActiveVenueId } from "@/lib/supabase/server";
import { getEmploymentSettings, readDoorPool } from "../actions";
import { DoorCodesSettings, DoorCodesOwnerOnly } from "./door-codes-settings";

export const metadata: Metadata = { title: "Коды замка" };

export default async function OfficeCodesPage() {
  const s = await integrationPageScope();
  if (!s.owner) return <DoorCodesOwnerOnly />;
  // Статус и факты активного заведения — с сервера, одной волной со списком
  // заведений, без скелетона и появляющихся кнопок. Если активным считается
  // другое заведение (нет профильного) или запрос сорвался — клиент запросит сам.
  const [options, pool, active] = await Promise.all([
    integrationVenues(),
    readDoorPool().then(unwrapAction),
    getCachedActiveVenueId().then(async (venueId) =>
      venueId ? { venueId, result: await getEmploymentSettings(venueId) } : null,
    ),
  ]);
  const settings =
    active && active.venueId === options.activeVenue && active.result.ok
      ? active.result.data
      : undefined;
  return <DoorCodesSettings key={s.accountId} {...options} initialPool={pool} initialSettings={settings} />;
}
