const AIRPORT_TZ: Record<string, string> = {
  // Brazil BRT America/Sao_Paulo
  GRU: 'America/Sao_Paulo', CGH: 'America/Sao_Paulo', VCP: 'America/Sao_Paulo',
  GIG: 'America/Sao_Paulo', SDU: 'America/Sao_Paulo', BSB: 'America/Sao_Paulo',
  CNF: 'America/Sao_Paulo', PLU: 'America/Sao_Paulo', SSA: 'America/Sao_Paulo',
  FOR: 'America/Fortaleza',  REC: 'America/Recife',    NAT: 'America/Fortaleza',
  MCZ: 'America/Maceio',    POA: 'America/Sao_Paulo', FLN: 'America/Sao_Paulo',
  CWB: 'America/Sao_Paulo', VIX: 'America/Sao_Paulo', BEL: 'America/Belem',
  SLZ: 'America/Fortaleza', JPA: 'America/Fortaleza', AJU: 'America/Maceio',
  THE: 'America/Fortaleza', PMW: 'America/Araguaina', CXJ: 'America/Sao_Paulo',
  // Brazil AMT
  CGB: 'America/Cuiaba', MAO: 'America/Manaus',
  // Portugal
  LIS: 'Europe/Lisbon', OPO: 'Europe/Lisbon', FAO: 'Europe/Lisbon',
  // Europe
  MAD: 'Europe/Madrid',      BCN: 'Europe/Madrid',      CDG: 'Europe/Paris',
  AMS: 'Europe/Amsterdam',   FCO: 'Europe/Rome',        MXP: 'Europe/Rome',
  FRA: 'Europe/Berlin',      ZRH: 'Europe/Zurich',
  // UK
  LHR: 'Europe/London', LGW: 'Europe/London', MAN: 'Europe/London',
  LON: 'Europe/London', EDI: 'Europe/London', BHX: 'Europe/London', LCY: 'Europe/London',
  // Middle East / Asia
  DXB: 'Asia/Dubai',          AUH: 'Asia/Dubai',
  DOH: 'Asia/Qatar',
  BKK: 'Asia/Bangkok',        DMK: 'Asia/Bangkok',
  SIN: 'Asia/Singapore',
  HKG: 'Asia/Hong_Kong',
  NRT: 'Asia/Tokyo',          HND: 'Asia/Tokyo',
  ICN: 'Asia/Seoul',
  KUL: 'Asia/Kuala_Lumpur',
  // Africa
  JNB: 'Africa/Johannesburg', CPT: 'Africa/Johannesburg',
  NBO: 'Africa/Nairobi',      ADD: 'Africa/Addis_Ababa',
  CAI: 'Africa/Cairo',        CMN: 'Africa/Casablanca',
  // Oceania
  SYD: 'Australia/Sydney',    MEL: 'Australia/Melbourne',
  // North America additions
  ORD: 'America/Chicago',     DFW: 'America/Chicago',
  DEN: 'America/Denver',      PHX: 'America/Phoenix',
  SEA: 'America/Los_Angeles', LAS: 'America/Los_Angeles',
  YYZ: 'America/Toronto',     YVR: 'America/Vancouver',
  // Europe additions
  DUB: 'Europe/Dublin',       GVA: 'Europe/Zurich',
  VIE: 'Europe/Vienna',       PRG: 'Europe/Prague',
  WAW: 'Europe/Warsaw',       BUD: 'Europe/Budapest',
  HEL: 'Europe/Helsinki',     OSL: 'Europe/Oslo',
  CPH: 'Europe/Copenhagen',   ARN: 'Europe/Stockholm',
  ATH: 'Europe/Athens',       IST: 'Europe/Istanbul',
  // USA East
  MIA: 'America/New_York', JFK: 'America/New_York', MCO: 'America/New_York',
  FLL: 'America/New_York', EWR: 'America/New_York', BOS: 'America/New_York',
  ATL: 'America/New_York',
  // USA West
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles',
};

function ianaOffsetFor(ianaZone: string, date: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: ianaZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  if (raw === 'GMT') return '+00:00';
  const sign = raw.includes('-') ? '-' : '+';
  const [hh, mm = '0'] = raw.replace('GMT', '').replace(/[+-]/, '').split(':');
  return `${sign}${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
}

export function toTimestamp(date: string, time: string, iata: string): string {
  const zone = AIRPORT_TZ[iata];
  const [h, m] = time.split(':');
  const padded = `${(h ?? '0').padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
  const tz = zone ? ianaOffsetFor(zone, new Date(`${date}T${padded}:00`)) : '+00:00';
  return `${date}T${padded}:00${tz}`;
}
