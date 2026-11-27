import type { Metadata } from "next";
import { integrationPageScope, integrationVenues } from "@/lib/integrations/settings";
import { unwrapAction } from "@/lib/actions/result";
import { getEmploymentSettings, readDoorPool } from "../actions";
import { DoorCodesSettings, DoorCodesOwnerOnly } from "./door-codes-settings";

export const metadata: Metadata = { title: "Коды замка" };

export default async function OfficeCodesPage() {
  const s = await integrationPageScope();
  if (!s.owner) return <DoorCodesOwnerOnly />;
  const [options, pool] = await Promise.all([integrationVenues(), readDoorPool().then(unwrapAction)]);
  // Статус и факты активного заведения — с сервера, без скелетона и
  // появляющихся кнопок. Сбой — клиент запросит сам.
  const settings = options.activeVenue
    ? await getEmploymentSettings(options.activeVenue).then((r) => (r.ok ? r.data : undefined))
    : undefined;
  return <DoorCodesSettings key={s.accountId} {...options} initialPool={pool} initialSettings={settings} />;
}
