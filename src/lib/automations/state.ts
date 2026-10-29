import { z } from "zod";
import { validDate } from "@/lib/sales/time";
import type {
  AutomationEmployee,
  AutomationDecision,
  UniformIssue,
} from "./payroll-rules";
import { planPayrollAutomations } from "./payroll-rules";
import {
  automationSettingsSchema,
  type AutomationSettingsRecord,
} from "@/lib/payroll/automation-settings";
const date = z.string().refine(validDate, "Проверьте дату").nullable();
export const automationPersonSchema = z
  .object({
    legacy_reconciled: z.boolean(),
    missing_fine_state: z.enum(["unknown", "recorded", "not_recorded"]),
    expiry_fine_state: z.enum(["unknown", "recorded", "not_recorded"]),
    hired_on: date,
    birthday: date,
    gender: z.enum(["male", "female"]).nullable(),
    gift_role: z.string().trim().min(1).max(100).nullable(),
    medical_required: z.boolean().nullable(),
    medical_state: z.enum(["unknown", "missing", "present"]),
    examined_on: date,
    valid_until: date,
    reimbursement_state: z.enum(["unknown", "recorded", "not_recorded"]),
    new_medical_case: z.boolean(),
  })
  .strict()
  .refine(
    (s) => !s.examined_on || !s.valid_until || s.examined_on <= s.valid_until,
    { message: "Срок действия раньше обследования" },
  );
export type AutomationPersonInput = z.infer<typeof automationPersonSchema>;
export type AutomationPerson = Omit<
  AutomationPersonInput,
  "new_medical_case"
> & {
  employee_id: string;
  employment_id: string;
  medical_case_id: string | null;
  version: number;
};
export type UniformRecord = {
  id: string;
  employee_id: string;
  title: string;
  installments: UniformIssue["installments"];
  cancelled_at: string | null;
};
export type AutomationSnapshot = {
  account_id: string;
  venue_id: string;
  timezone: string;
  settings: AutomationSettingsRecord | null;
  employees: {
    id: string;
    name: string;
    role_name: string;
    active: boolean;
    subject: AutomationPerson | null;
  }[];
  uniform: UniformRecord[];
  recorded: { key: string; decision: AutomationDecision }[];
};
export function planFromSnapshot(
  snapshot: AutomationSnapshot,
  businessDate: string,
) {
  if (!snapshot.settings?.version)
    throw new Error("Сначала сохраните настройки автоматизаций в заведении");
  const employees: AutomationEmployee[] = snapshot.employees.map((e) => {
    const s = e.subject;
    return {
      id: e.id,
      active: e.active,
      employmentId: s?.employment_id ?? null,
      hiredOn: s?.hired_on ?? null,
      birthday: s?.birthday ?? null,
      gender: s?.gender ?? null,
      giftRole: s?.gift_role ?? null,
      medicalRequired: s?.medical_required ?? null,
      ...(s?.medical_state === "missing"
        ? { medicalCase: null }
        : s?.medical_state === "present" && s.medical_case_id
          ? {
              medicalCase: {
                id: s.medical_case_id,
                examinedOn: s.examined_on,
                validUntil: s.valid_until,
                reimbursementRecorded:
                  s.reimbursement_state === "unknown"
                    ? null
                    : s.reimbursement_state === "recorded",
              },
            }
          : {}),
    };
  });
  const result = planPayrollAutomations({
    venueId: snapshot.venue_id,
    businessDate,
    ruleVersion: snapshot.settings.version,
    config: automationSettingsSchema.parse(snapshot.settings.config),
    employees,
    uniformIssues: snapshot.uniform.map((i) => ({
      id: i.id,
      employeeId: i.employee_id,
      installments: i.installments,
    })),
    tasks: [],
    recordedKeys: snapshot.recorded.map((r) => r.key),
  });
  for (const d of result.decisions) {
    if (
      d.medium === "money" &&
      d.rule.startsWith("medical_") &&
      !snapshot.employees.find((e) => e.id === d.employeeId)?.subject
        ?.legacy_reconciled
    )
      result.blockers.push({
        employeeId: d.employeeId,
        sourceId: d.sourceId,
        code: "legacy_medical_unreconciled",
        message:
          "Сначала сверьте прежние штрафы и компенсации медкнижки с Glide",
      });
  }
  result.decisions = result.decisions.filter((d) => {
    if (d.rule !== "medical_missing" && d.rule !== "medical_expired")
      return true;
    const s = snapshot.employees.find((e) => e.id === d.employeeId)?.subject;
    const previous =
      d.rule === "medical_missing"
        ? s?.missing_fine_state
        : s?.expiry_fine_state;
    if (previous === "recorded") {
      result.recordedCandidates.push(d);
      return false;
    }
    if (previous !== "not_recorded")
      result.blockers.push({
        employeeId: d.employeeId,
        sourceId: d.sourceId,
        code: "legacy_fine_unreconciled",
        message: "Не проверен прежний штраф за этот случай медкнижки",
      });
    return true;
  });
  // A correction stays visible even when the key is already consumed. No automatic reversal.
  for (const candidate of result.recordedCandidates) {
    const previous = snapshot.recorded.find(
      (r) => r.key === candidate.key,
    )?.decision;
    if (!previous) continue;
    if (
      previous.amount !== candidate.amount ||
      previous.kind !== candidate.kind ||
      previous.medium !== candidate.medium
    )
      result.blockers.push({
        employeeId: candidate.employeeId,
        sourceId: candidate.sourceId,
        code: "recorded_effect_changed",
        message:
          "Уже учтённое событие изменилось: требуется сверка исходной операции",
      });
  }
  return result;
}
