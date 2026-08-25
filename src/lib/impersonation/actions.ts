"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createClient,
  getCachedUser,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { isImpersonationAllowed, isImpersonationEnabled } from "./config";
import {
  clearImpersonation,
  readActiveImpersonation,
  readImpersonation,
  sessionIdFromAccessToken,
  writeImpersonation,
} from "./session";

export type ImpersonationTarget = {
  userId: string;
  name: string;
  email: string;
  /** Заведения моего аккаунта, где у человека активный membership. */
  venueName: string;
  roleName: string;
  /** null = цель доступна; строка = почему нельзя (показываем серым). */
  blockedReason: string | null;
};

const NOT_ALLOWED = "Режим просмотра за другого пользователя недоступен";

/** Из auth.users нам нужны только эти два поля. */
type AuthUserLite = { email?: string | null; email_confirmed_at?: string | null };

function fullName(
  first: string | null,
  last: string | null,
  email: string
): string {
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || email.split("@")[0] || "Без имени";
}

/**
 * Собирает список людей активного аккаунта, за которых можно посмотреть.
 *
 * Идёт через service-role: обычный клиент под RLS показал бы только
 * сотрудников активного venue, а нам нужны все venue аккаунта. Право на
 * это уже проверено (allowlist + владение аккаунтом через
 * get_active_account_id), поэтому обход RLS здесь осознанный.
 */
async function collectTargets(): Promise<{
  targets: ImpersonationTarget[];
  accountId: string | null;
  error: string | null;
}> {
  const me = await getCachedUser();
  if (!me) return { targets: [], accountId: null, error: "Не авторизован" };
  if (!isImpersonationAllowed(me.id)) {
    return { targets: [], accountId: null, error: NOT_ALLOWED };
  }

  const accountId = await getCachedActiveAccountId();
  if (!accountId) {
    return { targets: [], accountId: null, error: "Нет активного аккаунта" };
  }

  const admin = createAdminClient();

  const { data: myVenues, error: venuesErr } = await admin
    .from("venues")
    .select("id, name")
    .eq("account_id", accountId);
  if (venuesErr) return { targets: [], accountId, error: venuesErr.message };

  const myVenueIds = (myVenues ?? []).map((v) => v.id);
  if (myVenueIds.length === 0) {
    return { targets: [], accountId, error: null };
  }
  const venueNameById = new Map(
    (myVenues ?? []).map((v) => [v.id, v.name as string])
  );

  const { data: memberships, error: membersErr } = await admin
    .from("user_venue_roles")
    .select("user_id, venue_id, role_id")
    .in("venue_id", myVenueIds)
    .eq("status", "active");
  if (membersErr) return { targets: [], accountId, error: membersErr.message };

  const candidateIds = [
    ...new Set((memberships ?? []).map((m) => m.user_id as string)),
  ].filter((id) => id !== me.id);

  if (candidateIds.length === 0) {
    return { targets: [], accountId, error: null };
  }

  const roleIds = [
    ...new Set((memberships ?? []).map((m) => m.role_id as string)),
  ];

  // Всё, что нужно для карточек и для guard'ов, — одним заходом.
  const [
    { data: roles },
    { data: profiles },
    { data: allMemberships, error: allMembershipsErr },
    { data: ownedAccounts, error: ownedAccountsErr },
  ] = await Promise.all([
    admin.from("roles").select("id, name").in("id", roleIds),
    admin.from("profiles").select("id, first_name, last_name").in("id", candidateIds),
    // Активные membership'ы кандидатов ВЕЗДЕ, не только у меня — база
    // для кросс-тенантного guard'а.
    admin
      .from("user_venue_roles")
      .select("user_id, venue_id")
      .in("user_id", candidateIds)
      .eq("status", "active"),
    admin.from("accounts").select("id, owner_id").in("owner_id", candidateIds),
  ]);

  // Эти два запроса — сырьё кросс-тенантного guard'а, а не украшение
  // карточек. Проглотить их ошибку через `?? []` значит молча выключить
  // guard: множество «состоит ещё в одном аккаунте» окажется пустым, и
  // чужой сотрудник станет доступной целью. Падаем закрыто.
  if (allMembershipsErr || ownedAccountsErr) {
    return {
      targets: [],
      accountId,
      error: `Не удалось проверить принадлежность сотрудников к аккаунту: ${
        (allMembershipsErr ?? ownedAccountsErr)!.message
      }`,
    };
  }

  const roleNameById = new Map(
    (roles ?? []).map((r) => [r.id as string, r.name as string])
  );
  const profileById = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      { first: p.first_name as string | null, last: p.last_name as string | null },
    ])
  );

  // venue -> account для всех venue, где кандидаты состоят.
  const foreignVenueIds = [
    ...new Set(
      (allMemberships ?? [])
        .map((m) => m.venue_id as string)
        .filter((id) => !myVenueIds.includes(id))
    ),
  ];
  const foreignVenueOwners = new Map<string, string>();
  if (foreignVenueIds.length > 0) {
    const { data: foreignVenues, error: foreignVenuesErr } = await admin
      .from("venues")
      .select("id, account_id")
      .in("id", foreignVenueIds);
    // Тоже guard-запрос: без него не узнать, чьи это venue.
    if (foreignVenuesErr) {
      return {
        targets: [],
        accountId,
        error: `Не удалось проверить чужие заведения: ${foreignVenuesErr.message}`,
      };
    }
    for (const v of foreignVenues ?? []) {
      foreignVenueOwners.set(v.id as string, v.account_id as string);
    }
  }

  const outsideAccount = new Set<string>();
  for (const m of allMemberships ?? []) {
    const otherAccount = foreignVenueOwners.get(m.venue_id as string);
    if (otherAccount && otherAccount !== accountId) {
      outsideAccount.add(m.user_id as string);
    }
  }
  for (const a of ownedAccounts ?? []) {
    if ((a.id as string) !== accountId) {
      outsideAccount.add(a.owner_id as string);
    }
  }

  // email + email_confirmed_at живут в auth.users, PostgREST её не
  // отдаёт — только через Admin Auth API, по одному на пользователя.
  // Через runWithConcurrency, а не Promise.all: в аккаунте сети может быть
  // под сотню человек, и столько же одновременных запросов в GoTrue —
  // лишний способ словить таймаут. Ошибку по одному человеку глотаем:
  // он просто станет заблокированной целью («не найден в Auth»).
  const authById = new Map<string, AuthUserLite | null>();
  await runWithConcurrency(candidateIds, 8, async (id) => {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      authById.set(id, data?.user ?? null);
    } catch {
      authById.set(id, null);
    }
  });

  // Заведения/роли конкретного человека внутри МОЕГО аккаунта.
  const placesByUser = new Map<string, { venues: string[]; roles: string[] }>();
  for (const m of memberships ?? []) {
    const uid = m.user_id as string;
    if (uid === me.id) continue;
    const bucket = placesByUser.get(uid) ?? { venues: [], roles: [] };
    const venueName = venueNameById.get(m.venue_id as string);
    const roleName = roleNameById.get(m.role_id as string);
    if (venueName && !bucket.venues.includes(venueName)) bucket.venues.push(venueName);
    if (roleName && !bucket.roles.includes(roleName)) bucket.roles.push(roleName);
    placesByUser.set(uid, bucket);
  }

  const targets: ImpersonationTarget[] = candidateIds.map((id) => {
    const authUser = authById.get(id) ?? null;
    const email = authUser?.email ?? "";
    const profile = profileById.get(id);
    const places = placesByUser.get(id) ?? { venues: [], roles: [] };

    let blockedReason: string | null = null;
    if (!authUser) {
      blockedReason = "Пользователь не найден в Auth";
    } else if (!email) {
      blockedReason = "У пользователя нет email";
    } else if (outsideAccount.has(id)) {
      // Иначе, войдя его глазами, через штатный venue-switcher можно
      // уехать в чужой тенант.
      blockedReason = "Состоит ещё в одном аккаунте";
    } else if (!authUser.email_confirmed_at) {
      // Верификация magic-link подтверждает email побочным эффектом —
      // на placeholder-юзерах это молча меняет их состояние.
      blockedReason = "Email не подтверждён";
    }

    return {
      userId: id,
      name: fullName(profile?.first ?? null, profile?.last ?? null, email),
      email,
      venueName: places.venues.join(", ") || "—",
      roleName: places.roles.join(", ") || "—",
      blockedReason,
    };
  });

  targets.sort((a, b) => {
    if (!a.blockedReason !== !b.blockedReason) return a.blockedReason ? 1 : -1;
    return a.name.localeCompare(b.name, "ru");
  });

  return { targets, accountId, error: null };
}

/**
 * Аварийный выход из уже надетой чужой шкуры, когда билет выписать не вышло.
 *
 * Порядок важен: сначала пробуем вернуть свою сессию, и только если это не
 * удалось — принудительно разлогиниваем. Просто вернуть ошибку нельзя: к
 * этому моменту verifyOtp уже поставил чужие куки, и без одного из двух
 * действий человек останется в чужом кабинете без баннера и без выхода.
 */
async function abortIntoOwnSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origin: { access_token: string; refresh_token: string },
  reason: string
): Promise<string> {
  try {
    const { error } = await supabase.auth.setSession({
      access_token: origin.access_token,
      refresh_token: origin.refresh_token,
    });
    if (!error) return `${reason} — вход отменён`;
  } catch {
    // падаем в разлогин ниже
  }

  try {
    // scope: "local" — гасим ТОЛЬКО эту синтетическую сессию в этом
    // браузере. Глобальный scope отозвал бы refresh-токены сотрудника на
    // всех его устройствах: человек, который ничего не делал, оказался бы
    // разлогинен везде.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (!error) return `${reason}, и вернуть вашу сессию не вышло — войдите заново`;
  } catch {
    // падаем в общий текст ниже
  }
  return `${reason}. Выйти автоматически тоже не вышло — очистите куки сайта`;
}

/** Список для пикера на /dev/impersonate. */
export async function listImpersonationTargets(): Promise<{
  targets: ImpersonationTarget[];
  error: string | null;
}> {
  const { targets, error } = await collectTargets();
  return { targets, error };
}

/**
 * Войти в приложение глазами другого пользователя.
 *
 * Не имитирует личность — по-настоящему меняет сессию. Порядок важен:
 * снимаем свои токены → генерим magic-link цели → сохраняем «обратный
 * билет» → верифицируем токен (это и перезапишет sb-* куки).
 */
export async function startImpersonation(
  targetUserId: string
): Promise<{ error: string | null }> {
  if (!isImpersonationEnabled()) return { error: NOT_ALLOWED };

  const me = await getCachedUser();
  if (!me) return { error: "Не авторизован" };
  if (!isImpersonationAllowed(me.id)) return { error: NOT_ALLOWED };
  if (targetUserId === me.id) return { error: "Это вы и есть" };

  if (await readActiveImpersonation()) {
    return {
      error: "Вы уже смотрите за другого пользователя — сначала вернитесь к себе",
    };
  }
  if (await readImpersonation()) {
    // Билет есть, но он не про эту сессию: просмотр не состоялся либо
    // человек успел перелогиниться. Такой билет никуда не ведёт — гасим
    // и идём дальше, иначе вход был бы заперт до истечения куки.
    await clearImpersonation();
  }

  // Цель проверяем заново на сервере: клиенту с его списком не верим.
  const { targets, error: listError } = await collectTargets();
  if (listError) return { error: listError };

  const target = targets.find((t) => t.userId === targetUserId);
  if (!target) return { error: "Пользователь не найден в вашем аккаунте" };
  if (target.blockedReason) return { error: target.blockedReason };

  const supabase = await createClient();

  // getSession(), а не getUser(): нужны сами токены, а их отдаёт только
  // сессия. Токены тут же уедут в httpOnly-куку и клиенту не достанутся.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !session?.refresh_token) {
    return { error: "Не удалось снять текущую сессию — перелогиньтесь" };
  }

  const admin = createAdminClient();
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });

  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return {
      error: linkError?.message ?? "Не удалось выпустить токен для входа",
    };
  }

  // Билет пишем ПОСЛЕ входа, а не до: в него нужен session_id новой
  // сессии, а до verifyOtp её ещё не существует.
  let verifyMessage: string | null = null;
  let targetSessionId: string | null = null;
  try {
    const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    verifyMessage = verifyError?.message ?? null;
    targetSessionId = sessionIdFromAccessToken(verified?.session?.access_token);
  } catch (err) {
    // Сетевой сбой до GoTrue приходит исключением, а не { error }.
    verifyMessage = err instanceof Error ? err.message : "Не удалось войти";
  }
  if (verifyMessage) return { error: verifyMessage };

  if (!targetSessionId) {
    // Билет без привязки к сессии небезопасен, а без билета не вернуться.
    return {
      error: await abortIntoOwnSession(
        supabase,
        session,
        "Не удалось привязать сессию просмотра"
      ),
    };
  }

  // Имя, должность и заведение в билет НЕ кладём: их длина ничем не
  // ограничена (у сети это список всех заведений), а кука больше ~4 КБ
  // молча отбрасывается браузером. Баннер и так получает эти данные из
  // layout'а — там они к тому же точнее: активное заведение, а не все.
  const ticketWritten = await writeImpersonation({
    v: 2,
    originUserId: me.id,
    originAccessToken: session.access_token,
    originRefreshToken: session.refresh_token,
    targetUserId: target.userId,
    targetSessionId,
    startedAt: new Date().toISOString(),
  });

  if (!ticketWritten) {
    // Билет не влез — без него из чужой шкуры не выбраться.
    return {
      error: await abortIntoOwnSession(
        supabase,
        session,
        "Не удалось сохранить возврат к своей сессии"
      ),
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Вернуться к себе: восстановить сохранённую сессию. */
export async function stopImpersonation(): Promise<{ error: string | null }> {
  const state = await readActiveImpersonation();
  if (!state) {
    // Либо просмотр не идёт, либо билет не про эту сессию — например,
    // пережил выход из аккаунта и достался следующему, кто вошёл на этом
    // браузере. Восстанавливать по нему нечего, гасим.
    await clearImpersonation();
    return { error: "Режим просмотра не активен" };
  }

  // Список доступа здесь НЕ проверяем. Привязка к session_id уже
  // доказывает, что билет выписан нами для этой самой сессии, то есть
  // подлог куки закрыт. А проверка списка ломала бы возврат ровно в тот
  // момент, когда фичу выключают на проде, — оставляя человека в чужой
  // шкуре без выхода.
  const supabase = await createClient();

  // Дальше важен порядок: redirect() из next/navigation бросает
  // NEXT_REDIRECT, поэтому он обязан стоять ВНЕ try — иначе catch поймает
  // собственный редирект и примет его за сбой сети.

  // Основной путь: вернуть свою сессию.
  let restoreMessage: string | null = null;
  try {
    const { error } = await supabase.auth.setSession({
      access_token: state.originAccessToken,
      refresh_token: state.originRefreshToken,
    });
    restoreMessage = error?.message ?? null;
  } catch (err) {
    restoreMessage = err instanceof Error ? err.message : "сбой связи";
  }

  if (!restoreMessage) {
    await clearImpersonation();
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  // Свою сессию вернуть не вышло (токен отозван, GoTrue недоступен).
  // Оставлять человека в чужой шкуре нельзя, поэтому выходим совсем —
  // но локально, чтобы не отозвать сессии сотрудника на его устройствах.
  let signOutMessage: string | null = null;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    signOutMessage = error?.message ?? null;
  } catch (err) {
    signOutMessage = err instanceof Error ? err.message : "сбой связи";
  }

  if (!signOutMessage) {
    await clearImpersonation();
    revalidatePath("/", "layout");
    redirect("/login");
  }

  // Ни туда, ни сюда. Билет НЕ гасим: мы всё ещё в чужой сессии, и он —
  // единственное, что рисует баннер и даёт повторить попытку.
  return {
    error: `Не удалось вернуть вашу сессию (${restoreMessage}) и выйти тоже не вышло (${signOutMessage}). Попробуйте ещё раз.`,
  };
}
