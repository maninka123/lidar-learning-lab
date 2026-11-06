import { it } from 'vitest';
import { checkStrategy } from './helpers/strategyCheck';

it('a poor strategy fails for understandable reasons', () => checkStrategy('poor'), 120000);
