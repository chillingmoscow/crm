export type ProvisionStep = {
  state: "prepared" | "started" | "done";
  id?: number;
  pin?: string;
};
export async function runProvisionStep({
  ledger,
  key,
  save,
  create,
  recover,
}: {
  ledger: Record<string, ProvisionStep>;
  key: string;
  save: () => Promise<void>;
  create: () => Promise<Record<string, unknown>>;
  recover: () => Promise<Record<string, unknown> | null>;
}) {
  const old = ledger[key];
  if (old?.state === "done" && old.id) return old.id;
  if (old?.state === "started") {
    const found = await recover();
    if (!found || !Number.isSafeInteger(found.id))
      throw new Error(
        `Шаг «${key}» не подтверждён. Проверьте запись в Quick Resto; повторное создание остановлено`,
      );
    ledger[key] = { ...old, state: "done", id: Number(found.id) };
    await save();
    return Number(found.id);
  }
  ledger[key] = { ...old, state: "started" };
  await save();
  const created = await create();
  if (!Number.isSafeInteger(created.id))
    throw new Error("Quick Resto не подтвердил создание записи");
  ledger[key] = { ...ledger[key], state: "done", id: Number(created.id) };
  await save();
  return Number(created.id);
}
