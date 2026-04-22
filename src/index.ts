import 'dotenv/config';
import { Command } from 'commander';
import ora from 'ora';
import { searchFlights } from './scrapers/azul.ts';
import { displayResults } from './display/terminal.ts';
import { setLogLevel } from './utils/logger.ts';
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

  if (results.length === 0) {
    console.log('\n  No Azul flights found for the given parameters.\n');
  } else {
    displayResults(params, results);
  }

  // ── Email logic ─────────────────────────────────────────────────────────────
  const emailEnabled = env['EMAIL_ENABLED'] === 'true';
  if (emailEnabled && results.length > 0) {
    const today = todayStr();
    const state = await loadState();
    const runCount = incrementRun(state, today);
    updateBestOffers(state, today, results, targets);

    const hasReturn = params.returnStart != null;
    const outboundResults = results.filter(o => !o.isReturn);
    const returnResults   = results.filter(o => o.isReturn);

    const outboundWithin = getOffersWithinTarget(outboundResults, targets, params.margin);
    const returnWithin   = hasReturn ? getOffersWithinTarget(returnResults, targets, params.margin) : [];

    const canAlert = outboundWithin.length > 0 || (hasReturn && returnWithin.length > 0);

    if (canAlert) {
      // Determine which target type matched from whichever direction has hits (priority: BRL → PTS → HYB)
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
      }

    } else if (runCount >= 20 && !bestOfDayAlreadySent(state, today)) {
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
      }
    }

    await saveState(state);
  }

} catch (err) {
  spinner.fail('Search failed');
  await run.saveError(err);
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await pruneOldRuns();
}
