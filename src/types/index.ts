export interface SearchParams {
  origin: string;
  destination: string;
  target: number;
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
