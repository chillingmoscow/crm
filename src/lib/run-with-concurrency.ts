/** Bounded-concurrency runner: пробегается по `items`, выполняя `worker`
 *  не более `limit` штук одновременно. Возвращается, когда все workers
 *  отработали.
 *
 *  Используется когда нельзя ни сделать sequential `for await` (слишком
 *  медленно), ни запустить `Promise.all` (исчерпывает Supabase/PgBouncer
 *  pool на больших N). Типичный кейс: bulk-save N записей по одному RPC.
 *
 *  Если `worker` бросает — promise возвращается rejected, остальные
 *  worker'ы завершают текущую итерацию и не подхватывают новых. Caller
 *  получает первую ошибку. (Использовать try/catch внутри worker'а если
 *  нужен «best effort».)
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]!);
      }
    },
  );
  await Promise.all(runners);
}
