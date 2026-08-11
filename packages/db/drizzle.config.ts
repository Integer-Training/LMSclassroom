import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

// drizzle-kit migrate runs over the DIRECT (5432) connection — Supabase's
// transaction pooler (6543) can't run migrations. SSL is required for Supabase
// (disable only for a plain local Postgres via DATABASE_SSL=disable).
const directUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!;

export default defineConfig({
  schema: './src/schema.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: directUrl,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require'
  }
});
