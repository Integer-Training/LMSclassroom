import 'dotenv/config';

import { SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

// import * as schema from './schema';

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';

type DatabaseClient = ReturnType<typeof drizzle>;

const globalDatabase = globalThis as typeof globalThis & {
  __cioDatabaseClient?: Sql;
  __cioDb?: DatabaseClient;
};

// Runtime connects over the Supabase transaction pooler (port 6543), which runs
// in transaction mode and does NOT support prepared statements — hence
// `prepare: false`. SSL is required for Supabase; `DATABASE_SSL=disable` is an
// escape hatch for a plain local Postgres only.
function createDatabaseClient() {
  return postgres(connectionString, {
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10) || 5,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    prepare: false,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require'
  });
}

const databaseClient = globalDatabase.__cioDatabaseClient ?? createDatabaseClient();

if (process.env.NODE_ENV !== 'production') {
  globalDatabase.__cioDatabaseClient = databaseClient;
}

export const db = globalDatabase.__cioDb ?? drizzle(databaseClient);

if (process.env.NODE_ENV !== 'production') {
  globalDatabase.__cioDb = db;
}

export type DbClient = typeof db;
export type TxClient = Parameters<typeof db.transaction>[0] extends (tx: infer T) => any ? T : never;
export type DbOrTxClient = DbClient | TxClient;

/**
 * Run `fn` in a single DB transaction, passing it the tx client. The one place a transaction boundary is
 * opened for the service layer (PearlLMS Phase 5): a completion write must be atomic with the result that
 * completes the course, and the rule must read-your-writes inside the tx to see that just-recorded result.
 * Thin + isolated so a unit test can mock this to a passthrough without mocking the whole drizzle module.
 */
export function runInTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export * from 'drizzle-orm';
export * from './schema';

/**
 * Creates a SQL expression that returns the length of a JSON array column
 *
 * @param column The column containing the JSON array
 * @returns A SQL expression that can be used in where clauses
 */
function jsonArrayLength(column: any) {
  // Create a SQL expression using Drizzle's sql template literal
  const sqlExpression = sql`jsonb_array_length(${column})`;

  // Return an object with utility methods for comparison operations
  return {
    // Check if array length equals a specific value
    equals: (length: number): SQL<unknown> => {
      return sql`${sqlExpression} = ${length}`;
    },
    // Check if array length is greater than a specific value
    gt: (length: number): SQL<unknown> => {
      return sql`${sqlExpression} > ${length}`;
    },
    // Check if array length is less than a specific value
    lt: (length: number): SQL<unknown> => {
      return sql`${sqlExpression} < ${length}`;
    },
    // Check if array length is greater than or equal to a specific value
    gte: (length: number): SQL<unknown> => {
      return sql`${sqlExpression} >= ${length}`;
    },
    // Check if array length is less than or equal to a specific value
    lte: (length: number): SQL<unknown> => {
      return sql`${sqlExpression} <= ${length}`;
    }
  };
}

const explainAnalyze = async (d: typeof db, query: any) => {
  console.log(query.sql);
  const debugResult = await d.execute(sql`EXPLAIN ANALYZE ${query}`);
  console.debug(debugResult);
  return query;
};

export { explainAnalyze, jsonArrayLength };
