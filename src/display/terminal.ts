import chalk from 'chalk';
import Table from 'cli-table3';
import { formatDuration } from '../utils/dates.ts';
import type { FlightOffer, SearchParams } from '../types/index.ts';

export function displayResults(params: SearchParams, results: FlightOffer[]): void {
  printHeader(params);

  const outbound = results.filter(r => !r.isReturn);
  const returns  = results.filter(r => r.isReturn);

  if (outbound.length > 0) {
    printTable(outbound, `Outbound  ${params.origin} → ${params.destination}`, params);
  } else {
    console.log(chalk.yellow('  No outbound Azul flights found.\n'));
  }

  if (params.returnStart) {
    if (returns.length > 0) {
      printTable(returns, `Return  ${params.destination} → ${params.origin}`, params);
    } else {
      console.log(chalk.yellow('  No return Azul flights found.\n'));
    }
  }

  printSummary(results);
}

function printHeader(params: SearchParams): void {
  const bar = chalk.blue('─'.repeat(80));
  console.log(`\n${bar}`);
  console.log(chalk.bold.blue('  Azul Flight Price Tracker'));
  console.log(bar);
  console.log(`  Route      : ${chalk.bold(`${params.origin} → ${params.destination}`)}`);
  const { targets, margin } = params;
  if (targets.brl != null) {
    const thr = targets.brl * (1 + margin);
    console.log(`  Target BRL : ${chalk.bold.green(`R$ ${targets.brl.toLocaleString('pt-BR')}`)}  |  Margem: ${chalk.yellow(`R$ ${thr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`)}`);
  }
  if (targets.pts != null) {
    const thr = Math.round(targets.pts * (1 + margin));
    console.log(`  Target PTS : ${chalk.bold.green(`${targets.pts.toLocaleString('pt-BR')} pts`)}  |  Margem: ${chalk.yellow(`${thr.toLocaleString('pt-BR')} pts`)}`);
  }
  if (targets.hybPts != null || targets.hybBrl != null) {
    const parts: string[] = [];
    if (targets.hybPts != null) {
      const thr = Math.round(targets.hybPts * (1 + margin));
      parts.push(`${chalk.bold.green(`${targets.hybPts.toLocaleString('pt-BR')} pts`)}  |  Margem: ${chalk.yellow(`${thr.toLocaleString('pt-BR')} pts`)}`);
    }
    if (targets.hybBrl != null) {
      const thr = targets.hybBrl * (1 + margin);
      parts.push(`${chalk.bold.green(`R$ ${targets.hybBrl.toLocaleString('pt-BR')}`)}  |  Margem: ${chalk.yellow(`R$ ${thr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`)}`);
    }
    console.log(`  Target HYB : ${parts.join('  +  ')}`);
  }
  console.log(`  Margin     : ${(margin * 100).toFixed(0)}%`);
  console.log(`  Passengers : ${params.passengers}`);
  console.log();
}

function printTable(
  offers: FlightOffer[],
  title: string,
  params: SearchParams,
): void {
  const { targets, margin } = params;
  const brlThreshold = targets.brl != null ? targets.brl * (1 + margin) : undefined;
  const ptsThreshold = targets.pts != null ? targets.pts * (1 + margin) : undefined;
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
    const brlAmt = o.fares.brl?.amount ?? 0;
    const brlStr = brlAmt > 0
      ? formatBrl(brlAmt, brlThreshold)
      : chalk.dim('--');

    const ptsAmt = o.fares.points?.amount ?? 0;
    const ptsStr = ptsAmt > 0
      ? formatPts(ptsAmt, ptsThreshold)
      : chalk.dim('--');

    const hybStr = o.fares.hybrid
      ? `${o.fares.hybrid.points.toLocaleString('pt-BR')}pts\n+ R$${o.fares.hybrid.cash.toLocaleString('pt-BR')}`
      : chalk.dim('--');

    const statusStr = o.withinTarget
      ? chalk.bold.green('ok')
      : chalk.dim.red('acima');

    table.push([
      chalk.dim(o.date),
      o.flightNumber,
      `${o.origin.timestamp.slice(11, 16)} ${o.origin.iata}`,
      `${o.destination.timestamp.slice(11, 16)} ${o.destination.iata}`,
      o.durationMin > 0 ? formatDuration(o.durationMin) : '--',
      String(o.stops),
      brlStr,
      ptsStr,
      hybStr,
      statusStr,
    ]);
  }

  console.log(table.toString());
  console.log();
}

function formatBrl(amount: number, threshold?: number): string {
  const s = `R$ ${amount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  if (threshold == null) return chalk.dim(s);
  if (amount <= threshold) return chalk.bold.green(s);
  return chalk.dim(s);
}

function formatPts(amount: number, threshold?: number): string {
  const s = `${amount.toLocaleString('pt-BR')} pts`;
  if (threshold == null) return chalk.dim(s);
  if (amount <= threshold) return chalk.bold.green(s);
  return chalk.dim(s);
}

function printSummary(results: FlightOffer[]): void {
  const within = results.filter(r => r.withinTarget).length;
  console.log(
    chalk.grey('  ─'.repeat(40)) + '\n' +
    `  ${chalk.bold(results.length)} voo(s) encontrado(s)  |  ` +
    chalk.bold.green(`${within}`) + ' dentro do target\n',
  );
}
