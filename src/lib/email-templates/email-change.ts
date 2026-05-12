export type EmailChangeEmailParams = {
  /** Новый адрес — туда же шлём письмо. */
  to: string;
  /** Полная ссылка подтверждения /auth/confirm-email-change?token=... */
  actionLink: string;
  /** Старый адрес (для подсказки в письме «вы меняете X на Y»). */
  previousEmail: string;
  /** Имя пользователя для приветствия. */
  displayName: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * HTML-шаблон письма подтверждения смены email. Структура повторяет
 * invitation.ts (логотип, карточка, кнопка action, fallback-link, футер) —
 * чтобы все письма от Sheerly выглядели единообразно.
 */
export function buildEmailChangeHtml(params: EmailChangeEmailParams): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://sheerly.app").replace(/\/$/, "");
  const actionLink = escapeHtml(params.actionLink);
  const previousEmail = escapeHtml(params.previousEmail);
  const greeting = params.displayName
    ? `Здравствуйте, ${escapeHtml(params.displayName)}!`
    : "Здравствуйте!";

  return `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Подтверждение смены email</title>
  <style>
    body { margin:0;padding:0;background-color:#F9FAFB; }
    table { border-collapse:collapse; }
    @media only screen and (max-width:540px) {
      .card-inner { padding:28px 24px !important; }
      .heading    { font-size:20px !important;line-height:28px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F9FAFB;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB;">
    <tr>
      <td align="center" valign="top" style="padding:48px 16px 40px;">

        <!-- ── Logo ─────────────────────────────────────────────────────────── -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <img src="${siteUrl}/logo-mail.png"
                   alt="Sheerly"
                   width="260"
                   style="display:block;border:0;outline:none;text-decoration:none;height:auto;" />
            </td>
          </tr>
        </table>

        <!-- ── Card ─────────────────────────────────────────────────────────── -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.05);">
          <tr>
            <td class="card-inner" style="padding:40px 40px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0">

                <!-- Icon -->
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:60px;height:60px;background-color:#EFF6FF;border-radius:30px;text-align:center;vertical-align:middle;">
                          <span style="font-size:26px;line-height:60px;display:block;">✉️</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Heading -->
                <tr>
                  <td align="center" style="padding-bottom:12px;">
                    <h1 class="heading" style="margin:0;font-size:24px;line-height:32px;font-weight:700;color:#101828;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                      Подтвердите смену email
                    </h1>
                  </td>
                </tr>

                <!-- Intro -->
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <p style="margin:0;font-size:15px;line-height:24px;color:#6B7280;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:380px;">
                      ${greeting} Кто-то — скорее всего вы — запросил смену
                      адреса для входа в Sheerly с
                      <strong style="color:#101828;">${previousEmail}</strong>
                      на этот email. Подтвердите, чтобы завершить.
                    </p>
                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td align="center" style="padding-bottom:24px;">
                    <a href="${actionLink}"
                       style="display:inline-block;padding:14px 32px;background-color:#1570EF;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:20px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                      Подтвердить смену email
                    </a>
                  </td>
                </tr>

                <!-- Fallback link -->
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <p style="margin:0;font-size:12px;line-height:18px;color:#9CA3AF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                      Если кнопка не работает, скопируйте ссылку в браузер:
                    </p>
                    <p style="margin:6px 0 0;font-size:11px;line-height:16px;color:#6B7280;word-break:break-all;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                      <a href="${actionLink}" style="color:#1570EF;text-decoration:underline;">${actionLink}</a>
                    </p>
                  </td>
                </tr>

                <!-- Security hint -->
                <tr>
                  <td style="padding-top:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FEF3F2;border-radius:10px;">
                      <tr>
                        <td style="padding:14px 18px;font-size:13px;line-height:20px;color:#B42318;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                          Если вы это не запрашивали — просто проигнорируйте письмо.
                          Адрес для входа не изменится без подтверждения. Ссылка
                          действует 1 час.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- ── Footer ───────────────────────────────────────────────────────── -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;line-height:18px;color:#9CA3AF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                Sheerly · CRM для HoReCa
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
