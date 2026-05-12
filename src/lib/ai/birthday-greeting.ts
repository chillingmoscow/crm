import "server-only";

import { getDeepseekClient, DEEPSEEK_MODELS } from "@/lib/ai/deepseek-client";

/**
 * AI-генерация поздравительных текстов для уведомлений с ДР.
 *
 * Возвращает короткий текст (2-3 предложения, тон тёплый и без
 * корпоративных штампов). При сбое DeepSeek — fallback на статический
 * текст; cron не должен ломаться из-за недоступности AI.
 */

const FALLBACK_SELF = [
  "С днём рождения! Желаем здоровья, тёплых эмоций и ярких моментов в новом году жизни. Спасибо, что вы с нами 🎂",
  "С праздником! Пусть всё задуманное сбывается, рядом будут близкие, а каждый день приносит повод улыбнуться 🎉",
  "С днём рождения! Желаем сил, вдохновения и побольше радостных событий. Мы ценим, что вы в нашей команде ✨",
];

const FALLBACK_COLLEAGUE = (
  name: string,
  daysLeft: number,
  dateStr: string,
) =>
  `Через ${daysLeft} ${
    daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"
  } у ${name} день рождения (${dateStr}). Есть время придумать сюрприз или скинуться на подарок 🎁`;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Сгенерировать поздравление имениннику. 2-3 короткие фразы.
 * Может быть вызвано без displayName (тогда нейтрально, без обращения).
 */
export async function generateBirthdayGreeting(args: {
  displayName: string | null;
}): Promise<string> {
  const SYSTEM =
    "Ты пишешь короткие поздравления с днём рождения сотрудника от лица компании. " +
    "Тон тёплый, искренний, без штампов вроде «процветания и финансового благополучия». " +
    "2-3 предложения максимум. Уместен один emoji в конце. Только текст, без markdown, без подписи.";
  const USER = args.displayName
    ? `Поздравь сотрудника по имени ${args.displayName} с днём рождения.`
    : "Поздравь сотрудника с днём рождения.";

  try {
    const client = getDeepseekClient();
    const resp = await client.chat.completions.create({
      model: DEEPSEEK_MODELS.chat,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
      ],
      temperature: 0.9, // Variability приветствуется — каждое поздравление разное.
      max_tokens: 200,
    });
    const out = resp.choices[0]?.message?.content?.trim();
    if (out) return out;
  } catch {
    // AI fail → fallback
  }
  return pickRandom(FALLBACK_SELF);
}

/**
 * Сгенерировать heads-up для коллег: «через N дней ДР у XYZ».
 * Содержит имя и формат даты, чтобы получатели понимали, что от них
 * ожидается (подготовить сюрприз / подарок).
 */
export async function generateBirthdayHeadsUp(args: {
  birthdayPersonName: string;
  daysLeft: number;
  dateStr: string;
}): Promise<string> {
  const SYSTEM =
    "Ты пишешь короткие уведомления для коллектива о приближающемся дне рождения коллеги. " +
    "Тон лёгкий, дружеский. Цель — напомнить, что есть время подготовить сюрприз. " +
    "2-3 предложения максимум, один emoji уместен. Только текст без markdown.";
  const USER =
    `Напомни команде, что через ${args.daysLeft} ${
      args.daysLeft === 1 ? "день" : args.daysLeft < 5 ? "дня" : "дней"
    } (${args.dateStr}) день рождения у коллеги — ${args.birthdayPersonName}. ` +
    "Намекни, что можно подготовиться (купить подарок / поздравить / устроить сюрприз).";

  try {
    const client = getDeepseekClient();
    const resp = await client.chat.completions.create({
      model: DEEPSEEK_MODELS.chat,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
      ],
      temperature: 0.9,
      max_tokens: 200,
    });
    const out = resp.choices[0]?.message?.content?.trim();
    if (out) return out;
  } catch {
    // fall through
  }
  return FALLBACK_COLLEAGUE(args.birthdayPersonName, args.daysLeft, args.dateStr);
}
