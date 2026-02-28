export type InvitationEmailParams = {
  to:          string;
  actionLink:  string;
  venueName:   string;
  /** Kept for caller compatibility — not rendered in the template. */
  accountName: string | null;
  inviterName: string | null;
  roleName:    string | null;
  existingUser: boolean;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&",  "&amp;")
    .replaceAll("<",  "&lt;")
    .replaceAll(">",  "&gt;")
    .replaceAll('"',  "&quot;")
    .replaceAll("'",  "&#039;");
}

export function buildInvitationHtml(params: InvitationEmailParams): string {
  const siteUrl     = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://sheerly.app").replace(/\/$/, "");
  const venueName   = escapeHtml(params.venueName);
  const inviterName = params.inviterName ? escapeHtml(params.inviterName) : "Администратор";
  const roleName    = params.roleName    ? escapeHtml(params.roleName)    : "Сотрудник";
  const actionLink  = escapeHtml(params.actionLink);

  const heading    = "Вас приглашают в Sheerly";
  const actionText = "Присоединиться";

  const intro = params.existingUser
    ? `<strong>${inviterName}</strong> приглашает вас присоединиться к заведению&nbsp;<strong>${venueName}</strong> в&nbsp;Sheerly.`
    : `<strong>${inviterName}</strong> приглашает вас в Sheerly. Перейдите по ссылке, чтобы присоединиться к&nbsp;<strong>${venueName}</strong>.`;

  return `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${heading}</title>
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
              <img src="${siteUrl}/logo-full.svg"
                   alt="Sheerly"
                   width="120"
                   height="29"
                   style="display:block;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
        </table>

        <!-- ── Card ─────────────────────────────────────────────────────────── -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.05);">
          <tr>
            <td class="card-inner" style="padding:40px 40px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0">

                <!-- Icon circle -->
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:60px;height:60px;background-color:#EFF6FF;border-radius:30px;text-align:center;vertical-align:middle;">
                          <span style="font-size:26px;line-height:60px;display:block;">👋</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Heading -->
                <tr>
                  <td align="center" style="padding-bottom:12px;">
                    <h1 class="heading" style="margin:0;font-size:24px;line-height:32px;font-weight:700;color:#101828;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                      ${heading}
                    </h1>
                  </td>
                </tr>

                <!-- Intro -->
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <p style="margin:0;font-size:15px;line-height:24px;color:#6B7280;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:380px;">
                      ${intro}
                    </p>
                  </td>
                </tr>

                <!-- Info block -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB;border-radius:10px;">
                      <tr>
                        <td style="padding:16px 20px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding:0 0 10px;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                                <span style="color:#9CA3AF;">Заведение</span>&nbsp;&nbsp;<strong style="color:#101828;">${venueName}</strong>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 0 10px;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                                <span style="color:#9CA3AF;">Должность</span>&nbsp;&nbsp;<strong style="color:#101828;">${roleName}</strong>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                                <span style="color:#9CA3AF;">Пригласил</span>&nbsp;&nbsp;<strong style="color:#101828;">${inviterName}</strong>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA button -->
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color:#2563EB;border-radius:10px;">
                          <a href="${actionLink}"
                             target="_blank"
                             style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;letter-spacing:0.1px;">
                            ${actionText}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>

        <!-- ── Footer ────────────────────────────────────────────────────────── -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;line-height:18px;color:#9CA3AF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                Если вы не ожидали этого приглашения — просто проигнорируйте письмо.
              </p>
              <p style="margin:6px 0 0;font-size:12px;line-height:18px;color:#D1D5DB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                © 2025 Sheerly. Все права защищены.
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
