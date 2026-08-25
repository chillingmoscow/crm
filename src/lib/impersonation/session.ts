import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

/**
 * Кука, в которой лежит «обратный билет» — сессия разработчика, снятая
 * перед тем как надеть чужую.
 *
 * Сама impersonation-сессия абсолютно настоящая (см. actions.ts): в
 * `sb-*` куках лежит нормальный GoTrue-токен целевого пользователя,
 * поэтому RLS, Storage, Realtime и все 111 мест с `auth.getUser()`
 * работают без единой правки. Эта кука — единственный признак, по
 * которому приложение понимает, что режим включён, и единственный
 * способ вернуться к себе.
 *
 * httpOnly: внутри лежат живые токены, клиентскому JS их видеть незачем.
 *
 * maxAge — компромисс. Кука держит живые токены, поэтому хочется покороче;
 * но когда она протухает, исчезает и баннер, а `sb-*` сессия цели остаётся —
 * то есть человек молча продолжает сидеть в чужом кабинете без единого
 * признака этого. Ровно тот провал, от которого баннер и защищает. Поэтому
 * срок жизни выбран по длине рабочего дня, а не по «поменьше»: за 8 часов
 * отладка успевает закончиться. Что делать, если всё же протухло, —
 * см. docs/dev-impersonation.md.
 */
export const IMPERSONATION_COOKIE = "sheerly_impersonation";

const MAX_AGE_SECONDS = 60 * 60 * 8;

export type ImpersonationState = {
  /**
   * v2 добавила targetSessionId. Старые v1-куки намеренно не мигрируются:
   * билет без привязки к сессии — это ровно та дыра, ради которой версия
   * поднята, поэтому пусть протухнет как невалидный.
   */
  v: 2;
  /** Кто на самом деле сидит за клавиатурой. */
  originUserId: string;
  originAccessToken: string;
  originRefreshToken: string;
  /** Чью шкуру надели. */
  targetUserId: string;
  /**
   * session_id ТОЙ САМОЙ сессии GoTrue, которую мы выдали при входе.
   *
   * Без этой привязки билет действителен для любой будущей сессии того же
   * пользователя. Тогда сценарий такой: разработчик в чужой шкуре нажал
   * «Выйти», кука (httpOnly, клиентским signOut не стирается) осталась,
   * а сотрудник на том же браузере зашёл под собой — и получил кнопку
   * «Вернуться к себе», которая логинит его в сессию разработчика.
   * Свежий вход даёт новый session_id, поэтому такой билет больше не
   * подходит. Он же закрывает подлог куки: session_id не угадать.
   */
  targetSessionId: string;
  startedAt: string;
};

/**
 * Потолок размера значения куки.
 *
 * Браузер молча отбрасывает куку больше ~4096 байт — не ошибка, просто её
 * не будет. Для нас это худший исход: sb-куки от verifyOtp браузер примет,
 * а билет нет, и человек останется в чужой шкуре без баннера и без выхода.
 * Поэтому в билете лежат только токены и идентификаторы фиксированной
 * длины (имена и списки заведений выкинуты — их и так знает layout), а
 * этот порог страхует от неожиданно раздутого user_metadata в токене.
 */
const MAX_COOKIE_BYTES = 3500;

/**
 * Читает состояние. Возвращает null, если куки нет или она битая —
 * мусор в куке не должен ронять layout.
 */
export async function readImpersonation(): Promise<ImpersonationState | null> {
  const store = await cookies();
  const raw = store.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as Partial<ImpersonationState>;

    if (
      parsed?.v !== 2 ||
      typeof parsed.originUserId !== "string" ||
      typeof parsed.originAccessToken !== "string" ||
      typeof parsed.originRefreshToken !== "string" ||
      typeof parsed.targetUserId !== "string" ||
      typeof parsed.targetSessionId !== "string"
    ) {
      return null;
    }
    return parsed as ImpersonationState;
  } catch {
    return null;
  }
}

/**
 * Пишет состояние. Только из server action — cookies() иначе read-only.
 *
 * Возвращает false, если билет не влезает в куку: писать его смысла нет,
 * браузер всё равно отбросит, а caller обязан откатить вход.
 */
export async function writeImpersonation(
  state: ImpersonationState
): Promise<boolean> {
  const value = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  if (value.length > MAX_COOKIE_BYTES) return false;

  const store = await cookies();
  store.set(
    IMPERSONATION_COOKIE,
    value,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    }
  );
  return true;
}

/** Гасит состояние. Только из server action. */
export async function clearImpersonation(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}

/**
 * session_id из payload access-токена.
 *
 * Подпись не проверяем намеренно: токен пришёл из нашей же sb-куки, а его
 * подлинность уже подтверждена getUser() на стороне GoTrue. Здесь нужен
 * только идентификатор для сравнения, а не решение о доступе.
 */
export function sessionIdFromAccessToken(
  token: string | null | undefined
): string | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { session_id?: unknown };
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Билет, действительный ЗДЕСЬ И СЕЙЧАС: он существует, выписан на текущего
 * пользователя и на текущую сессию.
 *
 * Единственная точка, по которой стоит решать «идёт ли просмотр». Билет,
 * переживший выход из аккаунта, сюда не пройдёт: у нового входа другой
 * session_id.
 */
export async function readActiveImpersonation(): Promise<ImpersonationState | null> {
  const state = await readImpersonation();
  if (!state) return null;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user?.id !== state.targetUserId) return null;
  if (sessionIdFromAccessToken(session?.access_token) !== state.targetSessionId) {
    return null;
  }
  return state;
}
