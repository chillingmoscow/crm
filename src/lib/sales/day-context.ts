import { effectiveMetrics, type SalesDay } from "./types";
import type { AdditionalKind } from "./additional";
import type { Accrual, PayEmployee, Component } from "@/lib/payroll/types";
export type DayReference = Pick<
  SalesDay,
  | "id"
  | "venue_id"
  | "business_date"
  | "calculated"
  | "overrides"
  | "status"
  | "updated_at"
>;
export type DayArchive = {
  id: string;
  venue_id: string;
  business_date: string;
  legacy_ref: string;
  metrics: Record<string, number | null>;
  captured_at: string;
  imported_at: string;
  origin: { spreadsheet_id: string; range: string };
};
export type DayContextValue = {
  turnover: number | null;
  dayId?: string;
  archiveId?: string;
  updatedAt?: string;
  source: "native" | "archive";
};
export type DayMember = {
  id: string;
  employeeId?: string;
  name: string;
  position: string | null;
  role: string | null;
  avatarUrl?: string | null;
  salary: number | null;
  tips: number | null;
  extras: number | null;
  issues: string[];
  components: Component[];
  origin?: { spreadsheet_id: string; range: string };
};
export type DayTeam = {
  allowed: boolean;
  source: "native" | "archive";
  members: DayMember[];
  capturedAt?: string;
};
export const finiteAmount = (value: unknown): number | null =>
  value == null || value === "" || !Number.isFinite(Number(value))
    ? null
    : Number(value);
export function latestDayArchive(
  rows: DayArchive[],
  venueId: string,
  date: string,
  legacyRef?: string | null,
) {
  return (
    rows
      .filter(
        (r) =>
          r.venue_id === venueId &&
          r.business_date === date &&
          (!legacyRef || r.legacy_ref === legacyRef),
      )
      .sort(
        (a, b) =>
          b.captured_at.localeCompare(a.captured_at) ||
          b.id.localeCompare(a.id),
      )[0] ?? null
  );
}
export function dayContext(
  venueId: string,
  date: string,
  source: "native" | "archive",
  days: DayReference[],
  archives: DayArchive[],
  legacyRef?: string | null,
): DayContextValue {
  if (source === "archive") {
    // A department archive has an explicit Shifts Row ID; don't silently join a different row by date.
    const a = legacyRef
      ? latestDayArchive(archives, venueId, date, legacyRef)
      : null;
    return {
      source,
      turnover: a ? finiteAmount(a.metrics.turnover) : null,
      archiveId: a?.id,
      updatedAt: a?.captured_at,
    };
  }
  const d = days.find(
    (r) => r.venue_id === venueId && r.business_date === date,
  );
  return {
    source,
    turnover:
      d && d.status === "complete"
        ? finiteAmount(effectiveMetrics(d).turnover)
        : null,
    dayId: d?.id,
    updatedAt: d?.updated_at,
  };
}
export function departmentMember(m: DayMember, kind: AdditionalKind) {
  return m.role === (kind === "bar" ? "Бармен" : "Мастер");
}
export function nativeDayMembers(
  accruals: Accrual[],
  employees: PayEmployee[],
  photos: Record<string, string | null> = {},
): DayMember[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  return accruals
    .filter((a) => a.calculation_snapshot.kind !== "monthly")
    .map((a) => {
      const e = byId.get(a.employee_id),
        s = a.calculation_snapshot,
        model = s.model as Record<string, unknown> | null;
      const role =
        typeof s.role === "string"
          ? s.role
          : typeof model?.role_name === "string"
            ? model.role_name
            : null;
      const position =
        typeof s.position_name === "string"
          ? s.position_name
          : typeof model?.name === "string"
            ? model.name
            : role;
      const parts = a.components.filter((c) => c.kind === "extra");
      const extras = parts.length
        ? parts.every((c) => c.amount !== null)
          ? parts.reduce((sum, c) => sum + Number(c.amount), 0)
          : null
        : model?.extras_enabled === false
          ? 0
          : null;
      return {
        id: a.id,
        employeeId: e?.id,
        name: e?.name ?? "Сотрудник из расчёта",
        position,
        role,
        avatarUrl: (e?.local_user_id ? photos[e.local_user_id] : null)??e?.avatar_url??null,
        salary: finiteAmount(a.salary),
        tips: finiteAmount(a.tips),
        extras,
        issues: a.issues,
        components: a.components,
      };
    });
}
export function memberTotal(
  members: DayMember[],
  key: "salary" | "tips" | "extras",
) {
  return members.length && members.every((m) => m[key] !== null)
    ? Math.round(members.reduce((s, m) => s + m[key]!, 0) * 100) / 100
    : null;
}
export type DayComment = {
  id: string;
  business_date: string;
  author_id: string | null;
  author_name: string;
  body: string;
  origin: "native" | "glide";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  source_snapshot?: {
    spreadsheet_id?: string;
    range?: string;
    source_wall_time?: string;
    source_timezone?: string;
  };
};
export type CommentEvent = {
  id: string;
  comment_id: string;
  actor_name: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};
export type DayDiscussion = {
  venueId: string;
  currentUserId: string;
  moderator: boolean;
  timezone: string;
  comments: DayComment[];
  history: CommentEvent[];
};
