// Finance block layout — passthrough scaffold for now.
// Stage 3+ will add a permission gate (finance.view_*) and a
// LegalEntitySwitcher in the header.
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
