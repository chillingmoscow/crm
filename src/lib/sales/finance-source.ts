import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getConnection, salesSource } from "./quickresto";
import { salesSettingsColumns, type SalesSettings } from "./types";
/** Shared attribution/window guard for financial readers. No name-based venue guesses. */
export async function financeSource(j: {
  account_id: string;
  venue_id: string;
  business_date: string;
  request: { timezone: string; dayStartHour: number };
  provider?: string;
}) {
  const db = asLooseDb(createAdminClient());
  const [settings, venue, links, other] = await Promise.all([
    db
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("account_id", j.account_id)
      .eq("venue_id", j.venue_id)
      .single(),
    db
      .from<{ id: string }>("venues")
      .select("id")
      .eq("account_id", j.account_id)
      .eq("id", j.venue_id)
      .is("archived_at", null)
      .maybeSingle(),
    db
      .from<{ id: string; local_id: string }[]>("external_entity_links")
      .select("id,local_id")
      .eq("account_id", j.account_id)
      .eq("provider", "quickresto")
      .eq("entity_type", "venue"),
    db
      .from<{ venue_id: string }[]>("sales_settings")
      .select("venue_id")
      .eq("account_id", j.account_id)
      .eq("enabled", true)
      .neq("venue_id", j.venue_id),
  ]);
  if (
    settings.error ||
    venue.error ||
    links.error ||
    other.error ||
    !settings.data ||
    !venue.data
  )
    throw new Error("Не удалось проверить источники и принадлежность данных");
  const s = settings.data;
  if (
    s.timezone !== j.request.timezone ||
    s.day_start_hour !== j.request.dayStartHour
  )
    throw new Error("Граница рабочего дня изменилась. Запустите чтение заново");
  if (
    s.quickresto_venue_id ||
    (links.data?.length ?? 0) > 1 ||
    links.data?.some((link) => link.local_id !== j.venue_id) ||
    other.data?.length
  )
    throw new Error(
      "Нужна подтверждённая привязка подключения к одному заведению",
    );
  const c = await getConnection(j.account_id);
  if (!c) throw new Error("Подключите Quick Resto");
  const provider = createHash("sha256")
    .update(JSON.stringify([c.login, c.backoffice_base_url ?? null]))
    .digest("hex");
  if (j.provider && j.provider !== provider)
    throw new Error("Подключение изменилось. Запустите чтение заново");
  return { source: salesSource(c, s, j.business_date), provider };
}
