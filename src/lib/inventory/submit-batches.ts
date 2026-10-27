export type InventorySubmissionResult = {
  resultsHasLineAmounts: boolean;
  refreshDocument?: boolean;
  pendingItems?: number;
  nextBaseLastUpdateDate?: string | null;
  error: string | null;
};

/** Keep the device draft until every chunk is confirmed by the server. */
export async function submitInventoryBatches<T extends { baseLastUpdateDate: string | null }>(
  input: T,
  submit: (input: T & { supportsBatches: true }) => Promise<InventorySubmissionResult>,
): Promise<InventorySubmissionResult> {
  let remaining = Infinity;
  let baseLastUpdateDate = input.baseLastUpdateDate;
  for (;;) {
    const result = await submit({ ...input, baseLastUpdateDate, supportsBatches: true });
    if (result.error || result.refreshDocument || !result.pendingItems) return result;
    if (!Number.isInteger(result.pendingItems) || result.pendingItems < 0 ||
        result.pendingItems >= remaining || result.nextBaseLastUpdateDate === undefined) {
      return {
        resultsHasLineAmounts: false,
        error: "Quick Resto пока не подтвердил сохранение части позиций. Черновик сохранён на устройстве. Подождите и повторите отправку.",
      };
    }
    remaining = result.pendingItems;
    baseLastUpdateDate = result.nextBaseLastUpdateDate;
  }
}
