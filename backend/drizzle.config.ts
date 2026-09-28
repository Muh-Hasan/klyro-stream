import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
