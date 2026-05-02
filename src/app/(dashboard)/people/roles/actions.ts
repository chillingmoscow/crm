"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function getActiveAccountId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_active_account_id");
  return (data as string | null) ?? null;
}

export async function createRole(input: {
  name: string;
  /**
   * If provided, copy all `granted=true` permissions from this source role
   * into the freshly-created role. Source must be visible to the active
   * account (system role OR custom role owned by the account).
   * If the copy step fails, the role is still created — we surface a soft
   * warning instead of rolling back, so the user keeps the new role and
   * can adjust permissions manually.
   */
  copyFromRoleId?: string | null;
  /** Optional lucide icon name from ICON_REGISTRY. */
  icon?: string | null;
}): Promise<{ id: string | null; error: string | null; warning?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const accountId = await getActiveAccountId();
  if (!accountId) return { id: null, error: "Заведение не настроено" };

  const trimmed = input.name.trim();
  const code = `custom_${trimmed
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .substring(0, 40)}`;

  const { data, error } = await supabase
    .from("roles")
    .insert({
      account_id: accountId,
      name: trimmed,
      code,
      icon: input.icon && input.icon.trim() ? input.icon : null,
    })
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };

  let warning: string | undefined;
  if (input.copyFromRoleId) {
    const { error: copyError } = await supabase.rpc("copy_role_permissions", {
      p_source_role_id: input.copyFromRoleId,
      p_target_role_id: data.id,
    });
    if (copyError) {
      warning = `Должность создана, но не удалось скопировать права: ${copyError.message}`;
    }
  }

  revalidatePath("/people/roles");
  return { id: data.id, error: null, warning };
}

export async function updateRole(
  roleId: string,
  data: { name: string; comment: string | null; icon?: string | null }
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

  // Whitelist on icon: empty string → null (clear). Other validation
  // happens client-side via ICON_REGISTRY — backend just stores.
  const updatePayload: { name: string; comment: string | null; icon?: string | null } = {
    name: trimmed,
    comment: data.comment,
  };
  if (data.icon !== undefined) {
    updatePayload.icon = data.icon && data.icon.trim() ? data.icon : null;
  }

  const { error } = await supabase
    .from("roles")
    .update(updatePayload)
    .eq("id", roleId);

  if (error) return { error: error.message };

  revalidatePath("/people/roles");
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

  // Need to know whether this is a system role (account_id null) or a
  // custom one — the two have different teardown paths:
  // - custom role → physical DELETE from public.roles (RLS scoped to account)
  // - system role → insert into account_hidden_roles (per-account overlay)
  const { data: role } = await supabase
    .from("roles")
    .select("account_id, code")
    .eq("id", roleId)
    .maybeSingle();

  if (!role) return { error: "Роль не найдена" };
  if (role.code === "owner")
    return { error: "Должность Владелец нельзя удалить" };

  if (role.account_id === null) {
    // System role — per-account hide overlay
    const { error } = await supabase.rpc("hide_system_role", {
      p_role_id: roleId,
    });
    if (error) return { error: error.message };
  } else {
    // Custom role — physical delete (account_id RLS guards cross-tenant)
    const { error } = await supabase
      .from("roles")
      .delete()
      .eq("id", roleId)
      .eq("account_id", accountId);
    if (error) return { error: error.message };
  }

  revalidatePath("/people/roles");
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

  const { error } = await supabase.rpc("set_effective_role_permission", {
    p_role_id: roleId,
    p_permission_id: permissionId,
    p_granted: granted,
  });

  if (error) return { error: error.message };

  revalidatePath("/people/roles");
  return { error: null };
}
