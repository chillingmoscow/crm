import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * GET /auth/confirm?token_hash=XXX&type=invite&next=/set-password?next=...
 *
 * Verifies a hashed OTP token (invite, magiclink, recovery, etc.) and
 * establishes a session cookie, then redirects to `next`.
 * Used instead of the Supabase-hosted action_link so all links stay on
 * our own domain.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams, origin } = requestUrl;

  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next") ?? "/dashboard";
  // Only allow relative redirects to prevent open-redirect attacks
  const next = rawNext.startsWith("/") ? rawNext : "/dashboard";

  // Resolve the public-facing base URL (same logic as /auth/callback)
  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ??
    requestUrl.protocol.replace(":", "");
  const baseUrl =
    publicSiteUrl ||
    (forwardedHost ? `${forwardedProto}://${forwardedHost}` : origin);

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });

    if (!error) {
      return NextResponse.redirect(new URL(next, baseUrl).toString());
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=auth_callback_error", baseUrl).toString()
  );
}
