/** Checked 2026-11-04. Generic simulator categories are educational estimates, never vendor quotations. */
export const USD_PER_CREDIT = 5;
/** The challenge counts in credits internally; students see dollars. */
export const usd = (credits: number) => `$${Math.round(credits * USD_PER_CREDIT).toLocaleString('en-US')}`;
export interface PriceReference { kind: 'Published indicative price' | 'Estimated educational price' | 'Rental / survey service' | 'Simulation-only item'; usd: number; source?: string; sourceTitle?: string; checked: string; note: string }
const estimate = (usd: number, note = 'Generic technology-class estimate; no verified vendor quotation.'): PriceReference => ({ kind: 'Estimated educational price', usd, checked: '2026-11-04', note });
export const PRICING: Record<string, PriceReference> = {
  rot16: estimate(1000), rot32: estimate(2000), rot128: estimate(5000), hdl64: estimate(4000), avia: estimate(2500), mobile32: estimate(2000, 'Head only; the simulated mobile platform is charged separately.'),
  mid360: { kind: 'Published indicative price', usd: 749, source: 'https://www.livoxtech.com/mobile/de/news/mid360_launch', sourceTitle: 'Livox manufacturer launch announcement', checked: '2026-11-04', note: 'Published launch sample price, not a current binding quote. Sensor behaviour is simplified in this simulator.' },
  tls: { kind: 'Published indicative price', usd: 26500, source: 'https://shop.leica-geosystems.com/reality-capture/blk360/buy', sourceTitle: 'Leica BLK360 official shop', checked: '2026-11-04', note: 'Reference commercial TLS price; the simulated TLS is not a validated BLK360 model.' },
  'tls-hire': { kind: 'Rental / survey service', usd: 2250, checked: '2026-11-04', note: 'Educational service estimate per fixed survey station. Maximum two hired stations; repeated practice replays those station measurements. No vendor rental quote.' },
  'cam-basic': estimate(200), 'cam-mid': estimate(550), 'cam-high': estimate(1625), 'cam-wide': estimate(650), 'cam-lowlight': estimate(1250),
  light: { kind: 'Simulation-only item', usd: 225, checked: '2026-11-04', note: 'Simplified area lighting accessory, no specific commercial product.' },
};
