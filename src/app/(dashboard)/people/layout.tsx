// People block layout — passthrough for now.
// Stage 2+ will add a permission gate here (people.view_*).
export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
