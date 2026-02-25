"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function getActiveAccountId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_active_account_id");
  return (data as string | null) ?? null;
}

export async function createRole(
  name: string
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const accountId = await getActiveAccountId();
  if (!accountId) return { id: null, error: "Заведение не настроено" };

  const trimmed = name.trim();
  const code = `custom_${trimmed
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .substring(0, 40)}`;

  const { data, error } = await supabase
    .from("roles")
    .insert({ account_id: accountId, name: trimmed, code })
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };

  revalidatePath("/settings/roles");
  return { id: data.id, error: null };
}

export async function updateRole(
  roleId: string,
  data: { name: string; comment: string | null }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: role } = await supabase
    .from("roles")
    .select("code")
    .eq("id", roleId)
    .maybeSingle();

  if (role?.code === "owner")
    return { error: "Нельзя редактировать должность Владелец" };

  const trimmed = data.name.trim();
  if (!trimmed) return { error: "Название не может быть пустым" };

  const { error } = await supabase
    .from("roles")
    .update({ name: trimmed, comment: data.comment })
    .eq("id", roleId);

  if (error) return { error: error.message };

  revalidatePath("/settings/roles");
  return { error: null };
}

export async function deleteRole(
  roleId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const accountId = await getActiveAccountId();
  if (!accountId) return { error: "Заведение не настроено" };

  const { error } = await supabase
    .from("roles")
    .delete()
    .eq("id", roleId)
    .eq("account_id", accountId);

  if (error) return { error: error.message };

  revalidatePath("/settings/roles");
  return { error: null };
}

export async function setRolePermission(
  roleId: string,
  permissionId: string,
  granted: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const accountId = await getActiveAccountId();
  if (!accountId) return { error: "Заведение не настроено" };

  // Prevent editing the owner role; all other roles (including system ones) are editable
  const { data: role } = await supabase
    .from("roles")
    .select("code")
    .eq("id", roleId)
    .maybeSingle();

  if (role?.code === "owner")
    return { error: "Нельзя редактировать должность Владелец" };

  const { error } = await supabase.from("role_permissions").upsert(
    { role_id: roleId, permission_id: permissionId, granted },
    { onConflict: "role_id,permission_id" }
  );

  if (error) return { error: error.message };

  revalidatePath("/settings/roles");
  return { error: null };
}
