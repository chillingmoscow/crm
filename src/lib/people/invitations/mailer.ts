import { buildInvitationHtml } from "@/lib/email-templates/invitation";
import type { InvitationEmailParams } from "@/lib/email-templates/invitation";
import nodemailer from "nodemailer";

export type { InvitationEmailParams };

let transporterPromise: ReturnType<typeof createTransporter> | null = null;

function getMailerConfig() {
  const host = process.env.SMTP_HOST ?? "postbox.cloud.yandex.net";
  const port = Number(process.env.SMTP_PORT ?? "465");
  const user = process.env.SMTP_USER ?? process.env.YANDEX_POSTBOX_API_KEY_ID ?? "";
  const pass = process.env.SMTP_PASS ?? process.env.YANDEX_POSTBOX_API_KEY_SECRET ?? "";
  const from = process.env.SMTP_ADMIN_EMAIL
    ?? process.env.SMTP_FROM_EMAIL
    ?? process.env.YANDEX_POSTBOX_FROM_EMAIL
    ?? process.env.RESEND_FROM_EMAIL
    ?? "noreply@sheerly.app";
  const fromName = process.env.SMTP_SENDER_NAME
    ?? process.env.SMTP_FROM_NAME
    ?? process.env.YANDEX_POSTBOX_FROM_NAME
    ?? "Sheerly";

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

function isConfigured() {
  const { user, pass } = getMailerConfig();
  return Boolean(user && pass);
}

async function createTransporter() {
  const { host, port, secure, user, pass } = getMailerConfig();

  if (!user || !pass) {
    throw new Error("SMTP_USER / SMTP_PASS не заданы");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      minVersion: "TLSv1.2",
    },
  });

  return transporter;
}

export function hasCustomMailerConfig() {
  return isConfigured();
}

export async function sendInvitationEmail(params: InvitationEmailParams) {
  if (!isConfigured()) {
    throw new Error("SMTP mailer не настроен");
  }

  if (!transporterPromise) {
    transporterPromise = createTransporter();
  }

  const transporter = await transporterPromise;
  const { from, fromName } = getMailerConfig();
  const subject = `Вас пригласили в ${params.venueName} — Sheerly`;
  const html = buildInvitationHtml(params);

  await transporter.sendMail({
    from: fromName ? `"${fromName}" <${from}>` : from,
    to: params.to,
    subject,
    html,
  });
}
