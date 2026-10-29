import "server-only";
import {
  createClient,
  getCachedUser,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import type {
  Candidate,
  CandidateDetail,
  CandidateFile,
  CandidatePermissions,
  Comment,
  Appointment,
  CandidateEvent,
  HiringOptions,
  ListFilters,
  CandidatePage,
  CandidateBoardData,
  CandidateStage,
} from "./types";
import { CANDIDATE_STAGE_KEYS, BOARD_PAGE_SIZE } from "./types";
import { uuid, normalizePhone } from "./schema";
export async function candidateScope(manage = false) {
  const [user, accountId, can, client] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
    createClient(),
  ]);
  if (!user || !accountId) throw new Error("Войдите в аккаунт");
  if (
    manage
      ? !can("people.manage_candidates")
      : ![
          "people.view_candidates",
          "people.manage_candidates",
          "people.hire_candidates",
        ].some(can)
  )
    throw new Error("Нет доступа к кандидатам");
  const owner = await client
    .from("accounts")
    .select("owner_id")
    .eq("id", accountId)
    .maybeSingle();
  const permissions: CandidatePermissions = {
    manage: can("people.manage_candidates"),
    hire: can("people.hire_candidates"),
    owner: owner.data?.owner_id === user.id,
    integrations: can("settings.manage_integrations"),
  };
  return {
    user,
    accountId,
    client,
    db: asLooseDb(client),
    admin: asLooseDb(createAdminClient()),
    permissions,
  };
}
function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
export async function candidateOptions(): Promise<HiringOptions> {
  const s = await candidateScope();
  return check(await s.db.rpc("candidate_hiring_options", {})) as HiringOptions;
}
type CandidateScope = Awaited<ReturnType<typeof candidateScope>>;
function candidateQuery(s: CandidateScope, filters: ListFilters) {
  let query = s.db
    .from<Candidate[]>("candidates")
    .select("*", { count: "exact" })
    .eq("account_id", s.accountId)
    .neq("status", "hired");
  if (filters.view === "board")
    query = query.order("stage_changed_at", {
      ascending: false,
      nullsFirst: false,
    });
  query = query
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false });
  query = filters.archive
    ? query.or("archived_at.not.is.null")
    : query.is("archived_at", null);
  const search = (filters.search ?? "")
    .replace(/[,()%_*\\]/g, " ")
    .trim()
    .slice(0, 100);
  if (search)
    query = query.or(
      `full_name.ilike.%${search}%,phone.ilike.%${search}%,desired_position.ilike.%${search}%${normalizePhone(search).length >= 3 ? ",phone_normalized.ilike.%" + normalizePhone(search) + "%" : ""}`,
    );
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.position) query = query.eq("desired_position", filters.position);
  // Business dates are interpreted in the account's recruiting timezone (Moscow for the initial Tilda form).
  if (filters.from || filters.to) {
    const from = filters.from ? `${filters.from}T00:00:00+03:00` : null;
    const to = filters.to ? `${filters.to}T23:59:59.999+03:00` : null;
    query = query.or(
      [
        from ? `submitted_at.gte.${from}` : null,
        to ? `submitted_at.lte.${to}` : null,
      ].filter(Boolean).length === 2
        ? `and(submitted_at.gte.${from},submitted_at.lte.${to})`
        : from
          ? `submitted_at.gte.${from}`
          : `submitted_at.lte.${to}`,
    );
  }
  return query;
}
async function candidatePage(
  s: CandidateScope,
  filters: ListFilters,
): Promise<CandidatePage> {
  let page = Math.max(0, Math.min(filters.page ?? 0, 10000));
  const pageSize = Math.max(1, Math.min(filters.pageSize ?? 25, 100));
  const query = candidateQuery(s, filters);
  let result = await query.range(page * pageSize, (page + 1) * pageSize - 1);
  let rows = check(result) ?? [];
  const total = result.count ?? rows.length;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  if (page > lastPage) {
    page = lastPage;
    result = await query.range(page * pageSize, (page + 1) * pageSize - 1);
    rows = check(result) ?? [];
  }
  return { rows, total, page, pageSize };
}
async function attachCandidatePhotos(s: CandidateScope, rows: Candidate[]) {
  if (!rows.length) return;
  const files =
    check(
      await s.db
        .from<(CandidateFile & { candidate_id: string })[]>("candidate_files")
        .select("candidate_id,storage_path")
        .eq("state", "ready")
        .in("mime_type", [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/avif",
          "image/gif",
        ])
        .in(
          "candidate_id",
          rows.map((c) => c.id),
        ),
    ) ?? [];
  const paths = [
    ...new Set(
      files.map((f) => f.storage_path).filter((p): p is string => !!p),
    ),
  ];
  if (!paths.length) return;
  const { data: signed } = await s.client.storage
    .from("candidate-files")
    .createSignedUrls(paths, 1800);
  const urls = new Map(
    (signed ?? [])
      .filter((f) => !!f.path && !!f.signedUrl)
      .map((f) => [f.path, f.signedUrl]),
  );
  for (const row of rows) {
    const file = files.find((f) => f.candidate_id === row.id);
    row.photo_url = file?.storage_path
      ? (urls.get(file.storage_path) ?? null)
      : null;
  }
}
export async function candidateList(
  filters: ListFilters = {},
): Promise<CandidatePage> {
  const s = await candidateScope();
  if (filters.archive && !s.permissions.owner)
    throw new Error("Архив доступен владельцу");
  const result = await candidatePage(s, filters);
  await attachCandidatePhotos(s, result.rows);
  return result;
}
export async function candidateBoard(
  filters: ListFilters = {},
  pages: Partial<Record<CandidateStage, number>> = {},
  pageSize = BOARD_PAGE_SIZE,
): Promise<CandidateBoardData> {
  const s = await candidateScope();
  if (filters.archive && !s.permissions.owner)
    throw new Error("Архив доступен владельцу");
  const columns = await Promise.all(
    CANDIDATE_STAGE_KEYS.map(
      async (status) =>
        [
          status,
          filters.status && filters.status !== status
            ? { rows: [], total: 0, page: 0, pageSize }
            : await candidatePage(s, {
                ...filters,
                status,
                page: pages[status] ?? 0,
                pageSize,
                view: "board",
              }),
        ] as const,
    ),
  );
  await attachCandidatePhotos(
    s,
    columns.flatMap(([, column]) => column.rows),
  );
  return {
    columns: Object.fromEntries(columns) as CandidateBoardData["columns"],
    total: columns.reduce((n, [, c]) => n + c.total, 0),
  };
}
export async function candidateDetail(id: string): Promise<CandidateDetail> {
  const s = await candidateScope();
  uuid.parse(id);
  const candidate = check(
    await s.db
      .from<Candidate>("candidates")
      .select("*")
      .eq("id", id)
      .eq("account_id", s.accountId)
      .single(),
  );
  if (candidate.archived_at && !s.permissions.owner)
    throw new Error("Анкета в архиве");
  const [comments, events, appointments, files, related, hire] =
    await Promise.all([
      s.db
        .from<Comment[]>("candidate_comments")
        .select("*")
        .eq("candidate_id", id)
        .eq("account_id", s.accountId)
        .order("created_at"),
      s.db
        .from<CandidateEvent[]>("candidate_events")
        .select("*")
        .eq("candidate_id", id)
        .eq("account_id", s.accountId)
        .order("created_at", { ascending: false })
        .limit(200),
      s.db
        .from<Appointment[]>("candidate_appointments")
        .select("*")
        .eq("candidate_id", id)
        .eq("account_id", s.accountId)
        .order("appointment_date", { ascending: false }),
      s.db
        .from<CandidateFile[]>("candidate_files")
        .select("*")
        .eq("candidate_id", id)
        .eq("account_id", s.accountId)
        .order("created_at"),
      candidate.phone_normalized
        ? s.db
            .from<CandidateDetail["related"]>("candidates")
            .select("id,full_name,status,submitted_at")
            .eq("account_id", s.accountId)
            .eq("phone_normalized", candidate.phone_normalized)
            .neq("id", id)
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
      s.admin
        .from<CandidateDetail["hire"]>("candidate_hires")
        .select("state,input,error")
        .eq("account_id", s.accountId)
        .eq("candidate_id", id)
        .maybeSingle(),
    ]);
  const cs = check(comments) ?? [],
    es = check(events) ?? [],
    fs = check(files) ?? [];
  const authorIds = [
    ...new Set(
      [...cs.map((c) => c.author_id), ...es.map((e) => e.actor_id)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  const names = new Map<string, string>();
  if (authorIds.length) {
    const profiles =
      check(
        await s.admin
          .from<
            {
              id: string;
              first_name: string | null;
              last_name: string | null;
            }[]
          >("profiles")
          .select("id,first_name,last_name")
          .in("id", authorIds),
      ) ?? [];
    for (const p of profiles)
      names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" "));
  }
  await Promise.all(
    fs.map(async (f) => {
      if (f.storage_path) {
        const r = await s.client.storage
          .from("candidate-files")
          .createSignedUrl(f.storage_path, 1800);
        f.url = r.data?.signedUrl ?? null;
      }
    }),
  );
  return {
    candidate,
    comments: cs.map((c) => ({
      ...c,
      author_name:
        names.get(c.author_id ?? "") ?? c.source_author ?? "Импорт из Notion",
    })),
    events: es.map((e) => ({
      ...e,
      actor_name: names.get(e.actor_id ?? "") ?? "Система",
    })),
    appointments: check(appointments) ?? [],
    files: fs,
    related: check(related) ?? [],
    hire: check(hire),
  };
}
