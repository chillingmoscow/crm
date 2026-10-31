import { z } from "zod";
import {
  automationPersonSchema,
  type AutomationPerson,
} from "@/lib/automations/state";
export const employeeMedicalSchema = automationPersonSchema
  .innerType()
  .omit({ hired_on: true, birthday: true, gender: true, gift_role: true })
  .refine(
    (s) => !s.examined_on || !s.valid_until || s.examined_on <= s.valid_until,
    { message: "Срок действия раньше обследования" },
  );
export type EmployeeMedicalInput = z.infer<typeof employeeMedicalSchema>;
export type EmployeeDocumentsData = {
  venueId: string;
  timezone: string;
  canEditHr: boolean;
  canPurchase: boolean;
  employee: {
    id: string;
    name: string;
    role_id: string | null;
    role_name: string;
    active: boolean;
    local_user_id: string | null;
  };
  person: AutomationPerson | null;
  medicalNumber: string | null;
  medicalUntil: string | null;
  settingsVersion: number;
  uniformSettings: {
    enabled: boolean;
    installments: number;
    payment_days: number[];
  };
  banks: { id: string; name: string }[];
  uniform: {
    id: string;
    title: string;
    purchased_on: string | null;
    cancelled_at: string | null;
    expense_transaction_id: string | null;
    installments: { dueOn: string; amount: number }[];
    deducted: number;
  }[];
  legacyUniform: {
    id: string;
    purchased_on: string | null;
    amount: string | number | null;
    legacy_parts_created: boolean;
  }[];
};
export const medicalStateLabels = {
  unknown: "Нужно уточнить",
  missing: "Не предоставлена",
  present: "Предоставлена",
};
export const fineStateLabels = {
  unknown: "Нужно уточнить",
  recorded: "Учтён в зарплате",
  not_recorded: "Не начислялся",
  waived: "Отменён",
};
export const reimbursementLabels = {
  unknown: "Нужно уточнить",
  recorded: "Учтена в зарплате",
  not_recorded: "Не начислена",
};
