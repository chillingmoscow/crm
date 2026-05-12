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
  id:          string;
  first_name:  string | null;
  last_name:   string | null;
  phone:       string | null;
  telegram_id: string | null;
  gender:      string | null;
  birth_date:  string | null;
  address:     string | null;
  avatar_url:  string | null;
};

export type OwnProfileUpdate = Omit<OwnProfile, "id">;

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
  const { error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", user.id);

  if (error) return { error: error.message };
  revalidatePath("/profile");
  return { error: null };
}
