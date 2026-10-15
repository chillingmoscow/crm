const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
export const money = (n: number | null) =>
  n === null ? "—" : amount.format(n);
export const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
