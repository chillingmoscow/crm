import { z } from "zod";
export const uuid = z.string().uuid();
const text = z.string().trim().max(12000);
export const candidateInput = z.object({
  full_name: text.min(1).max(300),
  phone: z.string().trim().max(100).nullable().optional(),
  desired_position: text.max(300).nullable().optional(),
  age: z.number().int().min(14).max(100).nullable().optional(),
  address: text.nullable().optional(),
  social: z.record(z.string().max(2000)).optional(),
  education: text.nullable().optional(),
  experience: text.nullable().optional(),
  plans: text.nullable().optional(),
  family_status: text.max(300).nullable().optional(),
  drivers_license: text.max(100).nullable().optional(),
  salary_expectation: text.max(1000).nullable().optional(),
});
export const candidateUpdate = candidateInput.partial().extend({
  revision: z.number().int().positive(),
  status: z
    .enum([
      "new",
      "review",
      "interview",
      "trial",
      "rejected",
    ])
    .optional(),
});
export const hireInput = z.object({
  revision: z.number().int().positive(),
  venue_id: uuid,
  role_id: uuid,
  first_name: z.string().trim().min(1).max(150),
  last_name: z.string().trim().min(1).max(150),
  employment_date: z.string().date(),
  existing_user_id: uuid.nullable().optional(),
  attendance_source: z.enum(["quickresto", "schedule"]),
});
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits[0] === "8"
    ? "7" + digits.slice(1)
    : digits;
}
export function tildaCandidate(body: Record<string, unknown>) {
  const str = (key: string, max = 12000) =>
    String(body[key] ?? "")
      .trim()
      .slice(0, max);
  const photos = [str("photo", 4000), str("file", 4000)]
    .filter(Boolean)
    .flatMap((v) => {
      try {
        const a: unknown = JSON.parse(v);
        if (Array.isArray(a))
          return a.filter((x): x is string => typeof x === "string");
      } catch {}
      return v
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean);
    });
  const social: Record<string, string> = {};
  if (str("vk")) {
    const v = str("vk", 2000);
    social[/^(https?:\/\/)?(www\.)?vk\.com\//i.test(v) ? "vk" : "telegram"] = v;
  }
  if (str("instagram")) social.instagram = str("instagram", 2000);
  const age = Number(str("age"));
  const parsed = candidateInput.parse({
    full_name: str("name", 300) || str("Name", 300),
    phone: str("Phone", 100) || str("phone", 100) || null,
    desired_position: str("position", 300) || null,
    age: Number.isInteger(age) && age >= 14 && age <= 100 ? age : null,
    address: str("address") || null,
    social,
    education: str("education") || null,
    experience: str("experience") || null,
    plans: str("plans") || null,
    family_status: str("family", 300) || null,
    drivers_license: str("drivers_licence", 100) || null,
    salary_expectation: str("salary", 1000) || null,
  });
  return { ...parsed, photos: [...new Set(photos)].slice(0, 5) };
}
export function allowedPhotoURL(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      (u.hostname === "ucarecdn.com" ||
        u.hostname.endsWith(".ucarecdn.com") ||
        u.hostname.endsWith(".ucarecd.net") ||
        u.hostname === "prod-files-secure.s3.us-west-2.amazonaws.com")
    );
  } catch {
    return false;
  }
}
