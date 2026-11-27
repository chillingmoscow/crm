// Сверка дня выдачи зарплаты с изъятиями из кассы Quick Resto (план выплат,
// этап 3). Чистые функции — их гоняет node --test.
//
// Менеджеры делают одно изъятие на всю выдачу дня с комментарием «ЗП».
// В тот же день бывают и другие изъятия (сейф, такси, разовые), поэтому сумма
// всех изъятий не годится: ищем изъятие, равное сумме выданного по плану.
// Если по привычке сделали по изъятию на человека — засчитываем набор
// изъятий с «ЗП» или именем из выдачи в комментарии, если их сумма равна
// сумме дня.

export type Withdrawal = { id: number; amount: number; comment: string };

export type ReconcileResult = {
  state: "matched" | "mismatch";
  /** Сколько изъято на зарплату (для «не сошлось» — что похоже на зарплату). */
  withdrawn: number;
  /** Изъятия, засчитанные дню. Пусто, если не сошлось. */
  ids: number[];
};

const cents = (n: number) => Math.round(n * 100);

/** «ЗП», «з/п», «зп.», «зарплата» — отдельным словом. */
const SALARY = /(^|[^\p{L}])(з\s*\/?\s*п|зарплат|аванс)/iu;

/** Слова имени длиннее двух букв: «Копылова Наталья» → копылова, наталья. */
function nameWords(names: string[]): string[] {
  return [...new Set(names.flatMap((n) => n.toLowerCase().split(/[^\p{L}]+/u)).filter((w) => w.length > 2))];
}

function mentionsName(comment: string, words: string[]): boolean {
  const tokens = comment.toLowerCase().split(/[^\p{L}]+/u);
  return words.some((w) => tokens.includes(w));
}

export function reconcileDay(input: {
  issued: number;
  withdrawals: Withdrawal[];
  /** Полные имена тех, кому выдали в этот день. */
  names: string[];
  /** Изъятие чаевых (как в синке кассовых операций). */
  tips: RegExp;
}): ReconcileResult {
  const target = cents(input.issued);
  const salaryMarked = (w: Withdrawal) => SALARY.test(w.comment);
  // Чаевые — не зарплата, если в комментарии нет явного «ЗП».
  const pool = input.withdrawals.filter((w) => salaryMarked(w) || !input.tips.test(w.comment));
  const words = nameWords(input.names);
  const related = pool.filter((w) => salaryMarked(w) || mentionsName(w.comment, words));
  const relatedTotal = related.reduce((sum, w) => sum + cents(w.amount), 0);

  // Одно изъятие на всю сумму дня; с «ЗП» в комментарии — в первую очередь.
  const single = [...pool]
    .sort((a, b) => Number(salaryMarked(b)) - Number(salaryMarked(a)) || a.id - b.id)
    .find((w) => cents(w.amount) === target);
  if (single) return { state: "matched", withdrawn: input.issued, ids: [single.id] };

  if (related.length > 0 && relatedTotal === target) {
    return { state: "matched", withdrawn: input.issued, ids: related.map((w) => w.id).sort((a, b) => a - b) };
  }
  return { state: "mismatch", withdrawn: relatedTotal / 100, ids: [] };
}
