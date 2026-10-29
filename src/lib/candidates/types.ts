export const CANDIDATE_STAGES = {
  new: "Новая анкета",
  review: "Можно рассмотреть",
  interview: "Собеседование",
  trial: "Стажировка",
  rejected: "Не подходит",
} as const;
export const STATUSES = {
  ...CANDIDATE_STAGES,
  hired: "Принят на работу",
} as const;
export type CandidateStatus = keyof typeof STATUSES;
export const CANDIDATE_SORT_FIELDS = [
  "full_name",
  "desired_position",
  "status",
  "phone",
  "submitted_at",
  "age",
  "salary_expectation",
  "address",
  "experience",
  "education",
] as const;
export type CandidateSortField = (typeof CANDIDATE_SORT_FIELDS)[number];
export type CandidateSort = {
  field: CandidateSortField;
  direction: "asc" | "desc";
};
export type CandidatePage = {
  rows: Candidate[];
  total: number;
  page: number;
  pageSize: number;
};
export const STATUS_CLASSES: Record<CandidateStatus, string> = {
  new: "bg-muted text-muted-foreground",
  review: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  interview: "bg-brand/10 text-brand",
  trial: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  hired: "bg-brand/10 text-brand",
  rejected: "bg-destructive/10 text-destructive",
};
export type Candidate = {
  id: string;
  account_id: string;
  full_name: string;
  phone: string | null;
  phone_normalized: string;
  desired_position: string | null;
  age: number | null;
  address: string | null;
  social: Record<string, string>;
  education: string | null;
  experience: string | null;
  plans: string | null;
  family_status: string | null;
  drivers_license: string | null;
  salary_expectation: string | null;
  status: CandidateStatus;
  responsible_id: string | null;
  source: "manual" | "notion" | "tilda";
  source_id: string | null;
  source_url: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
  revision: number;
  hired_user_id: string | null;
  hired_venue_id: string | null;
  hired_role_id: string | null;
  hired_at: string | null;
  archived_at: string | null;
  photo_url?: string | null;
};
export type CandidateFile = {
  id: string;
  name: string;
  state: "pending" | "ready" | "missing" | "error" | "external";
  storage_path: string | null;
  mime_type: string | null;
  original_url: string | null;
  url?: string | null;
};
export type Appointment = {
  id: string;
  kind: "interview" | "trial";
  appointment_date: string;
  starts_at: string | null;
  timezone: string;
  location: string | null;
  interviewer_id: string | null;
  outcome: "scheduled" | "passed" | "no_show" | "rejected" | "canceled";
  notes: string | null;
  revision: number;
};
export type Comment = {
  id: string;
  author_id: string | null;
  source_author: string | null;
  body: string;
  created_at: string;
  author_name?: string;
};
export type CandidateEvent = {
  id: string;
  actor_id: string | null;
  kind: string;
  details: Record<string, unknown>;
  created_at: string;
  actor_name?: string;
};
export type HiringOptions = {
  positions: string[];
  active_venue_id: string | null;
  staff: { id: string; name: string; venue_id: string; role_id: string }[];
  venues: {
    id: string;
    name: string;
    timezone: string;
    can_hire: boolean;
    can_create_role: boolean;
  }[];
  roles: {
    id: string;
    name: string;
    venue_id: string;
    model_id: string | null;
    quickresto_role_id: number | null;
    rules: {
      valid_from: string;
      monthly_amount: number;
      rates: Record<
        string,
        Record<string, { base: number | null; percent: number | null }>
      >;
      config: Record<string, unknown>;
    }[];
  }[];
  members: { id: string; name: string }[];
};
export type CandidatePermissions = {
  manage: boolean;
  hire: boolean;
  owner: boolean;
  integrations: boolean;
};
export type CandidateDetail = {
  candidate: Candidate;
  comments: Comment[];
  events: CandidateEvent[];
  appointments: Appointment[];
  files: CandidateFile[];
  related: Pick<Candidate, "id" | "full_name" | "status" | "submitted_at">[];
  hire: {
    state: string;
    input: Record<string, unknown>;
    error?: string | null;
  } | null;
};
export type ListFilters = {
  search?: string;
  status?: string;
  position?: string;
  from?: string;
  to?: string;
  archive?: boolean;
  page?: number;
  pageSize?: number;
  sort?: CandidateSort[];
};
export type ConnectionView = {
  id: string;
  enabled: boolean;
  form_id: string;
  telegram_chat_id: string | null;
  telegram_configured: boolean;
  last_received_at: string | null;
  pending_jobs: number;
  failed_jobs: number;
} | null;
