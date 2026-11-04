import type { DeductionRules } from "./deduction-rules";

/** Доля подразделения в общей недостаче. Один источник правды для страницы подразделения и сводки заведения. */
export type DepartmentShare = {
  departmentId: string;
  participates: boolean;
  share: number;
};

type Group = DeductionRules["groups"][number];

/** Модель «одна группа = одно подразделение»; группы из нескольких подразделений её ломают. */
export function multiDepartmentGroupExists(rules: DeductionRules): boolean {
  return rules.groups.some((g) => (g.departmentIds?.length ?? 0) > 1);
}

export function sharesFromRules(
  rules: DeductionRules,
  departmentIds: string[],
): DepartmentShare[] {
  const excluded = new Set(rules.excludedDepartmentIds ?? []);
  return departmentIds.map((departmentId) => {
    if (excluded.has(departmentId))
      return { departmentId, participates: false, share: 0 };
    const group = rules.groups.find((g) =>
      g.departmentIds?.includes(departmentId),
    );
    return { departmentId, participates: true, share: group?.share ?? 0 };
  });
}

export function rulesWithShares(
  rules: DeductionRules,
  shares: DepartmentShare[],
  names: Map<string, string>,
): DeductionRules {
  if (multiDepartmentGroupExists(rules))
    throw new Error(
      "Группа объединяет несколько подразделений. Разделите её в настройках заведения",
    );
  const byDepartment = new Map(shares.map((s) => [s.departmentId, s]));
  const written = new Set<string>();
  const groups: Group[] = [];
  // Существующие группы идут первыми и сохраняют id, название и прочие поля.
  for (const g of rules.groups) {
    const departmentId = g.departmentIds?.[0];
    const s = departmentId ? byDepartment.get(departmentId) : undefined;
    if (!departmentId || !s || !s.participates || s.share <= 0) continue;
    groups.push({ ...g, share: s.share, departmentIds: [departmentId] });
    written.add(departmentId);
  }
  for (const s of shares) {
    if (written.has(s.departmentId) || !s.participates || s.share <= 0)
      continue;
    groups.push({
      id: `dept-${s.departmentId}`,
      name: names.get(s.departmentId) ?? "Подразделение",
      share: s.share,
      roleIds: [],
      departmentIds: [s.departmentId],
      categories: [],
    });
  }
  const known = new Set(shares.map((s) => s.departmentId));
  const excluded = [
    // Уже исключённые подразделения вне переданного списка не трогаем.
    ...(rules.excludedDepartmentIds ?? []).filter((id) => !known.has(id)),
    ...shares.filter((s) => !s.participates).map((s) => s.departmentId),
  ];
  return { ...rules, groups, excludedDepartmentIds: excluded };
}

/** Сумма долей участвующих подразделений, без хвостов float. */
export function sharesTotal(shares: DepartmentShare[]): number {
  const cents = shares
    .filter((s) => s.participates)
    .reduce((n, s) => n + Math.round(s.share * 100), 0);
  return cents / 100;
}
