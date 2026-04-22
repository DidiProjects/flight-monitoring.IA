import 'dotenv/config';
import { Command } from 'commander';
import ora from 'ora';
import { searchFlights } from './scrapers/azul.ts';
import { displayResults, printBestResults } from './display/terminal.ts';
import { setLogLevel, logger } from './utils/logger.ts';
import { createRun, saveResults, pruneOldRuns } from './utils/runs.ts';
import { computeWithinTarget } from './types/index.ts';
import type { SearchParams, Targets, FlightOffer } from './types/index.ts';
import {
  loadState, saveState, todayStr,
  incrementRun, updateBestOffers,
  hasOfferImproved, markEmailed,
  bestOfDayAlreadySent, markBestOfDaySent,
  getOffersWithinTarget, pickBestOffer,
} from './state/tracker.ts';
import { buildAlertEmail, buildBestOfDayEmail } from './email/template.ts';
import { sendEmail } from './email/sender.ts';

const env = process.env;

const program = new Command();

program
  .name('flight-tracker')
  .description('Azul Airlines flight price tracker')
  .version('1.0.0')
  .option('-o, --origin <IATA>',               'Origin airport code',                                   env['FLIGHT_ORIGIN'])
  .option('-d, --destination <IATA>',           'Destination airport code',                              env['FLIGHT_DESTINATION'])
  .option('--target-brl <number>',              'Target price in BRL',                parseFloat,        env['FLIGHT_TARGET_BRL'] ? parseFloat(env['FLIGHT_TARGET_BRL']) : undefined)
  .option('--target-pts <number>',              'Target price in points',             parseFloat,        env['FLIGHT_TARGET_PTS'] ? parseFloat(env['FLIGHT_TARGET_PTS']) : undefined)
  .option('--target-hyb-pts <number>',          'Target hybrid: max points component', parseFloat,       env['FLIGHT_TARGET_HYB_PTS'] ? parseFloat(env['FLIGHT_TARGET_HYB_PTS']) : undefined)
  .option('--target-hyb-brl <number>',          'Target hybrid: max cash component',   parseFloat,       env['FLIGHT_TARGET_HYB_BRL'] ? parseFloat(env['FLIGHT_TARGET_HYB_BRL']) : undefined)
  .option('-s, --outbound-start <YYYY-MM-DD>',  'Outbound search start date',                            env['FLIGHT_OUTBOUND_START'])
  .option('-e, --outbound-end <YYYY-MM-DD>',    'Outbound search end date (inclusive)',                  env['FLIGHT_OUTBOUND_END'])
  .option('-m, --margin <decimal>',             'Margin above target (e.g. 0.1 = 10%)', parseFloat,     env['FLIGHT_MARGIN'] ? parseFloat(env['FLIGHT_MARGIN']) : 0.1)
  .option('--return-start <YYYY-MM-DD>',        'Return search start date',                              env['FLIGHT_RETURN_START'])
  .option('--return-end <YYYY-MM-DD>',          'Return search end date (inclusive)',                    env['FLIGHT_RETURN_END'])
  .option('-p, --passengers <number>',          'Number of adult passengers',    parseInt,              env['FLIGHT_PASSENGERS'] ? parseInt(env['FLIGHT_PASSENGERS']) : 1)
  .option('-v, --verbose',                      'Enable verbose debug output',                           env['FLIGHT_VERBOSE'] === 'true')
  .parse(process.argv);

const opts = program.opts<{
  origin?: string;
  destination?: string;
  targetBrl?: number;
  targetPts?: number;
  targetHybPts?: number;
  targetHybBrl?: number;
  margin: number;
  outboundStart?: string;
  outboundEnd?: string;
  returnStart?: string;
  returnEnd?: string;
  passengers: number;
  verbose: boolean;
}>();

const orUndef = (v?: number) => (v != null && v > 0 ? v : undefined);

const targets: Targets = {
  brl:    orUndef(opts.targetBrl),
  pts:    orUndef(opts.targetPts),
  hybPts: orUndef(opts.targetHybPts),
  hybBrl: orUndef(opts.targetHybBrl),
};

const missing: string[] = [];
if (!opts.origin)       missing.push('--origin / FLIGHT_ORIGIN');
if (!opts.destination)  missing.push('--destination / FLIGHT_DESTINATION');
if (!opts.outboundStart) missing.push('--outbound-start / FLIGHT_OUTBOUND_START');
if (targets.brl == null && targets.pts == null && targets.hybPts == null && targets.hybBrl == null) {
  missing.push('at least one of --target-brl / --target-pts / --target-hyb');
}

if (missing.length > 0) {
  console.error(`Missing required parameters:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

setLogLevel(opts.verbose);

const params: SearchParams = {
  origin:        opts.origin!.toUpperCase(),
  destination:   opts.destination!.toUpperCase(),
  targets,
  margin:        opts.margin,
  outboundStart: opts.outboundStart!,
  outboundEnd:   opts.outboundEnd,
  returnStart:   opts.returnStart,
  returnEnd:     opts.returnEnd,
  passengers:    opts.passengers,
  verbose:       opts.verbose,
};

// ── Date validation ───────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

if (params.outboundEnd && params.outboundEnd < today) {
  console.log(`Outbound search window ended on ${params.outboundEnd}. Exiting.`);
  process.exit(0);
}

if (params.returnEnd && params.returnEnd < today) {
  console.log(`Return search window ended on ${params.returnEnd}. Exiting.`);
  process.exit(0);
}

if (params.outboundStart < today) {
  params.outboundStart = today;
}

if (params.returnStart && params.returnStart < today) {
  params.returnStart = today;
}

// ── Run ───────────────────────────────────────────────────────────────────────

const run = await createRun(params);
const searchParams: SearchParams = { ...params, runDir: run.dir };

const spinner = ora({
  text: `Searching Azul flights ${params.origin} → ${params.destination}…`,
  color: 'cyan',
}).start();

try {
  run.log('Starting search');
  const results = await searchFlights(searchParams);
  spinner.stop();

  // Compute withinTarget for each offer
  results.forEach(o => { o.withinTarget = computeWithinTarget(o, targets, params.margin); });

  run.log(`Search complete, ${results.length} offer(s) found`);
  await saveResults(run, params, results);

  // Always load + update state so accumulated best is available for display
  const today = todayStr();
  const state = await loadState();
  updateBestOffers(state, today, results, targets);

  if (results.length === 0) {
    console.log('\n  No Azul flights found for the given parameters.\n');
  } else {
    displayResults(params, results);
    const dayState = state.days[today];
    if (dayState) {
      printBestResults(params, dayState.best.outbound, dayState.best.return);
    }
  }

  // ── Email logic ─────────────────────────────────────────────────────────────
  const emailEnabled = env['EMAIL_ENABLED'] === 'true';

  if (!emailEnabled) {
    logger.info('Email: desabilitado');
  } else if (results.length === 0) {
    logger.info('Email: não enviado — nenhum voo encontrado');
  } else {
    const runCount = incrementRun(state, today);

    const hasReturn = params.returnStart != null;
    const outboundResults = results.filter(o => !o.isReturn);
    const returnResults   = results.filter(o => o.isReturn);

    const outboundWithin = getOffersWithinTarget(outboundResults, targets, params.margin);
    const returnWithin   = hasReturn ? getOffersWithinTarget(returnResults, targets, params.margin) : [];

    const canAlert = outboundWithin.length > 0 || (hasReturn && returnWithin.length > 0);

    if (canAlert) {
      const m = 1 + params.margin;
      const allWithin = [...outboundWithin, ...returnWithin];
      const matchedType: 'brl' | 'pts' | 'hyb' =
        allWithin.some(o => targets.brl != null && o.fares.brl && o.fares.brl.amount <= targets.brl * m) ? 'brl' :
        allWithin.some(o => targets.pts != null && o.fares.points && o.fares.points.amount <= targets.pts * m) ? 'pts' :
        'hyb';

      const pickBest = (offers: FlightOffer[]) => offers.reduce((best, o) => {
        const val = (x: typeof o) =>
          matchedType === 'brl' ? (x.fares.brl?.amount ?? Infinity) :
          matchedType === 'pts' ? (x.fares.points?.amount ?? Infinity) :
          (x.fares.hybrid?.points ?? Infinity);
        return val(o) < val(best) ? o : best;
      });

      const getAmount = (o: FlightOffer) =>
        matchedType === 'brl' ? (o.fares.brl?.amount ?? Infinity) :
        matchedType === 'pts' ? (o.fares.points?.amount ?? Infinity) :
        (o.fares.hybrid?.points ?? Infinity);

      const bestOutbound = outboundWithin.length > 0 ? pickBest(outboundWithin) : undefined;
      const bestReturn   = returnWithin.length > 0   ? pickBest(returnWithin)   : undefined;

      const outboundAmount = bestOutbound ? getAmount(bestOutbound) : undefined;
      const returnAmount   = bestReturn   ? getAmount(bestReturn)   : undefined;

      if (hasOfferImproved(state, today, outboundAmount, returnAmount)) {
        const { subject, html } = buildAlertEmail(
          bestOutbound,
          bestReturn,
          params.origin,
          params.destination,
          matchedType,
          params.passengers,
        );
        await sendEmail(subject, html);
        markEmailed(state, today, outboundAmount, returnAmount, matchedType);
        run.log(`Alert email sent — ${matchedType.toUpperCase()}${bestOutbound ? ` outbound: ${bestOutbound.date} ${bestOutbound.flightNumber}` : ''}${bestReturn ? ` / return: ${bestReturn.date} ${bestReturn.flightNumber}` : ''}`);
        logger.info({
          type: matchedType,
          outbound: bestOutbound ? `${bestOutbound.flightNumber} ${bestOutbound.date} (${outboundAmount})` : undefined,
          return:   bestReturn   ? `${bestReturn.flightNumber} ${bestReturn.date} (${returnAmount})`       : undefined,
        }, 'Email: alerta enviado');
      } else {
        const prev = state.days[today]?.lastEmailed;
        logger.info({
          type: matchedType,
          outbound: { atual: outboundAmount, emailed: prev?.outbound },
          return:   { atual: returnAmount,   emailed: prev?.return },
        }, 'Email: sem melhora, não enviado');
      }

    } else {
      // No flights within target — log best prices found vs thresholds
      const bestOf = (offers: FlightOffer[], fn: (o: FlightOffer) => number | undefined) => {
        let min: number | undefined;
        for (const o of offers) { const v = fn(o); if (v != null && (min == null || v < min)) min = v; }
        return min;
      };
      const m = 1 + params.margin;
      const comparison: Record<string, unknown> = {};
      if (targets.brl != null) {
        comparison['brl'] = {
          outbound:  bestOf(outboundResults, o => o.fares.brl?.amount),
          return:    hasReturn ? bestOf(returnResults, o => o.fares.brl?.amount) : undefined,
          threshold: Math.round(targets.brl * m * 100) / 100,
        };
      }
      if (targets.pts != null) {
        comparison['pts'] = {
          outbound:  bestOf(outboundResults, o => o.fares.points?.amount),
          return:    hasReturn ? bestOf(returnResults, o => o.fares.points?.amount) : undefined,
          threshold: Math.round(targets.pts * m),
        };
      }
      if (targets.hybPts != null || targets.hybBrl != null) {
        comparison['hyb'] = {
          outbound:     bestOf(outboundResults, o => o.fares.hybrid?.points),
          return:       hasReturn ? bestOf(returnResults, o => o.fares.hybrid?.points) : undefined,
          thresholdPts: targets.hybPts != null ? Math.round(targets.hybPts * m) : undefined,
          thresholdBrl: targets.hybBrl != null ? Math.round(targets.hybBrl * m * 100) / 100 : undefined,
        };
      }
      logger.info(comparison, 'Email: nenhum voo atingiu o target');

      if (runCount >= 20 && !bestOfDayAlreadySent(state, today)) {
        const best = pickBestOffer(state, today);
        if (best && (best.outbound || best.ret)) {
          const { subject, html } = buildBestOfDayEmail(
            best.outbound?.offer,
            best.ret?.offer,
            best.type,
            params.origin,
            params.destination,
            params.passengers,
          );
          await sendEmail(subject, html);
          markBestOfDaySent(state, today);
          run.log('Best-of-day email sent (20th run, no target hit today)');
          logger.info({ runCount }, 'Email: best-of-day enviado');
        }
      } else if (runCount >= 20) {
        logger.info({ runCount }, 'Email: best-of-day já enviado hoje');
      } else {
        logger.info({ runCount, aguardando: 20 }, 'Email: sem target, aguardando run 20 para best-of-day');
      }
    }
  }

  await saveState(state);

} catch (err) {
  spinner.fail('Search failed');
  await run.saveError(err);
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await pruneOldRuns();
}
