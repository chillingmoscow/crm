import type { Database, Json } from "@/types/database";

export type ItemKind = "check" | "photo" | "number" | "text" | "info";
export type ChecklistItem = {
  id: string;
  title: string;
  hint: string;
  kind: ItemKind;
  required: boolean;
  parent_id: string | null;
  min: number | null;
  max: number | null;
  unit: string;
  max_length: number;
};
export type Checklist = {
  id: string;
  venue_id: string;
  name: string;
  description: string;
  kind: string;
  department_id: string | null;
  duration: number;
  priority: string;
  items: ChecklistItem[];
  published: boolean;
  published_snapshot?: Checklist | null;
  archived: boolean;
  version: number;
  updated_at: string;
};
export type ShiftTemplate = {
  id: string;
  venue_id: string;
  name: string;
  color: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  arrival_minutes: number;
  department_id: string | null;
  role_id: string | null;
  checklist_ids: string[];
  archived: boolean;
  version: number;
  updated_at: string;
};
export type Shift = {
  id: string;
  venue_id: string;
  user_id: string | null;
  payroll_employee_id?: string | null;
  payroll_model_id?: string | null;
  payroll_fact_id?: number;
  role_id: string | null;
  department_id: string | null;
  template_id: string | null;
  title: string;
  color: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  arrival_minutes: number;
  note: string;
  checklist_snapshots: Record<string, Checklist>;
  checklist_ids: string[];
  published: boolean;
  version: number;
  updated_at: string;
};
export type Answer = boolean | string | number | null;
export type ChecklistRun = {
  id: string;
  venue_id: string;
  shift_id: string;
  checklist_id: string;
  user_id: string;
  snapshot: Checklist;
  answers: Record<string, Answer>;
  status: "in_progress" | "submitted" | "returned" | "approved";
  review_comment: string;
  review_notes: Record<string, string>;
  started_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  version: number;
  updated_at: string;
};
export type Qualification = {
  id: string;
  venue_id: string;
  user_id: string;
  role_id: string;
};
export type ScheduleEvent = {
  id: string;
  venue_id: string;
  entity_id: string;
  actor_id: string | null;
  action: string;
  details: Json;
  created_at: string;
};
type Table<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};
export type ScheduleDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      schedule_templates: Table<ShiftTemplate>;
      schedule_checklists: Table<Checklist>;
      schedule_shifts: Table<Shift>;
      schedule_runs: Table<ChecklistRun>;
      schedule_qualifications: Table<Qualification>;
      schedule_events: Table<ScheduleEvent>;
    };
    Functions: Database["public"]["Functions"] & {
      schedule_command: {
        Args: { p_action: string; p_input: Json };
        Returns: Json;
      };
    };
  };
};
export type ScheduleStaff = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  role_id: string;
  role_name: string;
  department_id: string | null;
};
export type ScheduleData = {
  venueId: string;
  timezone: string;
  userId: string;
  permissions: string[];
  shifts: Shift[];
  candidateTrials?: CandidateCalendarTrial[];
  templates: ShiftTemplate[];
  checklists: Checklist[];
  runs: ChecklistRun[];
  qualifications: Qualification[];
  staff: ScheduleStaff[];
  casualEmployees?: {
    id: string;
    name: string;
    role_id: string;
    role_name: string;
    model_id: string | null;
  }[];
  payModels?: { id: string; name: string; role_name: string }[];
  departments: { id: string; name: string }[];
  roles: { id: string; name: string; department_id: string | null }[];
};

// UI identity only; never pass this synthetic key as an authenticated user ID.
export const shiftAssignee = (s: Shift) =>
  s.payroll_employee_id ? `payroll:${s.payroll_employee_id}` : s.user_id;
export const assignmentFields = (id: string | null) => ({
  user_id: id?.startsWith("payroll:") ? null : id,
  payroll_employee_id: id?.startsWith("payroll:") ? id.slice(8) : null,
});

/** Recruiting appointments shown in the calendar; never employee shifts. */
export type CandidateCalendarTrial = {
  id: string;
  candidate_id: string;
  full_name: string;
  desired_position: string | null;
  hired_user_id: string | null;
  appointment_date: string;
  starts_at: string | null;
  timezone: string;
  location: string | null;
  outcome: "scheduled" | "passed";
};
