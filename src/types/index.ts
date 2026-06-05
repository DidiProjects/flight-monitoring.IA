export interface ScraperParams {
  origin: string;
  destination: string;
  outboundStart: string;
  outboundEnd?: string;
  returnStart?: string;
  returnEnd?: string;
  passengers: number;
  runDir: string;
  requestId?: string;
  routineId?: string;
  airline?: string;
}

export interface Fare {
  amount: number;
  currency: string;
}

export interface HybridFare {
  points: number;
  cash: number;
  currency: string;
}

export interface FlightFares {
  cash?: Fare;
  points?: Fare;
  hybrid?: HybridFare;
}

export interface AirportRef {
  iata: string;
  timestamp: string;
}

export interface FlightOffer {
  date: string;
  flightNumber: string;
  origin: AirportRef;
  destination: AirportRef;
  durationMin: number;
  stops: number;
  fares: FlightFares;
  isReturn: boolean;
}

export interface AirportCoverageItem {
  code: string;
  name: string;
  timezone: string;
  countryCode: string;
  countryName: string;
  city: string;
  region: string;
  currency?: string;
}

export interface CoveragePayload {
  airline: string;
  airports: AirportCoverageItem[];
}
