import chalk from 'chalk';
import Table from 'cli-table3';
import { formatDuration } from '../utils/dates.ts';
import type { FlightOffer, SearchParams } from '../types/index.ts';

const CURRENCY_SYMBOLS: Record<string, string> = {
  BRL: 'R$',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
};

export function displayResults(params: SearchParams, results: FlightOffer[]): void {
  const threshold = params.target * (1 + params.margin);
  const currency = results[0]?.currency ?? 'BRL';
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;

  printHeader(params, threshold, symbol, currency);

  const outbound = results.filter(r => !r.isReturn);
  const returns = results.filter(r => r.isReturn);

  if (outbound.length > 0) {
    printTable(outbound, `Outbound  ${params.origin} -> ${params.destination}`, params.target, threshold, symbol);
  } else {
    console.log(chalk.yellow('  No outbound Azul flights found.\n'));
  }

  if (params.returnStart) {
    if (returns.length > 0) {
      printTable(returns, `Return  ${params.destination} -> ${params.origin}`, params.target, threshold, symbol);
    } else {
      console.log(chalk.yellow('  No return Azul flights found.\n'));
    }
  }

  printSummary(results);
}

function printHeader(params: SearchParams, threshold: number, symbol: string, currency: string): void {
  const bar = chalk.blue('─'.repeat(70));
  console.log(`\n${bar}`);
  console.log(chalk.bold.blue('  Azul Flight Price Tracker'));
  console.log(bar);
  console.log(`  Route      : ${chalk.bold(`${params.origin} -> ${params.destination}`)}`);
  console.log(
    `  Target     : ${chalk.bold.green(`${symbol} ${params.target.toLocaleString('pt-BR')}`)}` +
    `  |  Margin (${(params.margin * 100).toFixed(0)}%): ${chalk.yellow(`${symbol} ${threshold.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`)}`,
  );
  console.log(`  Passengers : ${params.passengers}`);

  if (currency !== 'BRL') {
    console.log(
      chalk.yellow(`\n  Note: Prices shown in ${chalk.bold(currency)}.`) +
      ' Run from Brazil to see BRL prices.',
    );
  }

  console.log();
}

function printTable(
  offers: FlightOffer[],
  title: string,
  target: number,
  threshold: number,
  symbol: string,
): void {
  console.log(chalk.bold.cyan(`  ${title}`));
  console.log();

  const table = new Table({
    head: [
      chalk.cyan('Date'),
      chalk.cyan('Flight'),
      chalk.cyan('Dep.'),
      chalk.cyan('Arr.'),
      chalk.cyan('Duration'),
      chalk.cyan('Stops'),
      chalk.cyan('Price'),
      chalk.cyan('Status'),
    ],
    style: { head: [], border: ['grey'] },
    colAligns: ['left', 'left', 'left', 'left', 'left', 'center', 'right', 'center'],
  });

  const sorted = [...offers].sort((a, b) =>
    a.date.localeCompare(b.date) || a.departure.localeCompare(b.departure),
  );

  for (const offer of sorted) {
    const [priceStr, statusStr] = formatPrice(offer.price, target, threshold, symbol);
    table.push([
      chalk.dim(offer.date),
      offer.flightNumber,
      offer.departure,
      offer.arrival,
      offer.durationMin > 0 ? formatDuration(offer.durationMin) : '--',
      String(offer.stops),
      priceStr,
      statusStr,
    ]);
  }

  console.log(table.toString());
  console.log();
}

function formatPrice(price: number, target: number, threshold: number, symbol: string): [string, string] {
  const formatted = `${symbol} ${price.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

  if (price <= target) {
    return [chalk.bold.green(formatted), chalk.bold.green('below target')];
  }
  if (price <= threshold) {
    return [chalk.yellow(formatted), chalk.yellow('within margin')];
  }
  return [chalk.dim(formatted), chalk.dim.red('above target')];
}

function printSummary(results: FlightOffer[]): void {
  const within = results.filter(r => r.withinTarget).length;
  console.log(
    chalk.grey('  ─'.repeat(35)) + '\n' +
    `  ${chalk.bold(results.length)} Azul flight(s) found  |  ` +
    chalk.bold.green(`${within}`) + ' within target / margin\n',
  );
}
