// Name parts for a Quick Resto employee. A casual worker created in the
// schedule has one name field; the first word is the first name.
export function splitCasualName(name: string, saved?: { first_name?: unknown; last_name?: unknown } | null) {
  if (typeof saved?.first_name === "string" && typeof saved?.last_name === "string")
    return { firstName: saved.first_name, lastName: saved.last_name };
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

type RoleModel = { role_id: string | null; is_role_default: boolean; archived: boolean; monthly_amount: number; quickresto_role_id: number | null };

// A casual worker can take a role with shift pay only, linked to Quick Resto
// (the same rule the database applies when the worker is created).
export function casualRoleIds(models: RoleModel[], linkedRoleIds: Iterable<string>) {
  const linked = new Set(linkedRoleIds);
  return new Set(
    models
      .filter((m) => m.role_id && m.is_role_default && !m.archived && Number(m.monthly_amount) === 0 &&
        (m.quickresto_role_id !== null || linked.has(m.role_id)))
      .map((m) => m.role_id!),
  );
}
