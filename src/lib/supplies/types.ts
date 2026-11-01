import { z } from "zod";
import type { SupplyFact } from "./source";
export const supplyFiltersSchema = z
  .object({
    month: z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/),
    search: z.string().max(120),
    paid: z.enum(["", "paid", "unpaid", "draft", "review"]),
    provider: z.number().int().positive().nullable(),
    store: z.number().int().positive().nullable(),
    missing: z.boolean(),
    page: z.number().int().min(0).max(100000),
    size: z.union([z.literal(25), z.literal(50), z.literal(100)]),
    sort: z.enum(["date", "number", "provider", "amount", "paid"]),
    desc: z.boolean(),
  })
  .strict();
export type SupplyFilters = z.infer<typeof supplyFiltersSchema>;
export type SupplyRow = {
  id: string;
  revision: number;
  data: SupplyFact;
  missing: boolean;
  payment: SupplyPaymentSummary;
};
export type SupplyPaymentSummary = {
  state: "unlinked" | "partial" | "paid" | "review";
  allocatedCents: number;
  paidCents: number;
  remainingCents: number | null;
  sourceMismatch: boolean;
};
export type SupplyPayment = {
  id: string;
  transactionId: string | null;
  reference: string;
  publicId: number | null;
  amountCents: number;
  transactionCents: number | null;
  date: string | null;
  bank: string | null;
  description: string | null;
  cancelled: boolean;
  unavailable: boolean;
  canManage: boolean;
};
export type SupplyPaymentCandidate = {
  id: string;
  publicId: number;
  date: string;
  amountCents: number;
  availableCents: number;
  description: string | null;
  bank: string;
  counterparty: string | null;
};
export type SupplyPaymentCandidates = {
  total: number;
  rows: SupplyPaymentCandidate[];
};
export type SupplyHistory = {
  id: number;
  revision: number;
  action:
    | "created"
    | "updated"
    | "missing"
    | "returned"
    | "payment_linked"
    | "payment_updated"
    | "payment_unlinked"
    | "payment_changed";
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor_name: string;
  reason: string;
  created_at: string;
};
export type SupplyDetail = SupplyRow & {
  history: SupplyHistory[];
  payments: SupplyPayment[];
  canLink: boolean;
};
export type SupplyList = {
  venueId: string;
  rows: SupplyRow[];
  total: number;
  amountCents: number;
  paidCents: number;
  unpaidCents: number;
  reviewCount: number;
  providers: { id: number; name: string }[];
  stores: { id: number; name: string }[];
  canConfigure: boolean;
  configured: boolean;
  months: string[];
  timezone: string;
  checkedAt: string | null;
  sourceVersion: number | null;
  job: {
    state: string;
    phase: string;
    cursor: number;
    error: string | null;
  } | null;
};
export const supplyReadRulesSchema = z
  .object({
    autoRead: z.boolean(),
    intervalMinutes: z.number().int().min(15).max(1440),
    businessIds: z.array(z.number().int().positive()).min(1).max(100),
    businessNames: z.record(z.string().min(1).max(500)),
    provider: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type SupplyReadRules = z.infer<typeof supplyReadRulesSchema>;
export type SupplyConfiguration = {
  versions: {
    id: string;
    version: number;
    config: SupplyReadRules;
    actor_name: string;
    reason: string;
    created_at: string;
  }[];
  companies: { id: number; name: string }[];
  provider: string | null;
  sourceError: string | null;
};
export const supplyFieldNames: Record<string, string> = {
  version: "Версия Quick Resto",
  number: "Номер",
  invoiceAt: "Дата накладной",
  invoiceDate: "Дата накладной",
  providerId: "Поставщик",
  providerName: "Поставщик",
  storeId: "Склад",
  storeTitle: "Склад",
  processed: "Проведение",
  paid: "Оплата",
  amountCents: "Сумма",
  authorName: "Создал в Quick Resto",
  businessId: "Заведение",
  paidAt: "Время оплаты",
  paidDate: "Дата оплаты",
  accountId: "Счёт оплаты",
  accountTitle: "Счёт оплаты",
  issues: "Проверка данных",
  sourceMissing: "Нет в источнике",
};
