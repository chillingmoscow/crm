/**
 * Модель оплаты разового сотрудника на смене — по должности смены, без
 * ручного выбора: его собственная модель, если она этой должности, иначе
 * единственная модель должности. Если моделей у должности несколько и ни
 * одна не его — однозначно выбрать нельзя, возвращаем null (форма спросит).
 */
export function casualPayModel({
  employeeModelId,
  roleName,
  models,
}: {
  employeeModelId: string | null | undefined;
  roleName: string | null | undefined;
  models: { id: string; role_name: string }[];
}): { id: string | null; options: { id: string; role_name: string }[] } {
  const options = roleName ? models.filter((m) => m.role_name === roleName) : [];
  const own = options.find((m) => m.id === employeeModelId);
  return { id: own?.id ?? (options.length === 1 ? options[0].id : null), options };
}
