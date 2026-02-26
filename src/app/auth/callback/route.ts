import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams, origin } = requestUrl;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") ? rawNext : "/dashboard";

  // Behind reverse proxies request.url can contain internal host (e.g. localhost:3000).
  // Prefer explicit public site URL for stable redirects from email links.
  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ??
    requestUrl.protocol.replace(":", "");
  const baseUrl =
    publicSiteUrl ||
    (forwardedHost ? `${forwardedProto}://${forwardedHost}` : origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, baseUrl).toString());
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=auth_callback_error", baseUrl).toString()
  );
}
