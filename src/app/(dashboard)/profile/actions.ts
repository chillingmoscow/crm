"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Личные данные пользователя — те, что лежат на public.profiles и
 * управляются самим юзером через свой кабинет. Tenant-специфичное
 * (employment_date, медкнижка, PIN терминала, заметка HR) сюда НЕ
 * входят — это редактирует админ через карточку сотрудника.
 */
export type OwnProfile = {
  id:                 string;
  first_name:         string | null;
  last_name:          string | null;
  phone:              string | null;
  telegram_id:        string | null;
  gender:             string | null;
  birth_date:         string | null;
  // ISO timestamp когда birth_date был установлен/обновлён в последний
  // раз. Заполняется триггером tg_profiles_track_birth_date (миграция
  // 132). Read-only — не апдейтим вручную, иначе social-гард «изменено
  // тогда-то» теряет смысл.
  birth_date_set_at:  string | null;
  address:            string | null;
  avatar_url:         string | null;
};

export type OwnProfileUpdate = Omit<OwnProfile, "id" | "birth_date_set_at">;

export async function updateOwnProfile(
  data: Partial<OwnProfileUpdate>,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  // RLS-политика `profiles_update_own` гарантирует, что юзер может
  // менять только свой ряд (id = auth.uid()). Дополнительный фильтр
  // by id ниже — защита от случайных bug'ов на клиенте.
  //
  // .select("id").maybeSingle() — обязательно: без .select() UPDATE
  // не возвращает данные, и мы не можем отличить «обновили 0 строк»
  // (RLS блочит / id не нашёлся) от «обновили 1 строку успешно». Без
  // этой проверки action возвращал {error: null} даже когда DB не
  // изменилась — юзер видел toast.success при тихом провале.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!updated) {
    return { error: "Не удалось обновить профиль. Попробуйте перезайти в систему." };
  }
  revalidatePath("/profile");
  return { error: null };
}
