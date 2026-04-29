export const AIRPORT_TZ: Record<string, string> = {
  // Brazil BRT -03:00
  GRU: '-03:00', CGH: '-03:00', VCP: '-03:00', GIG: '-03:00',
  SDU: '-03:00', BSB: '-03:00', CNF: '-03:00', PLU: '-03:00',
  SSA: '-03:00', FOR: '-03:00', REC: '-03:00', NAT: '-03:00',
  MCZ: '-03:00', POA: '-03:00', FLN: '-03:00', CWB: '-03:00',
  VIX: '-03:00', BEL: '-03:00', SLZ: '-03:00', JPA: '-03:00',
  AJU: '-03:00', THE: '-03:00', PMW: '-03:00', CXJ: '-03:00',
  // Brazil AMT -04:00
  CGB: '-04:00', MAO: '-04:00',
  // Portugal WEST +01:00 (summer)
  LIS: '+01:00', OPO: '+01:00', FAO: '+01:00',
  // Europe CEST +02:00 (summer)
  MAD: '+02:00', BCN: '+02:00', CDG: '+02:00', AMS: '+02:00',
  FCO: '+02:00', MXP: '+02:00', FRA: '+02:00', ZRH: '+02:00',
  // UK BST +01:00 (summer)
  LHR: '+01:00', LGW: '+01:00', MAN: '+01:00',
  // USA EDT -04:00
  MIA: '-04:00', JFK: '-04:00', MCO: '-04:00', FLL: '-04:00',
  EWR: '-04:00', BOS: '-04:00', ATL: '-04:00',
  // USA PDT -07:00
  LAX: '-07:00', SFO: '-07:00',
};

export function toTimestamp(date: string, time: string, iata: string): string {
  const tz = AIRPORT_TZ[iata] ?? '+00:00';
  const [h, m] = time.split(':');
  const padded = `${(h ?? '0').padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
  return `${date}T${padded}:00${tz}`;
}
