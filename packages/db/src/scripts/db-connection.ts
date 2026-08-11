// Shared connection config for admin/migration scripts (db-setup, baseline,
// db-reset) and drizzle.config. These run DDL, advisory locks and drizzle-kit
// migrate, none of which are safe over Supabase's transaction pooler (6543), so
// they must use the DIRECT / session connection (port 5432). Runtime services use
// the pooled DATABASE_URL instead (see ../drizzle.ts).

/** Direct (5432) connection string for migrations/DDL, falling back to the runtime URL. */
export function getDirectConnectionString(): string {
  return process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';
}

/** SSL setting for the `postgres` client. Required for Supabase; `DATABASE_SSL=disable`
 * turns it off for a plain local Postgres only. */
export function getPostgresSsl(): 'require' | false {
  return process.env.DATABASE_SSL === 'disable' ? false : 'require';
}
