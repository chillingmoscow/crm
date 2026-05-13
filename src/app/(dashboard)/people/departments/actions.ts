"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type DepartmentSummary = {
  id: string;
  name: string;
  icon: string | null;
  icon_color: string | null;
  description: string | null;
  head_role_id: string | null;
  head_role_name: string | null;
  roles_count: number;
  staff_count: number;
};

export type Department = {
  id: string;
  account_id: string;
  name: string;
  icon: string | null;
  icon_color: string | null;
  description: string | null;
  head_role_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DepartmentRole = {
  id: string;
  name: string;
  code: string;
  icon: string | null;
  icon_color: string | null;
};

export type DepartmentHead = {
  venue_id: string;
  venue_name: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  role_id: string;
  role_name: string;
};

async function getActiveAccountId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_active_account_id");
  return (data as string | null) ?? null;
}

export async function listDepartments(
  venueId: string | null = null,
): Promise<DepartmentSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_departments_with_counts", {
    p_venue_id: venueId,
  });
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    icon_color: row.icon_color,
    description: row.description,
    head_role_id: row.head_role_id,
    head_role_name: row.head_role_name,
    roles_count: Number(row.roles_count ?? 0),
    staff_count: Number(row.staff_count ?? 0),
  }));
}

export async function getDepartment(
  id: string,
): Promise<{
  department: Department | null;
  roles: DepartmentRole[];
  heads: DepartmentHead[];
}> {
  const supabase = await createClient();

  const [{ data: department }, { data: roles }, { data: heads }] =
    await Promise.all([
      supabase
        .from("departments")
        .select(
          "id, account_id, name, icon, icon_color, description, head_role_id, created_at, updated_at",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("roles")
        .select("id, name, code, icon, icon_color")
        .eq("department_id", id)
        .order("name"),
      supabase.rpc("get_department_heads", { p_department_id: id }),
    ]);

  return {
    department: (department as Department | null) ?? null,
    roles: (roles ?? []) as DepartmentRole[],
    heads: ((heads ?? []) as DepartmentHead[]),
  };
}

export async function createDepartment(input: {
  name: string;
  icon?: string | null;
  iconColor?: string | null;
  description?: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const accountId = await getActiveAccountId();
  if (!accountId) return { id: null, error: "Заведение не настроено" };

  const name = input.name.trim();
  if (!name) return { id: null, error: "Название не может быть пустым" };

  const { data, error } = await supabase
    .from("departments")
    .insert({
      account_id: accountId,
      name,
      icon: input.icon?.trim() ? input.icon : null,
      icon_color: input.iconColor?.trim() ? input.iconColor : null,
      description: input.description?.trim() ? input.description : null,
    })
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };

  revalidatePath("/people/departments");
  return { id: data.id, error: null };
}

export async function updateDepartment(
  id: string,
  patch: {
    name?: string;
    icon?: string | null;
    iconColor?: string | null;
    description?: string | null;
    headRoleId?: string | null;
  },
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const update: {
    name?: string;
    icon?: string | null;
    icon_color?: string | null;
    description?: string | null;
    head_role_id?: string | null;
  } = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return { error: "Название не может быть пустым" };
    update.name = trimmed;
  }
  if (patch.icon !== undefined) {
    update.icon = patch.icon?.trim() ? patch.icon : null;
  }
  if (patch.iconColor !== undefined) {
    update.icon_color = patch.iconColor?.trim() ? patch.iconColor : null;
  }
  if (patch.description !== undefined) {
    update.description = patch.description?.trim() ? patch.description : null;
  }
  if (patch.headRoleId !== undefined) {
    update.head_role_id = patch.headRoleId;
  }

  if (Object.keys(update).length === 0) return { error: null };

  const { error } = await supabase
    .from("departments")
    .update(update)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/people/departments");
  revalidatePath(`/people/departments/${id}`);
  revalidatePath("/people/roles");
  return { error: null };
}

export async function deleteDepartment(
  id: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  // `on delete set null` на roles.department_id обнулит привязки автоматически.
  const { error } = await supabase.from("departments").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/people/departments");
  revalidatePath("/people/roles");
  return { error: null };
}

export async function setRoleDepartment(
  roleId: string,
  departmentId: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: role } = await supabase
    .from("roles")
    .select("account_id, code")
    .eq("id", roleId)
    .maybeSingle();
  if (!role) return { error: "Должность не найдена" };
  if (role.account_id === null) {
    return { error: "Системную должность нельзя привязать к подразделению" };
  }

  const { error } = await supabase
    .from("roles")
    .update({ department_id: departmentId })
    .eq("id", roleId);

  if (error) return { error: error.message };

  revalidatePath("/people/roles");
  revalidatePath("/people/departments");
  if (departmentId) revalidatePath(`/people/departments/${departmentId}`);
  return { error: null };
}
