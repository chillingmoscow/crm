// CRM block layout — passthrough scaffold for now.
// Stage 5+ will add a permission gate (crm.view_*).
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
