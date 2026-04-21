export interface Targets {
  brl?: number;
  pts?: number;
  hybPts?: number; // max points component of hybrid fare
  hybBrl?: number; // max cash component of hybrid fare (BRL)
}

export interface SearchParams {
  origin: string;
  destination: string;
  targets: Targets;
  margin: number;
  outboundStart: string;   // YYYY-MM-DD
  outboundEnd?: string;
  returnStart?: string;
  returnEnd?: string;
  passengers: number;
  verbose: boolean;
  runDir?: string;
}

export interface Fare {
  amount: number;
  currency: string; // "BRL" | "PTS"
}

export interface HybridFare {
  points: number;
  cash: number;
  currency: string; // "BRL"
}

export interface FlightFares {
  brl?: Fare;
  points?: Fare;
  hybrid?: HybridFare;
}

export interface AirportRef {
  iata: string;
  timestamp: string; // ISO 8601 with UTC offset: "2026-05-20T09:35:00+01:00"
}

export interface FlightOffer {
  date: string;            // YYYY-MM-DD
  flightNumber: string;
  origin: AirportRef;
  destination: AirportRef;
  durationMin: number;
  stops: number;
  fares: FlightFares;
  isReturn: boolean;
  withinTarget: boolean;
}

export function computeWithinTarget(offer: FlightOffer, targets: Targets, margin: number): boolean {
  const m = 1 + margin;
  if (targets.brl != null && offer.fares.brl && offer.fares.brl.amount <= targets.brl * m) return true;
  if (targets.pts != null && offer.fares.points && offer.fares.points.amount <= targets.pts * m) return true;
  if ((targets.hybPts != null || targets.hybBrl != null) && offer.fares.hybrid) {
    const h = offer.fares.hybrid;
    const ptsOk = targets.hybPts == null || h.points <= targets.hybPts * m;
    const brlOk = targets.hybBrl == null || h.cash   <= targets.hybBrl * m;
    if (ptsOk && brlOk) return true;
  }
  return false;
}
