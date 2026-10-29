import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url: string, options: postgres.Options<Record<string, postgres.PostgresType>> = {}) {
  return drizzle(postgres(url, { max: 10, ...options }), { schema });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TenantScope = {
  businessId?: string;
  agencyId?: string;
  customerId?: string;
};

// One pool per process. Reused across hot reloads in development.
const globalForDb = globalThis as unknown as { db?: Db };

export function getDb(): Db {
  if (!globalForDb.db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.db = createDb(url);
  }
  return globalForDb.db;
}

/**
 * Runs `fn` in a transaction scoped to one tenant. Row-Level Security reads the
 * scope from transaction-local settings, so it cannot leak to the next request
 * that reuses the pooled connection. Queries outside withTenant see no tenant
 * rows at all.
 */
export async function withTenant<T>(
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.business_id', ${scope.businessId ?? ""}, true),
        set_config('app.agency_id', ${scope.agencyId ?? ""}, true),
        set_config('app.customer_id', ${scope.customerId ?? ""}, true)
    `);
    return fn(tx);
  });
}
