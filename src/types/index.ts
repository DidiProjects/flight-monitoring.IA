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
}

export interface FlightOffer {
  date: string;
  origin: string;
  destination: string;
  flightNumber: string;
  departure: string;   // "HH:MM"
  arrival: string;     // "HH:MM"
  durationMin: number;
  stops: number;
  price: number;
  currency: string;
  isReturn: boolean;
  withinTarget: boolean;
}

export interface RawFlight {
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  durationMin?: number;
  stops?: number;
  price?: number;
  currency?: string;
}
