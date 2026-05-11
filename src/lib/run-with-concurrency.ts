/** Bounded-concurrency runner: пробегается по `items`, выполняя `worker`
 *  не более `limit` штук одновременно. Возвращается, когда все workers
 *  отработали.
 *
 *  Используется когда нельзя ни сделать sequential `for await` (слишком
 *  медленно), ни запустить `Promise.all` (исчерпывает Supabase/PgBouncer
 *  pool на больших N). Типичный кейс: bulk-save N записей по одному RPC.
 *
 *  **Abort-on-throw semantics**: если worker бросает (например, fetch-
 *  failure внутри supabase.rpc), общий `aborted`-флаг устанавливается
 *  немедленно. Остальные runner'ы завершают свой **текущий** item, но
 *  **больше не подхватывают** новые из очереди. Caller получает первую
 *  возникшую ошибку через rejected promise. Это совпадает с поведением
 *  serial `for await` — оригинальный код останавливался на первой
 *  failing record.
 *
 *  Если нужен «best effort» (партиальные сбои не должны прерывать
 *  обработку остальных) — оборачивай тело worker'а в try/catch и не
 *  re-throw'ай, а собирай ошибки в side-array. См. notion-import как
 *  пример.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  let aborted = false;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (!aborted && nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          await worker(items[index]!);
        } catch (err) {
          aborted = true;
          throw err;
        }
      }
    },
  );
  await Promise.all(runners);
}
