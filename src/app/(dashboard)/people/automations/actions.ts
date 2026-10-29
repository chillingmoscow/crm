"use server";
import { z } from "zod";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  automationPersonSchema,
  type AutomationPerson,
  type UniformRecord,
} from "@/lib/automations/state";
import type {
  AutomationDecision,
  AutomationBlocker,
} from "@/lib/automations/payroll-rules";
import { runPayrollAutomation } from "@/lib/automations/run";
import {
  defaultAutomationSettings,
  type AutomationSettingsRecord,
} from "@/lib/payroll/automation-settings";
import { validDate } from "@/lib/sales/time";
async function scope() {
  const client = await createClient();
  const user = await client.auth.getUser();
  if (
    !user.data.user ||
    !(await getCachedPermissionChecker())("payroll.configure")
  )
    throw new Error("Нет доступа к автоматизациям зарплаты");
  const venue = await client.rpc("get_active_venue_id");
  const account = await getCachedActiveAccountId();
  if (venue.error || !venue.data || !account)
    throw new Error("Выберите заведение");
  return {
    db: asLooseDb(client),
    venueId: String(venue.data),
    accountId: account,
    userId: user.data.user.id,
  };
}
export type AutomationRun = {
  id: string;
  business_date: string;
  applied_count: number;
  mode: "comparison" | "native";
  created_at: string;
  decisions: AutomationDecision[];
  blockers: AutomationBlocker[];
  recorded_candidates: AutomationDecision[];
};
type UniformImportEvent = {
  id: string;
  employee_id: string;
  details: {
    uniform_source?: {
      legacy_employee_id: string;
      purchased_on: string | null;
      amount: number | null;
      legacy_parts_created: boolean;
    } | null;
  };
};
export async function loadAutomationWorkspace() {
  const s = await scope();
  const [employees, people, uniform, runs, settings, venue, jobs, imports] =
    await Promise.all([
      s.db
        .from<
          {
            id: string;
            name: string;
            role_name: string;
            active: boolean;
            hired_on: string | null;
            local_user_id: string | null;
            role_id: string | null;
          }[]
        >("payroll_employees")
        .select("id,name,role_name,active,hired_on,local_user_id,role_id")
        .eq("account_id", s.accountId)
        .eq("venue_id", s.venueId)
        .order("name")
        .limit(1000),
      s.db
        .from<AutomationPerson[]>("payroll_automation_people")
        .select("*")
        .eq("venue_id", s.venueId)
        .limit(1000),
      s.db
        .from<UniformRecord[]>("payroll_uniform_issues")
        .select("*")
        .eq("venue_id", s.venueId)
        .order("created_at", { ascending: false })
        .limit(200),
      s.db
        .from<AutomationRun[]>("payroll_automation_runs")
        .select(
          "id,business_date,mode,applied_count,created_at,decisions,blockers,recorded_candidates",
        )
        .eq("venue_id", s.venueId)
        .order("created_at", { ascending: false })
        .limit(30),
      s.db
        .from<AutomationSettingsRecord>("payroll_automation_settings")
        .select("*")
        .eq("venue_id", s.venueId)
        .maybeSingle(),
      s.db
        .from<{ timezone: string }>("venues")
        .select("timezone")
        .eq("id", s.venueId)
        .single(),
      s.db
        .from<
          {
            id: string;
            business_date: string;
            state: string;
            last_error: string | null;
            next_retry_at: string;
          }[]
        >("payroll_automation_jobs")
        .select("id,business_date,state,last_error,next_retry_at")
        .eq("venue_id", s.venueId)
        .in("state", ["error", "review"])
        .order("created_at", { ascending: false })
        .limit(10),
      s.db
        .from<UniformImportEvent[]>("payroll_events")
        .select("id,employee_id,details")
        .eq("account_id", s.accountId)
        .eq("venue_id", s.venueId)
        .eq("action", "automation_source_imported")
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
  for (const r of [
    employees,
    people,
    uniform,
    runs,
    settings,
    venue,
    jobs,
    imports,
  ])
    if (r.error) throw new Error(r.error.message);
  const roleRows = await s.db
    .from<{ id: string; name: string }[]>("roles")
    .select("id,name")
    .eq("venue_id", s.venueId);
  if (roleRows.error) throw new Error(roleRows.error.message);
  const can = await getCachedPermissionChecker();
  const canPurchase =
    can("finance.create_transaction") && can("finance.view_bank_accounts");
  const bankAccounts = canPurchase
    ? await s.db
        .from<{ id: string; name: string }[]>("bank_accounts")
        .select("id,name")
        .eq("account_id", s.accountId)
        .eq("is_active", true)
        .eq("currency", "RUB")
        .is("deleted_at", null)
        .or(`venue_id.is.null,venue_id.eq.${s.venueId}`)
        .order("name")
    : { data: [], error: null };
  if (bankAccounts.error) throw new Error(bankAccounts.error.message);
  const userIds = (employees.data ?? []).flatMap((e) =>
    e.local_user_id ? [e.local_user_id] : [],
  );
  const details =
    can("people.edit_staff") && userIds.length
      ? await s.db
          .from<
            {
              user_id: string;
              employment_date: string | null;
              medical_book_date: string | null;
            }[]
          >("staff_account_details")
          .select("user_id,employment_date,medical_book_date")
          .eq("account_id", s.accountId)
          .in("user_id", userIds)
      : { data: [], error: null };
  if (details.error) throw new Error(details.error.message);
  return {
    canPurchase,
    bankAccounts: bankAccounts.data ?? [],
    settingsVersion: settings.data?.version ?? 0,
    legacyUniform: [
      ...new Map(
        [...(imports.data ?? [])]
          .reverse()
          .filter((e) => e.details.uniform_source)
          .map((e) => [
            e.details.uniform_source!.legacy_employee_id,
            {
              id: e.id,
              employee_id: e.employee_id,
              ...e.details.uniform_source!,
            },
          ]),
      ).values(),
    ],
    failedJobs: jobs.data ?? [],
    canReview: can("payroll.review"),
    staffDetails: details.data ?? [],
    venueId: s.venueId,
    timezone: venue.data?.timezone ?? "Europe/Moscow",
    employees: (employees.data ?? []).map((e) => ({
      ...e,
      role_name:
        roleRows.data?.find((r) => r.id === e.role_id)?.name ?? e.role_name,
    })),
    people: people.data ?? [],
    uniform: uniform.data ?? [],
    runs: runs.data ?? [],
    settings: settings.data?.config ?? defaultAutomationSettings,
    settingsSaved: !!settings.data,
  };
}
export async function saveAutomationPerson(
  employeeId: string,
  version: number,
  input: unknown,
) {
  const s = await scope();
  z.string().uuid().parse(employeeId);
  z.number().int().nonnegative().parse(version);
  const value = automationPersonSchema.parse(input);
  const r = await s.db.rpc("payroll_save_automation_person", {
    p_employee: employeeId,
    p_version: version,
    p_input: value,
  });
  if (r.error) throw new Error(r.error.message);
}
export async function addUniform(input: {
  employeeId: string;
  title: string;
  amount: number;
  installments: { dueOn: string; amount: number }[];
  purchasedOn: string;
  bankAccountId: string;
  roleId: string;
  settingsVersion: number;
  requestId: string;
}) {
  const s = await scope();
  const value = z
    .object({
      employeeId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      amount: z.number().positive().max(1e6),
      installments: z
        .array(
          z
            .object({
              dueOn: z.string().refine(validDate),
              amount: z.number().positive().max(1e6),
            })
            .strict(),
        )
        .min(1)
        .max(24),
      purchasedOn: z.string().refine(validDate),
      bankAccountId: z.string().uuid(),
      roleId: z.string().uuid(),
      settingsVersion: z.number().int().positive(),
      requestId: z.string().uuid(),
    })
    .parse(input);
  const r = await s.db.rpc("payroll_purchase_uniform", {
    p_input: {
      request_id: value.requestId,
      employee_id: value.employeeId,
      role_id: value.roleId,
      title: value.title,
      amount: value.amount,
      installments: value.installments,
      bank_account_id: value.bankAccountId,
      purchased_on: value.purchasedOn,
      settings_version: value.settingsVersion,
    },
  });
  if (r.error) throw new Error(r.error.message);
}
export async function calculateAutomations(
  date: string,
  mode: "comparison" | "native",
  previewId?: string,
) {
  const s = await scope();
  z.string().refine(validDate).parse(date);
  z.enum(["comparison", "native"]).parse(mode);
  if (
    mode === "native" &&
    !(await getCachedPermissionChecker())("payroll.review")
  )
    throw new Error("Нет доступа к учёту начислений");
  if (previewId) z.string().uuid().parse(previewId);
  return runPayrollAutomation(s.venueId, date, mode, s.userId, previewId);
}

export async function cancelUniform(issueId: string, reason: string) {
  const s = await scope();
  z.string().uuid().parse(issueId);
  z.string().trim().min(3).max(1000).parse(reason);
  const r = await s.db.rpc("payroll_cancel_uniform_issue", {
    p_issue: issueId,
    p_reason: reason,
  });
  if (r.error) throw new Error(r.error.message);
}
