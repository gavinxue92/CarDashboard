import { MemoryRepository } from './memory.js';
import { fixedClock } from '../domain/clock.js';
import { sequentialIds } from '../domain/ids.js';
import { defineRepositoryContract } from './testing/contract.js';

defineRepositoryContract('MemoryRepository', () =>
  new MemoryRepository(fixedClock(1_700_000_000_000), sequentialIds('m')),
);
