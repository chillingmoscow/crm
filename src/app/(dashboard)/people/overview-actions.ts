"use server";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { overviewInput, overviewSchema } from "@/lib/people/overview";
export async function getPeopleOverview(input: unknown) {
  const { kind, month, scopeId } = overviewInput.parse(input);
  if (!(await getCachedUser())) throw new Error("Войдите в аккаунт");
  const db = asLooseDb(await createClient());
  const result = await db.rpc(
    kind === "staff" ? "staff_people_overview" : "candidate_people_overview",
    { p_month: month },
  );
  if (result.error) throw new Error("Не удалось загрузить обзор");
  const data = overviewSchema.parse(result.data);
  if (data.kind !== kind || data.scope_id !== scopeId)
    throw new Error("Рабочее пространство изменилось. Обновите страницу");
  return data;
}
