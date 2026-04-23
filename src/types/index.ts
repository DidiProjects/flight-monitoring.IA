export interface ScraperParams {
  origin: string;
  destination: string;
  outboundStart: string;
  outboundEnd?: string;
  returnStart?: string;
  returnEnd?: string;
  passengers: number;
  runDir: string;
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
  brl?: Fare;
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
