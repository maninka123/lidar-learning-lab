import { it } from 'vitest';
import { checkStrategy } from './helpers/strategyCheck';

it('the high strategy passes the connected missions and both unseen final variants', () => checkStrategy('high'), 120000);
