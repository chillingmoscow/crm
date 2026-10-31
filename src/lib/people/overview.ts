import { z } from "zod";
const count = z.number().int().nonnegative();
const date = z.string().date();
const base = {
  scope_id: z.string().uuid(),
  month: date,
  current_month: date,
  today: date,
  timezone: z.string(),
};
export const overviewInput = z.object({
  kind: z.enum(["staff", "candidates"]),
  scopeId: z.string().uuid(),
  month: date
    .regex(/^\d{4}-\d{2}-01$/)
    .nullable()
    .default(null),
});
export type OverviewKind = z.infer<typeof overviewInput>["kind"];
export const staffOverviewSchema = z.object({
  ...base,
  kind: z.literal("staff"),
  working: count,
  dated_staff: count,
  average_days: z.number().nonnegative().nullable(),
  tenure: z
    .array(
      z.object({
        id: z.enum(["under_month", "one_three", "three_twelve", "over_year"]),
        count,
      }),
    )
    .length(4),
});
export const candidateOverviewSchema = z.object({
  ...base,
  kind: z.literal("candidates"),
  received: count,
  new: count,
  hired: count,
  legacy_count: count,
  stages: z
    .array(
      z.object({
        id: z.enum(["new", "review", "interview", "trial", "rejected"]),
        count,
      }),
    )
    .length(5),
  arrivals: z
    .array(z.object({ from: date, to: date, count }))
    .min(1)
    .max(31),
  funnel: z
    .array(
      z.object({
        id: z.enum(["received", "review", "interview", "trial", "hired"]),
        count,
      }),
    )
    .length(5),
});
export const overviewSchema = z.discriminatedUnion("kind", [
  staffOverviewSchema,
  candidateOverviewSchema,
]);
export type StaffOverview = z.infer<typeof staffOverviewSchema>;
export type CandidateOverview = z.infer<typeof candidateOverviewSchema>;
export type PeopleOverviewData = z.infer<typeof overviewSchema>;
/** Fixed UTC formatting for date-only business values, independent of the viewer's device. */
export function overviewMonth(date: string, short = false) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: short ? "short" : "long",
    ...(short ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/ г\.$/, "");
}
export function overviewTenure(days: number | null) {
  if (days === null) return "—";
  if (days < 30.4375) return "< 1 мес.";
  return `${Math.floor(days / 30.4375)} мес.`;
}
export function chartCeiling(values: number[]) {
  const max = Math.max(1, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= max)!;
}
