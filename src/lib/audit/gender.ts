/**
 * Согласование глагола журнала с полом автора действия.
 *
 * Фразы журнала пишутся с двойным окончанием («изменил(а)», «перенёс(ла)»),
 * а в интерфейсе их быть не должно (DS → «Тексты»). Если пол автора известен,
 * окончание выбирается по нему; если нет — фраза остаётся как есть.
 */
export type ActorGender = "male" | "female" | null | undefined;

const DOUBLE = /([а-яё]+)\((а|ла)\)/gi;

function feminine(stem: string, suffix: string): string {
  if (suffix === "ла") {
    // учёл(ла) → учла; перенёс(ла) → перенесла
    if (/учёл$/i.test(stem)) return stem.slice(0, -3) + "чла";
    return stem.replace(/ё(?=[^ё]*$)/, "е") + "ла";
  }
  // провёл(а) → провела; изменил(а) → изменила
  if (/ёл$/i.test(stem)) return stem.slice(0, -2) + "ела";
  return stem + "а";
}

export function genderizeText(text: string, gender: ActorGender): string {
  if (gender !== "male" && gender !== "female") return text;
  return text.replace(DOUBLE, (_, stem: string, suffix: string) =>
    gender === "male" ? stem : feminine(stem, suffix),
  );
}
