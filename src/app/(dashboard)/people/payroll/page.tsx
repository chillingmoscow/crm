import { redirect } from "next/navigation";

// Keep existing menu links and bookmarks on the current payroll interface.
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value ? [value] : [])
      query.append(key, item);
  }
  const suffix = query.toString();
  redirect(`/payroll-concept${suffix ? `?${suffix}` : ""}`);
}
