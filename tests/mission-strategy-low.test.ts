import { it } from 'vitest';
import { checkStrategy } from './helpers/strategyCheck';

it('the low strategy passes the connected missions and both unseen final variants', () => checkStrategy('low'), 120000);
