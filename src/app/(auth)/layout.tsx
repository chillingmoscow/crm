export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ ["--font-auth-display" as string]: "Manrope, ui-sans-serif, system-ui, sans-serif" }}>
      {children}
    </div>
  );
}
