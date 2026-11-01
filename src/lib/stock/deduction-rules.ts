import { z } from "zod";
const line = z.string().trim().min(1).max(300);
const roleId = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());
const list = z
  .array(line)
  .max(500)
  .superRefine((xs, c) => {
    const norm = xs.map((x) => x.normalize("NFKC").toLocaleLowerCase("ru-RU"));
    if (new Set(norm).size !== xs.length)
      c.addIssue({
        code: "custom",
        message: "В списке есть повторяющиеся значения",
      });
  });
const amount = z
  .number()
  .finite()
  .min(0)
  .max(100000000)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001,
    "Не больше двух знаков после запятой",
  );
export const deductionRulesSchema = z
  .object({
    enabled: z.boolean(),
    companyAllowance: amount,
    multiplier: z
      .number()
      .finite()
      .min(0)
      .max(100)
      .refine(
        (n) => Math.abs(n * 10000 - Math.round(n * 10000)) < 0.000001,
        "Не больше четырёх знаков после запятой",
      ),
    ingredientTolerance: amount,
    distribution: z.enum(["groups", "departments", "shifts"]),
    split: z.enum(["pending", "once", "two_months", "two_payments"]),
    inventoryExclusions: list,
    roleSpecificCategories: list,
    writeoffReasons: list,
    excludedRoleIds: z.array(roleId).max(100),
    excludedDepartmentIds: z.array(roleId).max(100).optional(),
    groups: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
            name: line,
            share: z
              .number()
              .finite()
              .min(0)
              .max(100)
              .refine(
                (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001,
                "Не больше двух знаков после запятой",
              ),
            roleIds: z.array(roleId).max(100),
            departmentIds: z.array(roleId).max(100).optional(),
            categories: list,
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((r, c) => {
    if (new Set(r.groups.map((g) => g.id)).size !== r.groups.length)
      c.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Группы должны иметь разные ID",
      });
    const ids = [...r.groups.flatMap((g) => g.roleIds), ...r.excludedRoleIds];
    if (new Set(ids).size !== ids.length)
      c.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Должность может входить только в одну группу",
      });
    const departments = [
      ...r.groups.flatMap((g) => g.departmentIds ?? []),
      ...(r.excludedDepartmentIds ?? []),
    ];
    if (new Set(departments).size !== departments.length)
      c.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Подразделение может входить только в одну группу",
      });
    if (r.distribution === "departments") {
      if (ids.length > 0)
        c.addIssue({
          code: "custom",
          path: ["groups"],
          message:
            "В распределении по подразделениям выберите подразделения вместо должностей",
        });
      if (r.groups.some((g) => g.share > 0 && !g.departmentIds?.length))
        c.addIssue({
          code: "custom",
          path: ["groups"],
          message: "Выберите подразделения для каждой группы с ненулевой долей",
        });
    }
    if (
      r.distribution !== "shifts" &&
      (r.groups.length === 0 ||
        Math.abs(r.groups.reduce((s, g) => s + g.share, 0) - 100) > 0.000001)
    )
      c.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Сумма долей групп должна равняться 100%",
      });
  });
export type DeductionRules = z.infer<typeof deductionRulesSchema>;
export type DeductionRuleVersion = {
  id: string;
  version: number;
  valid_from: string;
  config: DeductionRules;
  reason: string;
  created_at: string;
  created_by: string;
  actor_name?: string;
};
export type StockRoleOption = {
  id: string;
  name: string;
  archived_at?: string | null;
  department_id?: string | null;
};
export type StockDepartmentOption = {
  id: string;
  name: string;
  archived_at?: string | null;
};

/** Only the new draft changes. Stored versions keep their original role assignments. */
export function departmentDraft(
  config: DeductionRules,
  roles: StockRoleOption[],
): DeductionRules {
  if (
    config.distribution === "departments" ||
    (config.distribution === "shifts" &&
      (config.excludedDepartmentIds !== undefined ||
        config.groups.some((g) => g.departmentIds !== undefined)))
  )
    return { ...config, split: "once" };
  const roleDepartment = (id: string) =>
    roles.find((r) => r.id === id)?.department_id;
  const candidates = config.groups.map((g) => [
    ...new Set(
      g.roleIds.map(roleDepartment).filter((id): id is string => !!id),
    ),
  ]);
  const excluded = [
    ...new Set(
      config.excludedRoleIds
        .map(roleDepartment)
        .filter((id): id is string => !!id),
    ),
  ];
  // A department spanning old groups/exclusions requires an explicit choice.
  const uses = [...candidates.flat(), ...excluded];
  return {
    ...config,
    split: "once",
    distribution: config.distribution === "groups" ? "departments" : "shifts",
    excludedRoleIds: [],
    excludedDepartmentIds: excluded.filter(
      (id) => uses.filter((x) => x === id).length === 1,
    ),
    groups: config.groups.map((g, i) => ({
      ...g,
      roleIds: [],
      departmentIds: candidates[i].filter(
        (id) => uses.filter((x) => x === id).length === 1,
      ),
    })),
  };
}
export const splitLabels: Record<DeductionRules["split"], string> = {
  pending: "Нужно уточнить",
  once: "В одном месяце",
  two_months: "На два зарплатных месяца",
  two_payments: "На две ближайшие выплаты",
};
export const readLines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
/** The venue covers only the amount actually incurred. Unused allowance is never a bonus. */
export function companyShortage(total: number | null, allowance: number) {
  amount.parse(allowance);
  if (total === null) return { total: null, company: null, employees: null };
  amount.parse(total);
  const cents = Math.round(total * 100),
    covered = Math.min(cents, Math.round(allowance * 100));
  return {
    total: cents / 100,
    company: covered / 100,
    employees: (cents - covered) / 100,
  };
}
/** Safe initial form from verified legacy settings; no payroll changes or automatic activation. */
export function deductionDraft(
  origin: Record<string, unknown>,
  roles: StockRoleOption[],
): DeductionRules | null {
  const legacy = origin.legacy_settings as
    | {
        places?: {
          rules?: { values?: unknown[][] };
          split?: { values?: unknown[][] };
        };
        positions?: { values?: unknown[][] };
      }
    | undefined;
  const r = legacy?.places?.rules?.values?.[0];
  if (!r) return null;
  const positions = legacy?.positions?.values ?? [];
  const groups = [
    ["bar", "Бар", "Бармен"],
    ["managers", "Менеджеры", "Менеджер"],
    ["masters", "Кальянные мастера", "Мастер"],
  ].map(([id, name, sourceName]) => {
    const p = positions.find((p) => p[0] === sourceName);
    const role = roles.find((x) => x.name === sourceName && !x.archived_at);
    if (!p || typeof p[1] !== "number")
      throw new Error("Не найдены исходные доли должностей");
    return {
      id,
      name,
      share: p[1],
      roleIds: role ? [role.id] : [],
      categories: readLines(String(p[5] ?? "")),
    };
  });
  return deductionRulesSchema.parse({
    enabled: r[0],
    companyAllowance: r[5],
    multiplier: r[1],
    ingredientTolerance: r[2],
    distribution: r[3] === true ? "groups" : "shifts",
    split:
      legacy?.places?.split?.values?.[0]?.[0] === true ? "pending" : "once",
    inventoryExclusions: readLines(String(r[4] ?? "")),
    roleSpecificCategories: readLines(String(r[6] ?? "")),
    writeoffReasons: readLines(String(r[7] ?? "")),
    groups,
    excludedRoleIds: positions
      .filter((p) => p[1] === 0)
      .flatMap((p) =>
        roles.filter((r) => r.name === p[0] && !r.archived_at).map((r) => r.id),
      ),
  });
}
