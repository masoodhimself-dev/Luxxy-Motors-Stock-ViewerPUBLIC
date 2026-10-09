import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../../../lib/db/src/schema/index';
export const engine = new PGlite();
export const db = drizzle(engine, { schema });
export const pool = { query: (q: string, params?: unknown[]) => engine.query<Record<string, any>>(q, params), end: () => engine.close(), connect: async () => ({ query: (q: string, params?: unknown[]) => engine.query<Record<string, any>>(q, params), release() {} }) };
export * from '../../../../lib/db/src/schema/index';
