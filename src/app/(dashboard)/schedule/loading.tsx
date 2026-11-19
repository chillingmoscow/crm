export default function Loading() {
  return (
    <div className="p-8 space-y-6 animate-pulse" aria-label="Загрузка расписания">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="h-10 rounded-md bg-muted" />
      <div className="h-[480px] rounded-xl bg-muted" />
    </div>
  );
}
