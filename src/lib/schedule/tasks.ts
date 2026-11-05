import { z } from "zod";
import { complete } from "./utils";
import type { Answer, ChecklistItem } from "./types";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Проверьте дату");
export const taskItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  hint: z.string().max(2000).default(""),
  kind: z.enum(["check", "photo", "number", "text", "info"]),
  required: z.boolean(),
  parent_id: z.string().uuid().nullable().default(null),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  unit: z.string().max(30).default(""),
  max_length: z.number().int().min(1).max(10000).default(2000),
});
export const taskDefinitionSchema = z
  .object({
    id: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
    request_key: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(160),
    instructions: z.string().max(50000),
    template_id: z.string().uuid(),
    review_mode: z.enum(["auto", "manager"]),
    items: z.array(taskItemSchema).min(1).max(150),
    recurrence: z.object({
      unit: z.enum(["week", "month"]),
      interval: z.number().int().min(1).max(52),
      anchor: calendarDate,
    }),
    starts_on: calendarDate,
    enabled: z.boolean(),
    penalty_enabled: z.boolean().default(true),
    fine_amount: z.number().min(0).max(100000).nullable(),
    reward_amount: z.number().min(0).max(100000).nullable(),
    predecessor_id: z.string().uuid().nullable().default(null),
    predecessor_offset: z.number().int().min(0).max(7).default(0),
    equipment_groups: z
      .array(z.array(z.number().int().min(1).max(999)).min(1))
      .max(12)
      .default([]),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.items.map((i) => i.id)).size !== s.items.length)
      ctx.addIssue({ code: "custom", message: "Пункты повторяются" });
    for (const i of s.items)
      if (i.min !== null && i.max !== null && i.min > i.max)
        ctx.addIssue({ code: "custom", message: "Минимум больше максимума" });
    if (s.predecessor_id && !s.predecessor_offset)
      ctx.addIssue({
        code: "custom",
        message: "Укажите интервал после предыдущей задачи",
      });
  });
export type TaskInput = z.infer<typeof taskDefinitionSchema>;
export type TaskDefinition = TaskInput & {
  id: string;
  venue_id: string;
  account_id: string;
  version: number;
  source_key: string | null;
  source_url?: string | null;
  created_at: string;
  updated_at: string;
};
export type TaskOccurrence = {
  id: string;
  venue_id: string;
  definition_id: string;
  business_date: string;
  shift_id: string | null;
  employee_id: string | null;
  user_id: string | null;
  employee_name: string | null;
  snapshot: TaskDefinition;
  answers: Record<string, Answer>;
  status:
    | "assigned"
    | "in_progress"
    | "submitted"
    | "returned"
    | "completed"
    | "missed"
    | "blocked";
  transferred: boolean;
  predecessor_occurrence_id: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  review_comment: string;
  blocker: string;
  version: number;
  adjustment_id: string | null;
  equipment: number[];
};
export type TaskSettings = {
  venue_id: string;
  enabled_from: string | null;
  legacy_stopped: boolean;
  chat_id: string | null;
  reminder_chat_ids: string[];
  version: number;
};
export type TaskMessage = {
  id: string;
  kind: string;
  business_date: string;
  chat_id: string;
  state: string;
  error: string | null;
};
export type TaskPreview = {
  definition_id: string;
  business_date: string;
  snapshot: TaskDefinition;
  assignment_count: number;
  employee: string | null;
};
export type TaskData = {
  definitions: TaskDefinition[];
  occurrences: TaskOccurrence[];
  settings: TaskSettings | null;
  messages: TaskMessage[];
  templates: { id: string; name: string }[];
  permissions: string[];
  userId: string;
  today: string;
  timezone: string;
};
export function missingItems(
  items: ChecklistItem[],
  answers: Record<string, Answer>,
) {
  return items
    .filter((i) => i.required && !complete(i, answers[i.id]))
    .map((i) => i.title);
}
export const taskStatus: Record<TaskOccurrence["status"], string> = {
  assigned: "Назначена",
  in_progress: "В работе",
  submitted: "На проверке",
  returned: "На доработке",
  completed: "Выполнена",
  missed: "Не выполнена",
  blocked: "Нужно назначение",
};
