export type Rate = { base: number | null; percent: number | null };
export type Rates = Record<string, Record<string, Rate>>;
export type PayModel = {
  role_id?: string | null;
  is_role_default?: boolean;
  shift_pay?: boolean;
  extras_enabled?: boolean;
  id: string;
  name: string;
  role_name: string;
  basis: "turnover" | "hookah" | "bar" | "none";
  tips: boolean;
  experience: boolean;
  knowledge_amount: number;
  food_amount: number;
  cleaner_bonus: number;
  quickresto_role_id: number | null;
  monthly_amount: number;
  archived: boolean;
};
export type PayEmployee = {
  avatar_url?: string | null;
  id: string;
  account_id: string;
  venue_id: string;
  quickresto_id: number | null;
  name: string;
  local_user_id: string | null;
  role_id?: string | null;
  role_name: string;
  model_id: string | null;
  hired_on: string | null;
  experience_offset_months: number;
  casual?: boolean;
  attendance_source?: "quickresto" | "schedule" | "excluded";
  active: boolean;
  opening_balance: number;
  opening_confirmed: boolean;
};
export type PayRule = {
  id: string;
  model_id: string;
  employee_id: string | null;
  valid_from: string;
  rates: Rates;
  experience_steps: Record<string, number>;
  created_at: string;
  created_by?: string | null;
  change_reason?: string | null;
  monthly_amount: number | null;
  tenure_requires_exam: boolean;
  config: Partial<
    Pick<
      PayModel,
      | "shift_pay"
      | "extras_enabled"
      | "basis"
      | "tips"
      | "experience"
      | "knowledge_amount"
      | "food_amount"
      | "cleaner_bonus"
    >
  >;
};
export type AttendanceRule = {
 id:string;employee_id:string;source:"quickresto"|"schedule"|"excluded";valid_from:string;reason:string;created_by:string|null;created_at:string;
};
export type Attendance = {
  source?: "schedule" | "quickresto";
  id: string;
  business_date: string;
  external_id: number;
  employee_id: string | null;
  starts_at: string;
  ends_at: string | null;
  shift_id: string | null;
  role_name: string;
  status:
    | "confirmed"
    | "missing"
    | "deviation"
    | "unplanned"
    | "open"
    | "unlinked"
    | "ignored";
  issue: string | null;
  reviewed_by: string | null;
  review_reason: string | null;
  version: number;
};
export type Component = {
  kind: string;
  label: string;
  amount: number | null;
  basis: string;
  source: string;
};
export type Accrual = {
  id: string;
  employee_id: string;
  business_date: string;
  period_id: string;
  rule_version_id: string | null;
  components: Component[];
  salary: number;
  tips: number;
  status: "review" | "ready" | "approved";
  issues: string[];
  calculation_snapshot: Record<string, unknown>;
  updated_at: string;
};
export type PayPeriod = {
  id: string;
  month: string;
  status: "draft" | "checked" | "closed";
  version: number;
};
export type Adjustment = {
  medium?: "money" | "bonus" | "none";
  managed?: boolean;
  deleted_at?: string | null;
  created_at?: string;
  created_by?: string | null;
  origin?: string;
  external_state?: "not_required" | "pending" | "done" | "review";
  id: string;
  employee_id: string;
  business_date: string;
  kind: string;
  amount: number;
  reason: string;
  source_ref: string | null;
  approved: boolean;
};
export type Cashbox = {
  id: string;
  external_id: number;
  business_date: string;
  amount: number;
  occurred_at: string;
  comment: string;
  kkm_id: number;
  state: "review" | "ready" | "posted" | "ignored" | "cancelled";
  rounding: number;
  recognition: "exact" | "ambiguous";
  source_error: string | null;
};
export type Payment = {
  id: string;
  transaction_id: string | null;
  cashbox_id: string | null;
  kind: "salary" | "advance" | "tips";
  amount: number;
  state: "posted" | "cancelled";
  note: string;
  occurred_at: string;
  created_at: string;
};
export type Allocation = {
  employee_id: string;
  payment_id: string;
  accrual_id: string | null;
  month: string;
  amount: number;
  settled_amount: number;
};
export type PaySettings = {
  experience_starts_on?: string | null;
  experience_policy_version?: number;
  historical_through?: string | null;
  account_id: string;
  venue_id: string;
  starts_on: string;
  quickresto_venue_id: number;
  tip_tolerance: number;
  tip_comments: string[];
  cashbox_accounts: Record<string, string>;
  salary_category_id: string | null;
  tip_category_id: string | null;
  enabled: boolean;
  benefits_mode: "review" | "disabled" | "active";
};
export type SourceDay = {
  business_date: string;
  state: string;
  error: string | null;
  synced_at: string | null;
};
export type LegacyPayment = {
  id: string;
  employee_id: string;
  month: string;
  occurred_at: string;
  amount: number;
  kind: "salary" | "advance";
  source_bank: string;
  state: "review" | "posted" | "ignored";
  payment_id: string | null;
};
export type PayAssignment = {
  id: string;
  employee_id: string;
  model_id: string;
  valid_from: string;
};
export type ScheduleReview = {
  id: string;
  shift_id: string;
  business_date: string;
  employee_id: string | null;
  snapshot: { starts_at: string; ends_at: string; user_id: string | null };
  reason: string;
};
export type PayrollTransfer = {
  id: string;
  employee_id: string;
  from_month: string;
  to_month: string;
  amount: number;
  reason: string;
  state: "posted" | "cancelled";
  created_at: string;
};
export type PayrollData = {
  asOfDate?: string;
  experienceStartsOn?: string | null;
  attendanceRules?: AttendanceRule[];
  roles?: {id:string;name:string}[];
  transfers: PayrollTransfer[];
  venueId: string;
  timezone: string;
  dayStartHour: number;
  scheduleReviews: ScheduleReview[];
  userId: string;
  permissions: string[];
  settings: PaySettings | null;
  employees: PayEmployee[];
  models: PayModel[];
  rules: PayRule[];
  assignments: PayAssignment[];
  salaryLinks: {
    payment_id: string;
    accrual_id: string;
    employee_id: string;
    amount: number;
  }[];
  legacyPayments: LegacyPayment[];
  plannedShifts: import("@/lib/schedule/types").Shift[];
  attendance: Attendance[];
  accruals: Accrual[];
  periods: PayPeriod[];
  adjustments: Adjustment[];
  cashbox: Cashbox[];
  payments: Payment[];
  allocations: Allocation[];
  sources: SourceDay[];
  banks: { id: string; name: string; legal_entity_id: string }[];
  categories: { id: string; name: string }[];
  financeTransactions?: {
    id: string;
    date: string;
    amount: number;
    description: string | null;
    deleted_at: string | null;
    category_id: string | null;
    category_name: string;
  }[];
  staff: { user_id: string; name: string }[];
  events: {
    id: string;
    action: string;
    created_at: string;
    details: Record<string, unknown>;
  }[];
};
export const attendanceLabels: Record<Attendance["status"], string> = {
  confirmed: "Подтверждена",
  missing: "Нет отметки",
  deviation: "Отклонение",
  unplanned: "Без графика",
  open: "Не закрыта",
  unlinked: "Не связан сотрудник",
  ignored: "Не учитывать",
};
