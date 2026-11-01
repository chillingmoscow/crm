/** Prepared, scoped legacy CRM import. QR data must be read and verified first.
 * Files contain personal data: keep them outside Git, with mode 0600.
 * Default prepares a manifest; --apply uses only a local Supabase connection.
 * Production cutover requires a separate reviewed execution plan. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
const args = process.argv.slice(2),
  apply = args.includes("--apply");
function option(k) {
  const i = args.indexOf(k);
  if (i < 0 || !args[i + 1]) throw Error(`Missing ${k}`);
  return args[i + 1];
}
const input = JSON.parse(await readFile(option("--glide"), "utf8")),
  snapshot = JSON.parse(await readFile(option("--snapshot"), "utf8")),
  seen = JSON.parse(await readFile(option("--seen"), "utf8")),
  manifestPath = option("--manifest");
const norm = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort();
const sameName = (a, b) => {
  const x = norm(a),
    y = norm(b);
  return (
    x.length >= 2 &&
    x.length <= 3 &&
    y.length >= 2 &&
    y.length <= 3 &&
    (x.every((t) => y.includes(t)) || y.every((t) => x.includes(t)))
  );
};
const phone = (v) => {
  const p = String(v ?? "").replace(/\D/g, "");
  if (p.length !== 10 && p.length !== 11) return null;
  const n = p.slice(-10);
  return /^(\d)\1+$/.test(n) ? null : n;
};
const sourceRows = input.rows.filter((r) => r[17]);
if (
  sourceRows.length === 0 ||
  new Set(sourceRows.map((r) => r[17])).size !== sourceRows.length
)
  throw Error("Missing or duplicate Glide IDs");
const tokens = (v) =>
  String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
let oldManifest = null;
try {
  oldManifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const rows = [],
  photos = [];
for (const r of sourceRows) {
  const name = [r[1], r[0]].filter(Boolean).join(" ").trim(),
    p = phone(r[5]);
  const matches = p
    ? snapshot.guests.filter(
        (g) =>
          phone(g.sourceData.contacts) === p &&
          sameName(name, g.sourceData.name),
      )
    : [];
  if (matches.length > 1) throw Error("Ambiguous guest link");
  const match = matches[0];
  const patch = {};
  if (!match) patch.name = name;
  if (r[5] && !match?.sourceData.contacts) patch.contacts = String(r[5]);
  if (r[2] && !match?.sourceData.day) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(r[2]) * 86400000);
    if (Number.isNaN(date.getTime())) throw Error("Invalid legacy birthday");
    Object.assign(patch, {
      day: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
    });
  }
  for (const [index, key] of [
    [3, "gender"],
    [6, "instagram"],
    [8, "sociability"],
    [10, "work"],
    [12, "alcohol"],
    [18, "mobility"],
  ])
    if (r[index]) patch[key] = String(r[index]);
  for (const [index, key] of [
    [9, "personality"],
    [11, "hobbies"],
    [13, "channels"],
    [16, "benefits"],
  ])
    if (r[index]) patch[key] = tokens(r[index]);
  if (typeof r[14] === "boolean") patch.recognized = r[14];
  if (typeof r[15] === "boolean") patch.regular = r[15];
  const previous = oldManifest?.rows.find((x) => x.legacyId === r[17]);
  if (r[4]) {
    const url = new URL(r[4]);
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com")
      throw Error("Unexpected legacy photo host");
    const path =
      previous?.patch.photoPath ??
      `${snapshot.accountId}/${snapshot.venueId}/${randomUUID()}.jpg`;
    patch.photoPath = path;
    photos.push({ url: url.href, path });
  }
  const legacyData = {
    spreadsheetId: input.spreadsheetId,
    sheet: input.sheet,
    fields: Object.fromEntries(
      input.headers.slice(0, 19).map((h, i) => [h, r[i] ?? null]),
    ),
  };
  if (r[7] && r[7] !== "A6xOw-AASB-KrC1H6.Bx5w")
    throw Error("Unverified legacy group mapping");
  const reason = r[7]
    ? "Перенос карточки из Glide. Прежние условия: Platinum, скидка 20%. Действующие группа и скидка — из Quick Resto."
    : "Перенос карточки из Glide с сохранением прежних сведений.";
  rows.push({
    legacyId: String(r[17]),
    qrId: match?.qrId ?? null,
    patch,
    legacyData,
    reason,
  });
}
const manifest = {
  accountId: snapshot.accountId,
  venueId: snapshot.venueId,
  actorId: snapshot.actorId,
  provider: snapshot.provider,
  rows,
  photos,
  seen: Array.isArray(seen) ? seen : seen.rows,
};
if (!Array.isArray(manifest.seen))
  throw Error("Missing verified n8n Silver baseline");
await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
console.log(
  JSON.stringify({
    prepared: rows.length,
    linked: rows.filter((r) => r.qrId).length,
    unlinked: rows.filter((r) => !r.qrId).length,
    photos: photos.length,
    silverBaseline: manifest.seen.length,
  }),
);
if (apply) {
  loadEnvFile(".env.local");
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(origin.hostname))
    throw Error("This script applies only to local Supabase");
  const db = createClient(origin.href, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  for (const photo of photos) {
    const existing = await db.storage
      .from("crm-guest-photos")
      .createSignedUrl(photo.path, 30);
    if (!existing.error) continue;
    let url = photo.url,
      response;
    for (let i = 0; i < 5; i++) {
      const u = new URL(url);
      if (u.protocol !== "https:" || u.hostname !== "storage.googleapis.com")
        throw Error("Unexpected photo redirect");
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      if (response.status >= 300 && response.status < 400) {
        url = new URL(response.headers.get("location"), url).href;
        continue;
      }
      break;
    }
    if (!response?.ok) throw Error("Legacy photo unavailable");
    if (Number(response.headers.get("content-length")) > 5242880)
      throw Error("Legacy photo too large");
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5242880) {
        await reader.cancel();
        throw Error("Legacy photo too large");
      }
      chunks.push(value);
    }
    const data = Buffer.concat(chunks);
    let type;
    if (data[0] === 255 && data[1] === 216 && data[2] === 255)
      type = "image/jpeg";
    else if (
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      type = "image/png";
    else if (
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP"
    )
      type = "image/webp";
    else throw Error("Legacy photo format unsupported");
    const result = await db.storage
      .from("crm-guest-photos")
      .upload(photo.path, data, { contentType: type, upsert: false });
    if (result.error) throw Error("Photo upload not confirmed");
  }
  const r = await db.rpc("crm_guest_import_legacy", {
    p_venue: manifest.venueId,
    p_provider: manifest.provider,
    p_actor: manifest.actorId,
    p_rows: rows,
    p_seen: manifest.seen,
  });
  if (r.error) throw Error(r.error.message);
  console.log(JSON.stringify({ applied: r.data }));
}
