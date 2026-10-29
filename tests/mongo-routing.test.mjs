import { afterEach, describe, expect, it, vi } from 'vitest';
import { storageKind } from '../server/store.mjs';

afterEach(() => vi.unstubAllEnvs());

describe('MongoDB environment selection', () => {
  it('uses DevX Control MONGO_URI even when an old Postgres URL remains', () => {
    vi.stubEnv('MONGO_URI', 'mongodb+srv://cluster/example');
    vi.stubEnv('MONGODB_URI', '');
    vi.stubEnv('MONGO_URL', '');
    vi.stubEnv('DATABASE_URL', 'postgres://old-database');
    vi.stubEnv('POSTGRES_URL', '');
    expect(storageKind()).toBe('mongo');
  });

  it('supports the MONGODB_URI and MONGO_URL aliases', () => {
    for (const variable of ['MONGODB_URI', 'MONGO_URL']) {
      vi.stubEnv('MONGO_URI', '');
      vi.stubEnv('MONGODB_URI', '');
      vi.stubEnv('MONGO_URL', '');
      vi.stubEnv(variable, 'mongodb://localhost/exotic_cars');
      expect(storageKind()).toBe('mongo');
    }
  });

  it('supports MongoDB in DATABASE_URL and preserves Postgres selection otherwise', () => {
    vi.stubEnv('MONGO_URI', '');
    vi.stubEnv('MONGODB_URI', '');
    vi.stubEnv('MONGO_URL', '');
    vi.stubEnv('DATABASE_URL', 'mongodb://localhost/exotic_cars');
    vi.stubEnv('POSTGRES_URL', '');
    expect(storageKind()).toBe('mongo');
    vi.stubEnv('DATABASE_URL', 'postgres://legacy-database');
    expect(storageKind()).toBe('postgres');
  });
});
