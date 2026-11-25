"use server";

import { z } from "zod";
import { actionResult } from "@/lib/actions/result";
import { createClient, getCachedPermissions } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  automationSettingsSchema,
  defaultAutomationSettings,
  type AutomationSettingsRecord,
  type AutomationSettingsRevision,
} from "@/lib/payroll/automation-settings";

async function scope(venueId: string) {
  z.string().uuid().parse(venueId);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  const permissions = await getCachedPermissions();
  const active = await client.rpc("get_active_venue_id");
  if (
    !user ||
    !permissions.includes("payroll.configure") ||
    active.error ||
    active.data !== venueId
  )
    throw new Error(
      "Выберите заведение и проверьте доступ к настройке оплаты труда",
    );
  return asLooseDb(client);
}

async function loadAutomationSettingsImpl(venueId: string) {
  const db = await scope(venueId);
  const [current, history] = await Promise.all([
    db
      .from<AutomationSettingsRecord>("payroll_automation_settings")
      .select("venue_id,version,config,updated_at")
      .eq("venue_id", venueId)
      .maybeSingle(),
    db
      .from<AutomationSettingsRevision[]>("payroll_automation_settings_history")
      .select("venue_id,version,config,updated_at,actor_name")
      .eq("venue_id", venueId)
      .order("version", { ascending: false })
      .limit(30),
  ]);
  if (current.error || history.error)
    throw new Error(current.error?.message ?? history.error?.message);
  const record = current.data ?? {
    venue_id: venueId,
    version: 0,
    config: defaultAutomationSettings,
    updated_at: null,
  };
  return {
    current: {
      ...record,
      config: automationSettingsSchema.parse(record.config),
    },
    history: history.data ?? [],
  };
}

async function saveAutomationSettingsImpl(input: {
  venueId: string;
  version: number;
  config: unknown;
}) {
  const value = z
    .object({
      venueId: z.string().uuid(),
      version: z.number().int().nonnegative(),
      config: automationSettingsSchema,
    })
    .parse(input);
  const db = await scope(value.venueId);
  const result = await db.rpc("payroll_save_automation_settings", {
    p_venue: value.venueId,
    p_version: value.version,
    p_config: value.config,
  });
  if (result.error) throw new Error(result.error.message);
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function loadAutomationSettings(venueId: string) {
  return actionResult(() => loadAutomationSettingsImpl(venueId), "Не удалось загрузить настройки автоматизаций");
}
export async function saveAutomationSettings(input: Parameters<typeof saveAutomationSettingsImpl>[0]) {
  return actionResult(() => saveAutomationSettingsImpl(input), "Не удалось сохранить настройки автоматизаций");
}
