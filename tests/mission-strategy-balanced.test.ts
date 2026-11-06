import { it } from 'vitest';
import { checkStrategy } from './helpers/strategyCheck';

it('the balanced strategy passes the connected missions and both unseen final variants', () => checkStrategy('balanced'), 120000);
