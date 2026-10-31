"use server";
import { z } from "zod";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  type AutomationPerson,
  type UniformRecord,
} from "@/lib/automations/state";
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

/** Employee-bound data, without the venue-wide migration dashboard. */
export async function loadEmployeeDocuments(
  input: { userId: string } | { employeeId: string },
): Promise<
  import("@/lib/payroll/employee-documents").EmployeeDocumentsData | null
> {
  const s = await scope();
  const value = z
    .union([
      z.object({ userId: z.string().uuid() }).strict(),
      z.object({ employeeId: z.string().uuid() }).strict(),
    ])
    .parse(input);
  const employees = await s.db
    .from<
      {
        id: string;
        name: string;
        role_id: string | null;
        role_name: string;
        active: boolean;
        local_user_id: string | null;
      }[]
    >("payroll_employees")
    .select("id,name,role_id,role_name,active,local_user_id")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq(
      "userId" in value ? "local_user_id" : "id",
      "userId" in value ? value.userId : value.employeeId,
    )
    .limit(2);
  if (employees.error) throw new Error(employees.error.message);
  if (!employees.data?.length) return null;
  if (employees.data.length !== 1)
    throw new Error(
      "У сотрудника несколько расчётных карточек. Требуется сопоставление",
    );
  const employee = employees.data[0];
  const can = await getCachedPermissionChecker();
  const [person, uniform, settings, hr, bank, entries, archive, venue] =
    await Promise.all([
      s.db
        .from<AutomationPerson>("payroll_automation_people")
        .select("*")
        .eq("employee_id", employee.id)
        .eq("venue_id", s.venueId)
        .maybeSingle(),
      s.db
        .from<UniformRecord[]>("payroll_uniform_issues")
        .select(
          "id,title,installments,cancelled_at,expense_transaction_id,purchased_on,employee_id",
        )
        .eq("account_id", s.accountId)
        .eq("venue_id", s.venueId)
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(200),
      s.db
        .from<AutomationSettingsRecord>("payroll_automation_settings")
        .select("*")
        .eq("venue_id", s.venueId)
        .maybeSingle(),
      employee.local_user_id && can("people.view_staff")
        ? s.db
            .from<{
              medical_book_number: string | null;
              medical_book_date: string | null;
            }>("staff_account_details")
            .select("medical_book_number,medical_book_date")
            .eq("account_id", s.accountId)
            .eq("user_id", employee.local_user_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      can("finance.create_transaction") && can("finance.view_bank_accounts")
        ? s.db
            .from<{ id: string; name: string }[]>("bank_accounts")
            .select("id,name")
            .eq("account_id", s.accountId)
            .eq("is_active", true)
            .eq("currency", "RUB")
            .is("deleted_at", null)
            .or(`venue_id.is.null,venue_id.eq.${s.venueId}`)
            .order("name")
        : Promise.resolve({ data: [], error: null }),
      s.db
        .from<
          {
            amount: number;
            rule_snapshot: { rule?: string; sourceId?: string };
          }[]
        >("payroll_adjustments")
        .select("amount,rule_snapshot")
        .eq("venue_id", s.venueId)
        .eq("employee_id", employee.id)
        .eq("origin", "native_rule")
        .eq("rule_snapshot->>rule", "uniform")
        .eq("medium", "money")
        .eq("approved", true)
        .is("deleted_at", null)
        .limit(1000),
      s.db
        .from<
          {
            id: string;
            details: {
              uniform_source?: {
                purchased_on: string | null;
                amount: string | number | null;
                legacy_parts_created: boolean;
              } | null;
            };
          }[]
        >("payroll_events")
        .select("id,details")
        .eq("account_id", s.accountId)
        .eq("venue_id", s.venueId)
        .eq("employee_id", employee.id)
        .eq("action", "automation_source_imported")
        .order("created_at", { ascending: false })
        .limit(100),
      s.db
        .from<{ timezone: string }>("venues")
        .select("timezone")
        .eq("id", s.venueId)
        .single(),
    ]);
  for (const result of [
    person,
    uniform,
    settings,
    hr,
    bank,
    entries,
    archive,
    venue,
  ])
    if (result.error) throw new Error(result.error.message);
  if (
    (uniform.data?.length ?? 0) >= 200 ||
    (entries.data?.length ?? 0) >= 1000 ||
    (archive.data?.length ?? 0) >= 100
  )
    throw new Error(
      "История слишком велика для загрузки. Обратитесь к администратору",
    );
  return {
    venueId: s.venueId,
    timezone: venue.data?.timezone ?? "Europe/Moscow",
    canEditHr: can("people.edit_staff"),
    canPurchase:
      can("finance.create_transaction") && can("finance.view_bank_accounts"),
    employee,
    person: person.data,
    medicalNumber: hr.data?.medical_book_number ?? null,
    medicalUntil: hr.data?.medical_book_date ?? null,
    settingsVersion: settings.data?.version ?? 0,
    uniformSettings: (settings.data?.config ?? defaultAutomationSettings)
      .uniform,
    banks: bank.data ?? [],
    uniform: (uniform.data ?? []).map((i) => ({
      ...i,
      deducted: -(entries.data ?? [])
        .filter(
          (a) =>
            a.rule_snapshot?.rule === "uniform" &&
            a.rule_snapshot.sourceId === i.id,
        )
        .reduce((n, a) => n + Number(a.amount), 0),
    })),
    legacyUniform: [
      ...new Map(
        (archive.data ?? [])
          .filter((e) => e.details.uniform_source)
          .map((e) => [
            `${e.details.uniform_source!.purchased_on}:${e.details.uniform_source!.amount}`,
            { id: e.id, ...e.details.uniform_source! },
          ]),
      ).values(),
    ],
  };
}

export async function saveEmployeeMedical(input: {
  employeeId: string;
  version: number;
  medical: unknown;
  number: string | null;
  expectedNumber: string | null;
  expectedUntil: string | null;
}) {
  const s = await scope();
  const { employeeMedicalSchema } = await import(
    "@/lib/payroll/employee-documents"
  );
  const v = z
    .object({
      employeeId: z.string().uuid(),
      version: z.number().int().nonnegative(),
      medical: employeeMedicalSchema,
      number: z.string().max(100).nullable(),
      expectedNumber: z.string().nullable(),
      expectedUntil: z.string().refine(validDate).nullable(),
    })
    .strict()
    .parse(input);
  const r = await s.db.rpc("payroll_save_employee_medical", {
    p_employee: v.employeeId,
    p_version: v.version,
    p_medical: v.medical,
    p_number: v.number,
    p_expected_number: v.expectedNumber,
    p_expected_until: v.expectedUntil,
  });
  if (r.error) throw new Error(r.error.message);
}
