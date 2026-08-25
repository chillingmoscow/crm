import "server-only";

import { cookies } from "next/headers";

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
  v: 1;
  /** Кто на самом деле сидит за клавиатурой. */
  originUserId: string;
  originAccessToken: string;
  originRefreshToken: string;
  /** Чью шкуру надели. Сверяется с текущей сессией при рендере баннера. */
  targetUserId: string;
  targetName: string;
  targetRoleName: string | null;
  targetVenueName: string | null;
  startedAt: string;
};

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
      parsed?.v !== 1 ||
      typeof parsed.originUserId !== "string" ||
      typeof parsed.originAccessToken !== "string" ||
      typeof parsed.originRefreshToken !== "string" ||
      typeof parsed.targetUserId !== "string"
    ) {
      return null;
    }
    return parsed as ImpersonationState;
  } catch {
    return null;
  }
}

/** Пишет состояние. Только из server action — cookies() иначе read-only. */
export async function writeImpersonation(state: ImpersonationState): Promise<void> {
  const store = await cookies();
  store.set(
    IMPERSONATION_COOKIE,
    Buffer.from(JSON.stringify(state), "utf8").toString("base64url"),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    }
  );
}

/** Гасит состояние. Только из server action. */
export async function clearImpersonation(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}
