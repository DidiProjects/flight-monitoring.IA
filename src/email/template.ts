import type { FlightOffer } from '../types/index.ts';
import { formatDuration } from '../utils/dates.ts';

const AZUL_RESULTS = 'https://www.voeazul.com.br/br/pt/home/selecao-voo';

export function buildSearchUrl(
  origin: string,
  destination: string,
  date: string,
  passengers: number,
  currency: 'BRL' | 'PTS',
): string {
  const [year, month, day] = date.split('-');
  const std = `${month}/${day}/${year}`;
  return `${AZUL_RESULTS}?c[0].ds=${origin}&c[0].std=${std}&c[0].as=${destination}&p[0].t=ADT&p[0].c=${passengers}&p[0].cp=false&f.dl=3&f.dr=3&cc=${currency}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function fareRow(offer: FlightOffer, targetType: 'brl' | 'pts' | 'hyb'): string {
  if (targetType === 'brl' && offer.fares.brl) {
    return `R$ ${offer.fares.brl.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (targetType === 'pts' && offer.fares.points) {
    return `${offer.fares.points.amount.toLocaleString('pt-BR')} pontos`;
  }
  if (targetType === 'hyb' && offer.fares.hybrid) {
    return `${offer.fares.hybrid.points.toLocaleString('pt-BR')} pontos + R$ ${offer.fares.hybrid.cash.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }
  return '--';
}

function urlCurrency(type: 'brl' | 'pts' | 'hyb'): 'BRL' | 'PTS' {
  return type === 'brl' ? 'BRL' : 'PTS';
}

function offerBlock(offer: FlightOffer, targetType: 'brl' | 'pts' | 'hyb', passengers: number, label: string): string {
  const dep = offer.origin.timestamp.slice(11, 16);
  const arr = offer.destination.timestamp.slice(11, 16);
  const dur = offer.durationMin > 0 ? formatDuration(offer.durationMin) : '--';
  const stops = offer.stops === 0 ? 'Direto' : `${offer.stops} conexão${offer.stops > 1 ? 'ões' : ''}`;
  const url = buildSearchUrl(offer.origin.iata, offer.destination.iata, offer.date, passengers, urlCurrency(targetType));
  const fare = fareRow(offer, targetType);

  return `
    <div style="border:1px solid #e2e2e2;border-radius:6px;padding:20px;margin:16px 0;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#555;">
        ${label}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:4px 0;color:#888;width:110px;">Data</td>
          <td style="padding:4px 0;">${formatDate(offer.date)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#888;">Voo</td>
          <td style="padding:4px 0;">${offer.flightNumber}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#888;">Partida</td>
          <td style="padding:4px 0;">${dep} — ${offer.origin.iata}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#888;">Chegada</td>
          <td style="padding:4px 0;">${arr} — ${offer.destination.iata}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#888;">Duração</td>
          <td style="padding:4px 0;">${dur} &nbsp;|&nbsp; ${stops}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#888;">Tarifa</td>
          <td style="padding:4px 0;font-weight:600;">${fare}</td>
        </tr>
      </table>
      <p style="margin:16px 0 0;">
        <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:9px 18px;border-radius:4px;font-size:13px;">
          Ver passagens disponíveis
        </a>
      </p>
    </div>
  `;
}

function layout(title: string, subtitle: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e2e2;">
    <div style="background:#1a1a1a;padding:24px 28px;">
      <p style="margin:0;font-size:12px;color:#999;letter-spacing:.08em;text-transform:uppercase;">Azul Flight Tracker</p>
      <h1 style="margin:6px 0 0;font-size:20px;color:#fff;font-weight:600;">${title}</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.6;">${subtitle}</p>
      ${body}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #e2e2e2;background:#fafafa;">
      <p style="margin:0;font-size:12px;color:#aaa;">Mensagem automática gerada em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (BRT).</p>
    </div>
  </div>
</body>
</html>`;
}

export interface EmailContent {
  subject: string;
  html: string;
}

export function buildAlertEmail(
  offer: FlightOffer,
  origin: string,
  destination: string,
  targetType: 'brl' | 'pts' | 'hyb',
  passengers: number,
): EmailContent {
  const routeLabel = `${origin} → ${destination}`;
  const label = offer.isReturn
    ? `Volta  ${offer.origin.iata} → ${offer.destination.iata}`
    : `Ida  ${offer.origin.iata} → ${offer.destination.iata}`;

  const body = offerBlock(offer, targetType, passengers, label);
  const subject = `Azul — Tarifa disponível: ${routeLabel}`;
  const subtitle = `Encontramos a melhor passagem dentro do seu limite para a rota <strong>${routeLabel}</strong>.`;

  return { subject, html: layout(subject, subtitle, body) };
}

export function buildBestOfDayEmail(
  offer: FlightOffer,
  targetType: 'brl' | 'pts' | 'hyb',
  origin: string,
  destination: string,
  passengers: number,
): EmailContent {
  const routeLabel = `${origin} → ${destination}`;
  const label = offer.isReturn
    ? `Volta  ${offer.origin.iata} → ${offer.destination.iata}`
    : `Ida  ${offer.origin.iata} → ${offer.destination.iata}`;

  const body = offerBlock(offer, targetType, passengers, label);
  const subject = `Azul — Melhor tarifa do dia: ${routeLabel}`;
  const subtitle = `Nenhuma tarifa dentro do limite foi encontrada hoje. Este é o menor preço registrado nas buscas de ${new Date().toLocaleDateString('pt-BR')}.`;

  return { subject, html: layout(subject, subtitle, body) };
}
