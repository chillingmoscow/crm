import { integrationPageScope, integrationVenues } from "@/lib/integrations/settings";
import { readDoorPool } from "../actions";
import { DoorCodesSettings } from "./door-codes-settings";
import { IntegrationLayout, IntegrationNotice } from "../_components/integration-layout";
export default async function OfficeCodesPage() {
  const s = await integrationPageScope();
  if (!s.owner) return <IntegrationLayout title="Коды замка" description="Учёт кодов доступа сотрудников."><IntegrationNotice>Настройки кодов доступны владельцу организации.</IntegrationNotice></IntegrationLayout>;
  const [options, pool] = await Promise.all([integrationVenues(), readDoorPool()]);
  return <DoorCodesSettings key={s.accountId} {...options} initialPool={pool} />;
}
