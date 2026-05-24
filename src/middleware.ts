import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Exclude: Next.js internals, static assets, API routes, and static HTML files.
    // API routes handle auth themselves; HTML files must be publicly accessible
    // (GoTrue fetches email templates from /public/email-templates/).
    // sw.js / manifest.webmanifest must be public too: the service worker
    // script and the PWA manifest are fetched WITHOUT auth cookies (the
    // manifest <link> is anonymous by default), so routing them through the
    // session middleware 307-redirects them to /login and breaks Web Push /
    // PWA install.
    "/((?!_next/static|_next/image|favicon.ico|api/|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
