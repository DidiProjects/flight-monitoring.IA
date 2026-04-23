import type { FlightOffer } from './index.ts';

export interface ScrapeRequest {
  requestId: string;
  origin: string;
  destination: string;
  outboundStart: string;
  outboundEnd: string;
  returnStart?: string;
  returnEnd?: string;
  passengers: number;
}

export interface ScrapeResult {
  requestId: string;
  origin: string;
  destination: string;
  flights: FlightOffer[];
  scrapedAt: string;
  error?: string;
}
