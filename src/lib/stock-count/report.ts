import type { TelegramBot } from "@/lib/integrations/telegram-bot";

export type WeighingReportLine = {
  title: string;
  kg: number;
  deltaKg: number | null;
  deltaSum: number | null;
};

const MINUS = "−";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** «52,418»: три знака после запятой, без разделителя тысяч. */
function kgText(value: number) {
  return Math.abs(value).toFixed(3).replace(".", ",");
}

/** Целые рубли с обычным пробелом между тысячами. */
function rubText(value: number) {
  return Math.round(Math.abs(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function signOf(value: number) {
  if (value > 0) return "+";
  if (value < 0) return MINUS;
  return "";
}

function lineText(line: WeighingReportLine) {
  const base = `${escapeHtml(line.title)}: ${kgText(line.kg)} кг`;
  if (line.deltaKg === null || line.deltaSum === null) return base;
  // Знак по округлённому значению: «−0,000» не показываем.
  const kgSign = signOf(Number(line.deltaKg.toFixed(3)));
  const sumSign = signOf(Math.round(line.deltaSum));
  return `${base} (${kgSign}${kgText(line.deltaKg)} кг · ${sumSign}${rubText(line.deltaSum)} ₽)`;
}

export function buildWeighingCaption(input: {
  documentNumber: string;
  employeeName: string;
  lines: WeighingReportLine[];
  url: string;
}): string {
  return [
    `📊 <b>Взвешивание табака ${escapeHtml(input.documentNumber)}</b>`,
    `Сотрудник: ${escapeHtml(input.employeeName)}`,
    ...input.lines.map(lineText),
    `<a href="${input.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Акт в Sheerly</a>`,
  ].join("\n");
}

const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_PAUSE_MS = 5000;

/**
 * Отправляет итоги взвешивания: PDF акта документом; если Quick Resto не отдал
 * PDF за три попытки — той же подписью обычным сообщением. Ошибки Telegram
 * пробрасываются: вызывающий код помечает статус отправки.
 */
export async function sendWeighingReport(input: {
  bot: Pick<TelegramBot, "sendDocument" | "sendMessage">;
  chatId: string;
  download: () => Promise<Blob>;
  filename: string;
  caption: string;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ sent: "document" | "message" }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let pdf: Blob | null = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      pdf = await input.download();
      break;
    } catch {
      if (attempt < DOWNLOAD_ATTEMPTS) await sleep(DOWNLOAD_PAUSE_MS);
    }
  }
  if (pdf) {
    const sent = await input.bot.sendDocument(input.chatId, pdf, input.filename, input.caption);
    if (!sent.ok) throw new Error(sent.description ?? "Telegram не принял документ");
    return { sent: "document" };
  }
  const sent = await input.bot.sendMessage(input.chatId, input.caption, undefined, { html: true });
  if (!sent.ok) throw new Error(sent.description ?? "Telegram не принял сообщение");
  return { sent: "message" };
}
