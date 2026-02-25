import type { NextConfig } from "next";

// Derive the Supabase storage hostname from the env var
// so images from the self-hosted Supabase instance are allowed.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const supabaseHostname = new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Self-hosted Supabase storage (production)
      { protocol: "https", hostname: supabaseHostname },
      // Local Supabase dev instance
      { protocol: "http",  hostname: "localhost" },
      { protocol: "http",  hostname: "127.0.0.1" },
      // Common OAuth avatar providers
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
