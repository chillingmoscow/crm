import { z } from "zod";
import { calculateSettlement, compareSettlement, type SettlementReceipt, type SettlementSettings } from "@/lib/sales/settlement";
import { planCashMovements, compareCashMovements, type CashMovement, type CashMovementRules, type MovementTransaction, type MovementPlan } from "@/lib/sales/cash-movements";
import { validDate } from "@/lib/sales/time";
export type NativeFinanceKind = "settlement" | "movements";
export type NativeFinanceLedgerRow = MovementTransaction & {
    raw?: Record<string, unknown>;
};
export type NativeFinanceAlias = {
    key: string;
    original: NativeFinanceCommand;
    transactionIds: (string | null)[];
    baseline: NativeFinanceLedgerRow[];
    autoCancelled: boolean;
};
export type NativeFinanceSnapshot = {
    accountId: string;
    venueId: string;
    date: string;
    kind: NativeFinanceKind;
    source: {
        id: string;
        version: number;
        hash: string;
        facts?: SettlementReceipt[];
        items?: CashMovement[];
        locations?: Record<string, string>;
    };
    rule: {
        id: string;
        version: number;
        config: SettlementSettings | CashMovementRules;
    };
    ledger: NativeFinanceLedgerRow[];
    aliases: NativeFinanceAlias[];
};
export type NativeFinanceCommand = {
    key: string;
    date: string;
    type: "income" | "expense" | "transfer";
    bankAccountId: string;
    toBankAccountId: string | null;
    categoryId: string | null;
    amountCents: number;
    description: string;
    sourceIds: number[];
    mode: "create" | "link" | "update" | "restore" | "cancel" | "cancelled";
    transactionIds: string[];
};
export type NativeFinancePlan = {
    commands: NativeFinanceCommand[];
    blockers: string[];
};
const markedIds = (s: string) => [...s.matchAll(/#(\d+)(?!\d)/g)].map((m) => Number(m[1]));
const targetIds = (t: MovementTransaction) => t.sourceIds?.length ? t.sourceIds : markedIds(t.description);
const sameFinancialEffect = (a: NativeFinanceCommand, b: NativeFinanceCommand) => a.date === b.date && a.type === b.type && a.bankAccountId === b.bankAccountId &&
    a.toBankAccountId === b.toBankAccountId && a.categoryId === b.categoryId && a.amountCents === b.amountCents &&
    JSON.stringify([...a.sourceIds].sort((x, y) => x - y)) === JSON.stringify([...b.sourceIds].sort((x, y) => x - y));
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])).join(",")}}` : JSON.stringify(v);
const movementFields = (p: MovementPlan) => ({ key: p.key, date: p.date, type: p.type, bankAccountId: p.bankAccountId, toBankAccountId: p.toBankAccountId, categoryId: p.categoryId, amountCents: p.amountCents, sourceIds: p.sourceIds });
const unchanged = (a: NativeFinanceLedgerRow, b: NativeFinanceLedgerRow) => a.id === b.id && a.venueId === b.venueId && a.date === b.date && a.type === b.type && a.bankAccountId === b.bankAccountId &&
    a.toBankAccountId === b.toBankAccountId && a.categoryId === b.categoryId && a.amountCents === b.amountCents &&
    a.deleted === b.deleted && a.description === b.description && canonical(a.raw ?? null) === canonical(b.raw ?? null);
/** Build a complete, immutable proposal. Only proven source-owned rows may be corrected. */
export function prepareNativeFinance(s: NativeFinanceSnapshot): NativeFinancePlan {
    z.string().uuid().parse(s.accountId);
    z.string().uuid().parse(s.venueId);
    if (!validDate(s.date) || !Number.isInteger(s.source.version) || s.source.version < 1 || !s.source.hash)
        throw new Error("Не подтверждён снимок финансовых фактов");
    if (new Set(s.ledger.map(t => t.id)).size !== s.ledger.length || new Set(s.aliases.map(a => a.key)).size !== s.aliases.length)
        throw new Error("Повторные операции или связи источника");
    const blockers: string[] = [], commands: NativeFinanceCommand[] = [];
    const ledger = s.ledger.map(t => ({ ...t, sourceIds: t.sourceIds ? [...t.sourceIds] : undefined }));
    for (const a of s.aliases) {
        if (!a.transactionIds.length || a.transactionIds.some(id => !id || !ledger.some(t => t.id === id))) {
            blockers.push(`Ранее учтённая операция недоступна: ${a.original.description}`);
            continue;
        }
        for (const t of ledger.filter(t => a.transactionIds.includes(t.id))) {
            if (s.kind === "settlement")
                t.sourceKey = a.key;
            else if (!t.sourceIds?.length && !markedIds(t.description).length)
                t.sourceIds = a.original.sourceIds;
        }
    }
    const add = (cmd: NativeFinanceCommand) => {
        if (!Number.isSafeInteger(cmd.amountCents) || cmd.amountCents <= 0 || cmd.amountCents > 100000000000)
            throw new Error("Некорректная сумма финансового проведения");
        const previous = s.aliases.find(a => a.key === cmd.key);
        if (previous) {
            const current = s.ledger.filter(t => previous.transactionIds.includes(t.id));
            if (current.length !== 1 || previous.baseline.length !== 1 || !unchanged(current[0], previous.baseline[0]))
                blockers.push(`Сохранена ручная правка: ${cmd.description}`);
            if (JSON.stringify([...previous.transactionIds].sort()) !== JSON.stringify([...cmd.transactionIds].sort()))
                blockers.push(`Изменилась связь источника: ${cmd.description}`);
            if (cmd.mode !== "cancel" && cmd.mode !== "cancelled") {
                if (current[0]?.deleted)
                    cmd.mode = previous.autoCancelled ? "restore" : "cancelled";
                else
                    cmd.mode = sameFinancialEffect(previous.original, cmd) ? "link" : "update";
            }
        }
        if (cmd.mode === "cancelled") {
            const t = s.ledger.find(t => cmd.transactionIds.includes(t.id));
            if (t && (t.date !== cmd.date || t.type !== cmd.type || t.bankAccountId !== cmd.bankAccountId || t.toBankAccountId !== cmd.toBankAccountId || t.categoryId !== cmd.categoryId || t.amountCents !== cmd.amountCents))
                blockers.push(`Сохраняем отмену; изменился источник: ${cmd.description}`);
        }
        if (cmd.mode === "create" && ledger.some(t => t.deleted && t.date === cmd.date && t.type === cmd.type &&
            t.bankAccountId === cmd.bankAccountId && t.categoryId === cmd.categoryId && t.amountCents === cmd.amountCents))
            blockers.push(`Есть отменённая похожая операция: ${cmd.description}`);
        commands.push(cmd);
    };
    if (s.kind === "settlement") {
        const facts = s.source.facts;
        if (!facts)
            throw new Error("Не загружены финансовые факты дня");
        const plan = calculateSettlement({ date: s.date, complete: true, expectedOrderIds: facts.map(r => r.id), receipts: facts, settings: s.rule.config as SettlementSettings });
        const comparison = compareSettlement(plan, ledger.map(t => ({
            ...t, type: z.enum(["income", "expense", "transfer"]).parse(t.type), venueId: t.venueId ?? "", sourceKey: t.sourceKey?.startsWith("qr:daily-settlement:") ? t.sourceKey : null, amount: t.amountCents / 100,
        })), true);
        const bound = new Set(s.aliases.flatMap(a => a.transactionIds));
        if ([...comparison.extraNative, ...comparison.extraLegacy].some(id => !bound.has(id)))
            blockers.push("Есть несвязанные операции, которых больше нет в расчёте дня");
        for (const r of comparison.matches) {
            if (r.state === "review" || (r.state === "changed" && !s.aliases.some(a => a.key === r.effect.key))) {
                blockers.push(`Проверьте ранее проведённую операцию: ${r.effect.description}`);
                continue;
            }
            add({ key: r.effect.key, date: r.effect.date, type: r.effect.type, bankAccountId: r.effect.bankAccountId,
                toBankAccountId: null, categoryId: r.effect.categoryId, amountCents: Math.round(r.effect.amount * 100), description: r.effect.description,
                sourceIds: [], mode: r.state === "missing" ? "create" : r.state === "cancelled" && !s.aliases.some(a => a.key === r.effect.key && a.autoCancelled) ? "cancelled" : "link", transactionIds: r.transactionIds });
        }
    }
    else {
        const source = s.source.items;
        if (!source || source.some(r => r.date !== s.date))
            throw new Error("Не подтверждён полный кассовый день");
        const plan = planCashMovements(s.venueId, source, s.rule.config as CashMovementRules);
        blockers.push(...plan.review.map(r => `#${r.sourceId}: ${r.message}`));
        const ordinary = plan.plans.filter(p => !p.key.includes(":taxi:"));
        for (const r of compareCashMovements({ venueId: s.venueId, plans: ordinary, source, transactions: ledger, complete: true })) {
            const cancelled = ledger.filter(t => t.sourceKey === r.plan.key && t.deleted);
            if (r.state === "conflict" && !(cancelled.length === 1 && r.transactionIds.length === 1) &&
                !(r.transactionIds.length === 1 && s.aliases.some(a => a.key === r.plan.key && a.transactionIds[0] === r.transactionIds[0]))) {
                blockers.push(`${r.plan.label}: ${r.problems.join("; ")}`);
                continue;
            }
            add({ ...movementFields(r.plan), description: `${r.plan.label} · ${r.plan.sourceIds.map(id => "#" + id).join(", ")}`,
                mode: cancelled.length && !s.aliases.some(a => a.key === r.plan.key && a.autoCancelled) ? "cancelled" : r.state === "missing" ? "create" : "link", transactionIds: r.transactionIds });
        }
        // A taxi expense can cover a subset of the day's source IDs. Preserve each
        // verified partition, and create only the newly arrived remainder.
        for (const taxi of plan.plans.filter(p => p.key.includes(":taxi:"))) {
            const members = new Set(taxi.sourceIds), used = new Set<number>();
            const candidates = ledger.filter(t => t.type !== "transfer" && (t.sourceKey === taxi.key || targetIds(t).some(id => members.has(id)))).sort((a, b) => Number(a.deleted) - Number(b.deleted) || a.id.localeCompare(b.id));
            for (const t of candidates) {
                const ids = t.sourceKey === taxi.key ? taxi.sourceIds : targetIds(t);
                const known = s.aliases.find(a => a.transactionIds.includes(t.id));
                // A former aggregate can lose one source item. Cancel that old
                // partition and create the surviving remainder under its own identity.
                if (known && ids.some(id => !members.has(id)))
                    continue;
                if (t.deleted && known?.autoCancelled && ids.some(id => used.has(id)))
                    continue;
                const part: MovementPlan = { ...taxi, key: `${taxi.key}:part:${[...ids].sort((a, b) => a - b).join("-")}`, sourceIds: ids,
                    amountCents: ids.reduce((sum, id) => sum + (source.find(r => r.id === id)?.amountCents ?? NaN), 0) };
                if (!ids.length || ids.some(id => !members.has(id) || used.has(id)) || new Set(ids).size !== ids.length) {
                    blockers.push("Такси: повторная или посторонняя связь источника");
                    continue;
                }
                ids.forEach(id => used.add(id));
                const check = compareCashMovements({ venueId: s.venueId, plans: [part], source, transactions: [t], complete: true })[0];
                if (check.state !== "matched" && !s.aliases.some(a => a.key === part.key && a.transactionIds[0] === t.id)) {
                    blockers.push(`Такси: ${check.problems.join("; ")}`);
                    continue;
                }
                add({ ...movementFields(part), description: `Такси · ${ids.map(id => "#" + id).join(", ")}`, mode: "link", transactionIds: [t.id] });
            }
            const remaining = taxi.sourceIds.filter(id => !used.has(id));
            if (remaining.length) {
                const part = { ...taxi, key: `${taxi.key}:part:${[...remaining].sort((a, b) => a - b).join("-")}`, sourceIds: remaining,
                    amountCents: remaining.reduce((sum, id) => sum + source.find(r => r.id === id)!.amountCents, 0) };
                const unmarked = ledger.some(t => !t.deleted && !targetIds(t).length && t.date === taxi.date && t.type === "expense" &&
                    t.bankAccountId === taxi.bankAccountId && t.categoryId === taxi.categoryId && (t.amountCents === taxi.amountCents || t.amountCents === part.amountCents));
                if (unmarked)
                    blockers.push("Такси: возможная операция без подтверждённой связи");
                add({ ...movementFields(part), description: `Такси · ${remaining.map(id => "#" + id).join(", ")}`, mode: "create", transactionIds: [] });
            }
        }
    }
    if (new Set(commands.map(c => c.key)).size !== commands.length)
        blockers.push("Повторный ключ финансового проведения");
    const keys = new Set(commands.map(c => c.key));
    for (const a of s.aliases)
        if (!keys.has(a.key)) {
            if (s.kind === "movements" && a.original.sourceIds.some(id => s.source.locations?.[String(id)] && s.source.locations[String(id)] !== s.date))
                blockers.push(`Изменилась дата кассового источника; требуется сверка: ${a.original.description}`);
            add({ ...a.original, mode: a.autoCancelled || a.baseline.every(t => t.deleted) ? "cancelled" : "cancel", transactionIds: a.transactionIds.filter((id): id is string => !!id) });
        }
    return { commands: commands.sort((a, b) => a.key.localeCompare(b.key)), blockers: [...new Set(blockers)].sort() };
}
