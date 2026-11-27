"use client";

import { avatarImageUrl } from "./avatar-thumb";
import { flightTargetStyle } from "./avatar-flight-name";

export { flightName, flightTargetStyle } from "./avatar-flight-name";

/**
 * Перелёт аватара из строки «Сотрудников» в шапку карточки (View Transitions).
 *
 * Как устроено:
 * - в списке у `PersonAvatar` есть `flightId` → `data-avatar-flight-source`;
 * - по клику имя перехода (`view-transition-name: staff-avatar-<id>`) ставится
 *   только нажатому аватару — имена на странице должны быть уникальны, а
 *   чужие переходы страниц не должны цеплять остальные аватары списка;
 * - в шапке карточки (`ProfileHeader` с `flightId`) и в её скелетоне
 *   (`StaffCardLoadingHeader`) аватар носит то же имя постоянно;
 * - переход ждёт, пока на новой странице появится аватар-цель. Скелетон
 *   карточки рисует цель сразу — с тем же фото и именем, которые взяты
 *   из строки (`pendingFlight`), поэтому экран не замирает на время запроса.
 *
 * Без поддержки View Transitions и при `prefers-reduced-motion` — обычный
 * переход. Движение — `docs/motion.md`, строка «Перелёт аватара».
 */

type FlightInfo = { userId: string; src: string | null; name: string };

let pending: FlightInfo | null = null;

/** Фото и имя человека, к которому сейчас летит аватар, — для скелетона карточки. */
export function pendingFlight(userId: string | null | undefined): FlightInfo | null {
  return userId && pending?.userId === userId ? pending : null;
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> };
};

const TARGET_TIMEOUT = 1500;

/**
 * Ждём аватар-цель на новой странице. Не через requestAnimationFrame: пока
 * переход ждёт обновления, браузер не рисует кадры и rAF не вызывается.
 */
function waitForTarget(userId: string): Promise<void> {
  const selector = `[data-avatar-flight-target="${CSS.escape(userId)}"]`;
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve();
    const done = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) done();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(done, TARGET_TIMEOUT);
  });
}

/**
 * Открыть карточку сотрудника с перелётом аватара. `navigate` — переход
 * роутера (`() => router.push(href)`).
 */
export function flyToStaffCard(info: FlightInfo, navigate: () => void) {
  const doc = document as TransitionDocument;
  const source = [
    ...document.querySelectorAll<HTMLElement>(
      `[data-avatar-flight-source="${CSS.escape(info.userId)}"]`,
    ),
  ].find((el) => el.getClientRects().length > 0);
  if (
    !doc.startViewTransition ||
    !source ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    navigate();
    return;
  }
  pending = info;
  // Крупная копия фото, которую покажет шапка, — заранее, чтобы она не
  // догружалась на глазах после посадки.
  if (info.src) new Image().src = avatarImageUrl(info.src, 128);
  Object.assign(source.style, flightTargetStyle(info.userId));
  const transition = doc.startViewTransition(() => {
    // Старый кадр уже снят: имя с источника снимаем, чтобы на новой
    // странице оно было только у цели.
    source.style.viewTransitionName = "";
    navigate();
    return waitForTarget(info.userId);
  });
  transition.finished.finally(() => {
    if (pending === info) pending = null;
  });
}

/** Клик, который открывает ссылку в этой же вкладке (без Ctrl/⌘/Shift, левой кнопкой). */
export function isPlainClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
