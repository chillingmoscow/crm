import { z } from "zod";
import {
  automationPersonSchema,
  type AutomationPerson,
} from "@/lib/automations/state";
export const employeeMedicalSchema = automationPersonSchema
  .innerType()
  .pick({
    medical_required: true,
    medical_state: true,
    examined_on: true,
    valid_until: true,
  })
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
