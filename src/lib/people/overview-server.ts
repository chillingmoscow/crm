import "server-only";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { overviewSchema, type OverviewKind, type PeopleOverviewData } from "./overview";

/**
 * «Обзор» сотрудников или кандидатов за месяц (`null` — текущий). Бросает
 * исключение с русским текстом; вызывающий решает, показать его или нет.
 */
export async function fetchPeopleOverview(
  kind: OverviewKind,
  scopeId: string,
  month: string | null,
): Promise<PeopleOverviewData> {
  const db = asLooseDb(await createClient());
  const result = await db.rpc(
    kind === "staff" ? "staff_people_overview" : "candidate_people_overview",
    { p_month: month },
  );
  if (result.error) throw new Error("Не удалось загрузить обзор");
  // Ответ базы не того вида — сбой загрузки, а не ошибка ввода.
  const parsed = overviewSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("Не удалось загрузить обзор");
  const data = parsed.data;
  if (data.kind !== kind || data.scope_id !== scopeId)
    throw new Error("Рабочее пространство изменилось. Обновите страницу");
  return data;
}

/**
 * Данные «Обзора» для первой отрисовки страницы: панель приходит с сервера
 * уже заполненной, и таблица под ней не уезжает, когда скелетон сменяется
 * содержимым другой высоты. Свёрнутый обзор (`open === false`) не грузим;
 * сбой — `undefined`, тогда панель догрузит данные сама.
 */
export async function initialPeopleOverview(
  kind: OverviewKind,
  scopeId: string | null | undefined,
  open: boolean | undefined,
): Promise<PeopleOverviewData | undefined> {
  if (open === false || !scopeId) return undefined;
  return fetchPeopleOverview(kind, scopeId, null).catch(() => undefined);
}
