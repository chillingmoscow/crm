export type LooseError = { message: string } | null;

export type LooseResult<T = unknown> = {
  data: T | null;
  error: LooseError;
  count?: number | null;
};

export type LooseQuery<T = unknown> = PromiseLike<LooseResult<T>> & {
  select: (columns?: string, options?: Record<string, unknown>) => LooseQuery<T>;
  eq: (column: string, value: unknown) => LooseQuery<T>;
  in: (column: string, values: unknown[]) => LooseQuery<T>;
  or: (filters: string) => LooseQuery<T>;
  order: (column: string, options?: Record<string, unknown>) => LooseQuery<T>;
  range: (from: number, to: number) => LooseQuery<T>;
  maybeSingle: () => Promise<LooseResult<T>>;
  single: () => Promise<LooseResult<T>>;
  insert: (values: unknown) => LooseQuery<T>;
  upsert: (values: unknown, options?: Record<string, unknown>) => LooseQuery<T>;
  update: (values: unknown) => LooseQuery<T>;
  delete: () => LooseQuery<T>;
};

export type LooseStorageBucket = {
  upload: (path: string, file: File, options?: Record<string, unknown>) => Promise<LooseResult<unknown>>;
  remove: (paths: string[]) => Promise<LooseResult<unknown>>;
  createSignedUrl: (path: string, expiresIn: number) => Promise<LooseResult<{ signedUrl: string }>>;
};

export type LooseDb = {
  from: <T = unknown>(table: string) => LooseQuery<T>;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<LooseResult<unknown>>;
  storage: { from: (bucket: string) => LooseStorageBucket };
};

export function asLooseDb(client: unknown): LooseDb {
  return client as LooseDb;
}
