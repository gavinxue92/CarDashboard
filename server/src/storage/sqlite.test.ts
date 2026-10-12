import { SqliteRepository } from './sqlite.js';
import { fixedClock } from '../domain/clock.js';
import { sequentialIds } from '../domain/ids.js';
import { defineRepositoryContract } from './testing/contract.js';

defineRepositoryContract('SqliteRepository', () =>
  new SqliteRepository({
    path: ':memory:',
    clock: fixedClock(1_700_000_000_000),
    ids: sequentialIds('s'),
  }),
);
