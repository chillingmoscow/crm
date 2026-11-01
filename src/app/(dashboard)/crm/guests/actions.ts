"use server";
import { z } from "zod";
import { createClient, getCachedActiveAccountId } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  guestDataSchema,
  guestRulesSchema,
  type Guest,
  type GuestDetail,
  type GuestList,
  type GuestFilters,
  type GuestConfiguration,
} from "@/lib/guests/types";
function readValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw Error("Проверьте заполнение полей карточки и настроек гостей");
  return result.data;
}
async function scope(expected?: string) {
  const client = await createClient(),
    db = asLooseDb(client),
    account = await getCachedActiveAccountId();
  const {
    data: { user },
  } = await client.auth.getUser();
  const venue = await db.rpc("get_active_venue_id");
  if (!user || !account || venue.error || !venue.data)
    throw Error("Нет доступа к гостям");
  if (expected && readValue(z.string().uuid(), expected) !== venue.data)
    throw Error("Заведение изменилось. Обновите страницу");
  return { client, db, account, venueId: String(venue.data) };
}
async function photo<T extends Guest>(
  s: Awaited<ReturnType<typeof scope>>,
  g: T,
): Promise<T> {
  const path = g.data.photoPath;
  if (!path || !path.startsWith(`${s.account}/${s.venueId}/`))
    return { ...g, photoUrl: null };
  const r = await s.client.storage
    .from("crm-guest-photos")
    .createSignedUrl(path, 300);
  return { ...g, photoUrl: r.error ? null : r.data.signedUrl };
}
export async function loadGuests(
  filters: GuestFilters,
  expectedVenue?: string,
): Promise<GuestList> {
  const s = await scope(expectedVenue);
  const f = readValue(
    z
      .object({
        search: z.string().max(120),
        group: z.string().max(500),
        birthday: z.enum(["", "today", "upcoming"]),
        archived: z.boolean(),
        page: z.number().int().min(0).max(100000),
        size: z.union([z.literal(25), z.literal(50), z.literal(100)]),
        sort: z.enum(["name", "group", "birthday", "updated"]),
        desc: z.boolean(),
      })
      .strict(),
    filters,
  );
  const r = await s.db.rpc("crm_guest_list", {
    p_venue: s.venueId,
    p_search: f.search,
    p_group: f.group,
    p_birthday: f.birthday,
    p_archived: f.archived,
    p_page: f.page,
    p_size: f.size,
    p_sort: f.sort,
    p_desc: f.desc,
  });
  if (r.error) throw Error(r.error.message);
  const data = r.data as GuestList;
  return {
    ...data,
    rows: await Promise.all(data.rows.map((g) => photo(s, g))),
  };
}
export async function loadGuest(
  venue: string,
  id: string,
  before?: number,
): Promise<GuestDetail> {
  const s = await scope(venue),
    r = await s.db.rpc("crm_guest_detail", {
      p_venue: s.venueId,
      p_id: readValue(z.string().uuid(), id),
      p_before: before ?? null,
    });
  if (r.error) throw Error(r.error.message);
  return photo(s, r.data as GuestDetail);
}
export async function saveGuest(input: {
  venue: string;
  action: "create" | "update" | "archive" | "restore";
  id: string | null;
  revision: number;
  request: string;
  patch: unknown;
  reason: string;
}): Promise<{
  id: string;
  revision: number;
}> {
  const s = await scope(input.venue);
  const patch =
    input.action === "create"
      ? readValue(guestDataSchema, input.patch)
      : readValue(guestDataSchema.partial(), input.patch);
  const r = await s.db.rpc("crm_guest_command", {
    p_venue: s.venueId,
    p_action: readValue(
      z.enum(["create", "update", "archive", "restore"]),
      input.action,
    ),
    p_id: input.id === null ? null : readValue(z.string().uuid(), input.id),
    p_revision: readValue(z.number().int().min(0), input.revision),
    p_request: readValue(z.string().uuid(), input.request),
    p_patch: patch,
    p_reason: readValue(z.string().trim().min(1).max(1000), input.reason),
  });
  if (r.error) throw Error(r.error.message);
  return r.data as {
    id: string;
    revision: number;
  };
}
export async function guestConfiguration(
  venue: string,
): Promise<GuestConfiguration> {
  const s = await scope(venue),
    r = await s.db.rpc("crm_guest_configuration", { p_venue: s.venueId });
  if (r.error) throw Error(r.error.message);
  return r.data as GuestConfiguration;
}
export async function saveGuestRules(
  venue: string,
  version: number,
  config: unknown,
  reason: string,
) {
  const s = await scope(venue),
    r = await s.db.rpc("crm_guest_save_rules", {
      p_venue: s.venueId,
      p_version: readValue(z.number().int().min(0), version),
      p_config: readValue(guestRulesSchema, config),
      p_reason: readValue(z.string().trim().min(1).max(1000), reason),
    });
  if (r.error) throw Error(r.error.message);
}
export async function readGuests(venue: string) {
  const s = await scope(venue),
    r = await s.db.rpc("crm_guest_request", { p_venue: s.venueId });
  if (r.error) throw Error(r.error.message);
  return String(r.data);
}
export async function uploadGuestPhoto(venue: string, form: FormData) {
  const s = await scope(venue);
  const access = await s.db.rpc("crm_guest_list", { p_venue: s.venueId });
  if (access.error || !(access.data as GuestList)?.canManage)
    throw Error("Нет доступа к изменению гостей");
  const f = form.get("photo");
  if (!(f instanceof File) || f.size === 0 || f.size > 5242880)
    throw Error("Выберите фотографию до 5 МБ");
  const b = new Uint8Array(await f.arrayBuffer());
  let ext: string, type: string;
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) {
    ext = "jpg";
    type = "image/jpeg";
  } else if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) {
    ext = "png";
    type = "image/png";
  } else if (
    b.length >= 12 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  ) {
    ext = "webp";
    type = "image/webp";
  } else throw Error("Поддерживаются фотографии JPEG, PNG и WebP");
  const path = `${s.account}/${s.venueId}/${crypto.randomUUID()}.${ext}`,
    r = await s.client.storage
      .from("crm-guest-photos")
      .upload(path, b, { contentType: type, upsert: false });
  if (r.error) throw Error("Не удалось загрузить фотографию");
  const signed = await s.client.storage
    .from("crm-guest-photos")
    .createSignedUrl(path, 300);
  return { path, url: signed.data?.signedUrl ?? null };
}
