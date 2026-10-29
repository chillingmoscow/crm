import type { Qualification } from "./types";

// A result replaces the previous result, including after its own expiry.
// Filtering by expiry before selecting the latest result could revive an old pass.
export function latestQualification(
  qualifications: readonly Qualification[],
  employeeId: string,
  date: string,
): Qualification | undefined {
  return qualifications
    .filter((q) => q.employee_id === employeeId && q.valid_from <= date)
    .sort(
      (a, b) =>
        b.valid_from.localeCompare(a.valid_from) ||
        (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
        b.id.localeCompare(a.id),
    )[0];
}

export function qualificationAtDate(
  qualifications: readonly Qualification[],
  employeeId: string,
  date: string,
): Qualification | undefined {
  const latest = latestQualification(qualifications, employeeId, date);
  return latest && (!latest.valid_until || latest.valid_until >= date)
    ? latest
    : undefined;
}
