import type { Accrual, Component, PayModel } from "./types";
export const componentLabels: Record<string, string> = { base: "Выходы за смены", monthly: "Оклад", allowance: "Надбавка за месяц", percent: "Процент от продаж", extra: "Дополнительные продажи", experience: "Стаж", knowledge: "Знания", food: "Питание", bonus: "Премии", deduction: "Удержания", cleaner: "Премии", correction: "Корректировки" };
/** Missing source amounts remain unknown; an absent component is a genuine zero. */
export function componentAmount(components: Component[], kinds: string[]): number | null {
    const selected = components.filter(c => kinds.includes(c.kind));
    return selected.some(c => c.amount === null) ? null : selected.reduce((sum, c) => sum + Number(c.amount), 0);
}
export function shiftSalary(accrual: Accrual) { return Number(accrual.salary) - (componentAmount(accrual.components, ["monthly"]) ?? 0); }
export function accrualOtherAmount(accrual: Accrual): number | null {
    const known = componentAmount(accrual.components, ["base", "percent", "extra"]);
    return known === null ? null : Math.round((shiftSalary(accrual) - known) * 100) / 100;
}
export function isShiftAccrual(accrual: Accrual) { return !["monthly", "adjustment"].includes(String(accrual.calculation_snapshot.kind)); }
export function accrualRole(accrual: Accrual, fallback: string, context?: {
    models: PayModel[];
    roles?: {
        id: string;
        name: string;
    }[];
}) {
    const snapshot = accrual.calculation_snapshot;
    if (typeof snapshot.position_name === "string")
        return snapshot.position_name;
    const savedModel = snapshot.model as {
        id?: string;
    } | undefined;
    const roleId = context?.models.find(m => m.id === savedModel?.id)?.role_id;
    return context?.roles?.find(r => r.id === roleId)?.name ?? (typeof snapshot.role === "string" ? snapshot.role : fallback);
}
