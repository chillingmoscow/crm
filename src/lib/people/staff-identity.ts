import { z } from "zod";

/** Technical addresses belong to staff records without a personal CRM login. */
export function isStaffPlaceholderEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  return (
    email.endsWith("@import.local") ||
    /^payroll-(?:local-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@sheerly\.invalid$/.test(
      email,
    )
  );
}

export const staffProfileIdentitySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  email_confirmed: z.boolean(),
  needs_password_setup: z.boolean(),
  from_candidate: z.boolean(),
  created_at: z.string().nullable(),
});
