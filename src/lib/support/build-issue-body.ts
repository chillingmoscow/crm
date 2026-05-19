/**
 * Чистая сборка markdown-тела GitHub-issue / письма из репорта
 * поддержки. Без сайд-эффектов — тестируется в build-issue-body.test.mts.
 */

export type SupportCategory = "bug" | "idea" | "question";

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  bug: "Ошибка",
  idea: "Идея / предложение",
  question: "Вопрос",
};

export interface SupportContext {
  userEmail: string;
  accountId: string | null;
  pageUrl: string;
  userAgent: string;
  viewport: string;
  submittedAt: string;
}

export interface BuildIssueBodyArgs {
  description: string;
  category: SupportCategory;
  context: SupportContext;
  /** Подписанная ссылка на вложение (если файл приложен). */
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  /** TTL ссылки в днях — упоминается рядом, чтобы было видно срок жизни. */
  attachmentTtlDays?: number;
}

/** Заголовок issue: `[Report] Ошибка: <первая строка описания>`. */
export function buildIssueTitle(
  category: SupportCategory,
  description: string,
): string {
  const firstLine = description.trim().split("\n")[0]?.trim() ?? "";
  const truncated =
    firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
  return `[Report] ${SUPPORT_CATEGORY_LABEL[category]}: ${truncated || "без описания"}`;
}

export function buildIssueBody(args: BuildIssueBodyArgs): string {
  const { description, category, context, attachmentUrl, attachmentName } =
    args;

  const lines: string[] = [];

  lines.push(description.trim());
  lines.push("");

  if (attachmentUrl) {
    const ttlNote =
      args.attachmentTtlDays != null
        ? ` _(ссылка действует ~${args.attachmentTtlDays} дн.)_`
        : "";
    lines.push(
      `**Вложение:** [${attachmentName || "файл"}](${attachmentUrl})${ttlNote}`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("| Контекст | Значение |");
  lines.push("| --- | --- |");
  lines.push(`| Категория | ${SUPPORT_CATEGORY_LABEL[category]} |`);
  lines.push(`| Пользователь | ${context.userEmail} |`);
  lines.push(`| Аккаунт | ${context.accountId ?? "—"} |`);
  lines.push(`| Страница | ${context.pageUrl} |`);
  lines.push(`| Браузер | ${sanitizeCell(context.userAgent)} |`);
  lines.push(`| Окно | ${context.viewport} |`);
  lines.push(`| Время | ${context.submittedAt} |`);

  return lines.join("\n");
}

/** GitHub-метки для issue: общая + по категории. */
export function issueLabels(category: SupportCategory): string[] {
  return ["user-report", category];
}

/** Экранирует `|` и переводы строк, чтобы не ломать markdown-таблицу. */
function sanitizeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
