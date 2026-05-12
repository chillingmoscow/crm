/**
 * Shared SMTP transporter (nodemailer) для всех почтовых рассылок
 * Sheerly: invitation-инвайты, email-change confirmation, и далее.
 *
 * Конфиг через env-vars (Yandex Postbox по умолчанию):
 *   SMTP_HOST                 → postbox.cloud.yandex.net
 *   SMTP_PORT                 → 465 (TLS)
 *   SMTP_USER                 → API key id
 *   SMTP_PASS                 → API key secret
 *   SMTP_ADMIN_EMAIL          → from-address (noreply@sheerly.app)
 *   SMTP_SENDER_NAME          → "Sheerly"
 *
 * Также поддерживаются legacy-aliasы YANDEX_POSTBOX_API_KEY_*
 * и RESEND_FROM_EMAIL для миграции со старых конфигов.
 */

import nodemailer, { type Transporter } from "nodemailer";

export type MailerConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
};

export function getMailerConfig(): MailerConfig {
  const host = process.env.SMTP_HOST ?? "postbox.cloud.yandex.net";
  const port = Number(process.env.SMTP_PORT ?? "465");
  const user =
    process.env.SMTP_USER ?? process.env.YANDEX_POSTBOX_API_KEY_ID ?? "";
  const pass =
    process.env.SMTP_PASS ?? process.env.YANDEX_POSTBOX_API_KEY_SECRET ?? "";
  const from =
    process.env.SMTP_ADMIN_EMAIL ??
    process.env.SMTP_FROM_EMAIL ??
    process.env.YANDEX_POSTBOX_FROM_EMAIL ??
    process.env.RESEND_FROM_EMAIL ??
    "noreply@sheerly.app";
  const fromName =
    process.env.SMTP_SENDER_NAME ??
    process.env.SMTP_FROM_NAME ??
    process.env.YANDEX_POSTBOX_FROM_NAME ??
    "Sheerly";

  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    from,
    fromName,
  };
}

export function isMailerConfigured(): boolean {
  const { user, pass } = getMailerConfig();
  return Boolean(user && pass);
}

let transporterPromise: Promise<Transporter> | null = null;

async function createTransporter(): Promise<Transporter> {
  const { host, port, secure, user, pass } = getMailerConfig();
  if (!user || !pass) {
    throw new Error("SMTP_USER / SMTP_PASS не заданы");
  }
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      minVersion: "TLSv1.2",
    },
  });
}

/**
 * Lazy-singleton: транспортер создаётся один раз на процесс при первом
 * вызове и переиспользуется для всех последующих рассылок (nodemailer
 * пулит TCP-соединения внутри).
 */
export async function getTransporter(): Promise<Transporter> {
  if (!isMailerConfigured()) {
    throw new Error("SMTP mailer не настроен");
  }
  if (!transporterPromise) {
    transporterPromise = createTransporter();
  }
  return transporterPromise;
}

/**
 * Удобная обёртка: from собирается из конфига сразу с display-name.
 */
export async function sendMail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const transporter = await getTransporter();
  const { from, fromName } = getMailerConfig();
  await transporter.sendMail({
    from: fromName ? `"${fromName}" <${from}>` : from,
    to: args.to,
    subject: args.subject,
    html: args.html,
  });
}
