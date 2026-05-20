"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
  /** Optional palette tint name from `@/lib/palette` (gray/blue/…). */
  iconColor?: string | null;
}): Promise<{ id: string | null; error: string | null; warning?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  // Stage D venue-scope refactor: account_id больше не существует.
  // Роли создаются в активном venue.
  const { data: venueIdData } = await supabase.rpc("get_active_venue_id");
  const venueId = (venueIdData as string | null) ?? null;
  if (!venueId) return { id: null, error: "Заведение не выбрано" };

  const trimmed = input.name.trim();
  const code = `custom_${trimmed
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .substring(0, 40)}`;

  const insertPayload = {
    venue_id: venueId,
    name: trimmed,
    code,
    icon: input.icon && input.icon.trim() ? input.icon : null,
    icon_color: input.iconColor && input.iconColor.trim() ? input.iconColor : null,
  };
  const { data, error } = await supabase
    .from("roles")
    .insert(insertPayload as never)
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
  data: {
    name: string;
    comment: string | null;
    icon?: string | null;
    iconColor?: string | null;
  }
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
  const updatePayload: {
    name: string;
    comment: string | null;
    icon?: string | null;
    icon_color?: string | null;
  } = {
    name: trimmed,
    comment: data.comment,
  };
  if (data.icon !== undefined) {
    updatePayload.icon = data.icon && data.icon.trim() ? data.icon : null;
  }
  if (data.iconColor !== undefined) {
    updatePayload.icon_color =
      data.iconColor && data.iconColor.trim() ? data.iconColor : null;
  }

  const { error } = await supabase
    .from("roles")
    .update(updatePayload as never)
    .eq("id", roleId);

  if (error) return { error: error.message };

  revalidatePath("/people/roles");
  return { error: null };
}

// ────────────────────────────────────────────────────────────────────────
//  Archive / Restore / Hard-delete — docs/CONVENTIONS.md §2
//  roles — venue-scoped (system venue_id IS NULL — НЕ архивируемы).
// ────────────────────────────────────────────────────────────────────────

export type RoleArchiveImpact = {
  /** Сотрудники с этой ролью (CASCADE — членства удалятся при hard-delete). */
  members: number;
  /** Приглашения на эту роль (CASCADE). */
  invitations: number;
};

async function assertRoleOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleId: string,
  userId: string,
): Promise<{ ok: true; name: string; venue_id: string; code: string } | { ok: false; error: string }> {
  const { data: role } = await supabase
    .from("roles")
    .select("id, name, venue_id, code")
    .eq("id", roleId)
    .maybeSingle();
  if (!role) return { ok: false, error: "Роль не найдена" };
  if (role.venue_id === null) {
    return { ok: false, error: "Системную должность нельзя архивировать или удалить" };
  }
  if (role.code === "owner") {
    return { ok: false, error: "Должность Владелец нельзя удалить" };
  }

  const { data: venue } = await supabase
    .from("venues")
    .select("account_id")
    .eq("id", role.venue_id)
    .maybeSingle();
  if (!venue) return { ok: false, error: "Заведение не найдено" };

  const { data: account } = await supabase
    .from("accounts")
    .select("owner_id")
    .eq("id", venue.account_id)
    .maybeSingle();
  if (!account || account.owner_id !== userId) {
    return { ok: false, error: "Действие доступно только владельцу аккаунта" };
  }
  return { ok: true, name: role.name, venue_id: role.venue_id, code: role.code };
}

export async function getRoleArchiveImpact(
  roleId: string,
): Promise<RoleArchiveImpact> {
  const supabase = await createClient();
  const headOpts = { count: "exact" as const, head: true };
  const [members, invitations] = await Promise.all([
    supabase.from("user_venue_roles").select("user_id", headOpts).eq("role_id", roleId),
    supabase.from("invitations").select("id", headOpts).eq("role_id", roleId),
  ]);
  return {
    members: members.count ?? 0,
    invitations: invitations.count ?? 0,
  };
}

export async function archiveRole(
  roleId: string,
  opts: { confirmName: string },
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertRoleOwner(supabase, roleId, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  if (opts.confirmName.trim() !== ownerCheck.name.trim()) {
    return { error: "Введите название точно как у роли" };
  }

  const db = supabase as unknown as {
    from: (t: string) => {
      update: (v: unknown) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
    };
  };
  const { error } = await db
    .from("roles")
    .update({ archived_at: new Date().toISOString(), archived_by: user.id })
    .eq("id", roleId);
  if (error) return { error: error.message };

  revalidatePath("/people/roles");
  revalidatePath("/people/roles/archive");
  return { error: null };
}

export async function restoreRole(
  roleId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertRoleOwner(supabase, roleId, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  const db = supabase as unknown as {
    from: (t: string) => {
      update: (v: unknown) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
    };
  };
  const { error } = await db
    .from("roles")
    .update({ archived_at: null, archived_by: null })
    .eq("id", roleId);
  if (error) return { error: error.message };

  revalidatePath("/people/roles");
  revalidatePath("/people/roles/archive");
  return { error: null };
}

export async function deleteRole(
  roleId: string,
  opts?: { confirmName?: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertRoleOwner(supabase, roleId, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  if (opts?.confirmName !== undefined && opts.confirmName.trim() !== ownerCheck.name.trim()) {
    return { error: "Введите название точно как у роли" };
  }

  // RLS roles_delete_manage отбьёт если venue не в активном аккаунте.
  // CASCADE: user_venue_roles + invitations + role_permissions (миграция 197).
  const { error } = await supabase.from("roles").delete().eq("id", roleId);
  if (error) return { error: error.message };

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
