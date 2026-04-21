import chalk from 'chalk';
import Table from 'cli-table3';
import { formatDuration } from '../utils/dates.ts';
import type { FlightOffer, SearchParams } from '../types/index.ts';

export function displayResults(params: SearchParams, results: FlightOffer[]): void {
  const threshold = params.target * (1 + params.margin);

  printHeader(params, threshold);

  const outbound = results.filter(r => !r.isReturn);
  const returns  = results.filter(r => r.isReturn);

  if (outbound.length > 0) {
    printTable(outbound, `Outbound  ${params.origin} → ${params.destination}`, params.target, threshold);
  } else {
    console.log(chalk.yellow('  No outbound Azul flights found.\n'));
  }

  if (params.returnStart) {
    if (returns.length > 0) {
      printTable(returns, `Return  ${params.destination} → ${params.origin}`, params.target, threshold);
    } else {
      console.log(chalk.yellow('  No return Azul flights found.\n'));
    }
  }

  printSummary(results);
}

function printHeader(params: SearchParams, threshold: number): void {
  const bar = chalk.blue('─'.repeat(80));
  console.log(`\n${bar}`);
  console.log(chalk.bold.blue('  Azul Flight Price Tracker'));
  console.log(bar);
  console.log(`  Route      : ${chalk.bold(`${params.origin} → ${params.destination}`)}`);
  console.log(
    `  Target     : ${chalk.bold.green(`R$ ${params.target.toLocaleString('pt-BR')}`)}` +
    `  |  Margin (${(params.margin * 100).toFixed(0)}%): ${chalk.yellow(`R$ ${threshold.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`)}`,
  );
  console.log(`  Passengers : ${params.passengers}`);
  console.log();
}

function printTable(
  offers: FlightOffer[],
  title: string,
  target: number,
  threshold: number,
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
      chalk.cyan('R$'),
      chalk.cyan('Pontos'),
      chalk.cyan('Híbrido'),
      chalk.cyan('Status'),
    ],
    style: { head: [], border: ['grey'] },
    colAligns: ['left', 'left', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'center'],
  });

  const sorted = [...offers].sort((a, b) =>
    a.origin.timestamp.localeCompare(b.origin.timestamp),
  );

  for (const o of sorted) {
    const brl = o.fares.brl?.amount ?? 0;
    const [priceStr, statusStr] = formatPrice(brl, target, threshold);

    const ptsStr = o.fares.points
      ? o.fares.points.amount.toLocaleString('pt-BR') + ' pts'
      : '--';

    const hybStr = o.fares.hybrid
      ? `${o.fares.hybrid.points.toLocaleString('pt-BR')}pts\n+ R$${o.fares.hybrid.cash.toLocaleString('pt-BR')}`
      : '--';

    table.push([
      chalk.dim(o.date),
      o.flightNumber,
      `${o.origin.timestamp.slice(11, 16)} ${o.origin.iata}`,
      `${o.destination.timestamp.slice(11, 16)} ${o.destination.iata}`,
      o.durationMin > 0 ? formatDuration(o.durationMin) : '--',
      String(o.stops),
      priceStr,
      ptsStr,
      hybStr,
      statusStr,
    ]);
  }

  console.log(table.toString());
  console.log();
}

function formatPrice(price: number, target: number, threshold: number): [string, string] {
  if (price <= 0) return [chalk.dim('--'), chalk.dim('--')];
  const formatted = `R$ ${price.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  if (price <= target)     return [chalk.bold.green(formatted), chalk.bold.green('abaixo')];
  if (price <= threshold)  return [chalk.yellow(formatted), chalk.yellow('na margem')];
  return [chalk.dim(formatted), chalk.dim.red('acima')];
}

function printSummary(results: FlightOffer[]): void {
  const within = results.filter(r => r.withinTarget).length;
  console.log(
    chalk.grey('  ─'.repeat(40)) + '\n' +
    `  ${chalk.bold(results.length)} voo(s) encontrado(s)  |  ` +
    chalk.bold.green(`${within}`) + ' dentro do target / margem\n',
  );
}
