// Org block layout — passthrough for now.
// Stage 2+ will add a permission gate here (org.view_*).
export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
