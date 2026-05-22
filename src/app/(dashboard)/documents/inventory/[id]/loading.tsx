// Мгновенный скелетон при открытии акта: страница итогов/формы тяжёлая
// (много запросов + подсказки), без этого навигация выглядит «зависшей».
export default function Loading() {
  return (
    <div className="w-full space-y-6 p-6 md:p-8">
      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
