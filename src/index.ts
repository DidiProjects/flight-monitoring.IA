import 'dotenv/config';
import { Command } from 'commander';
import ora from 'ora';
import { searchFlights } from './scrapers/azul.ts';
import { displayResults } from './display/terminal.ts';
import { setLogLevel } from './utils/logger.ts';
import { createRun, saveResults, pruneOldRuns } from './utils/runs.ts';
import type { SearchParams } from './types/index.ts';

const env = process.env;

const program = new Command();

program
  .name('flight-tracker')
  .description('Azul Airlines flight price tracker')
  .version('1.0.0')
  .option('-o, --origin <IATA>',               'Origin airport code (e.g. GRU)',                        env['FLIGHT_ORIGIN'])
  .option('-d, --destination <IATA>',           'Destination airport code (e.g. CGH)',                   env['FLIGHT_DESTINATION'])
  .option('-t, --target <number>',              'Target price in BRL',           parseFloat,             env['FLIGHT_TARGET'] ? parseFloat(env['FLIGHT_TARGET']) : undefined)
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
  target?: number;
  margin: number;
  outboundStart?: string;
  outboundEnd?: string;
  returnStart?: string;
  returnEnd?: string;
  passengers: number;
  verbose: boolean;
}>();

// Validate required fields
const missing: string[] = [];
if (!opts.origin)        missing.push('--origin / FLIGHT_ORIGIN');
if (!opts.destination)   missing.push('--destination / FLIGHT_DESTINATION');
if (opts.target == null) missing.push('--target / FLIGHT_TARGET');
if (!opts.outboundStart) missing.push('--outbound-start / FLIGHT_OUTBOUND_START');

if (missing.length > 0) {
  console.error(`Missing required parameters:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

setLogLevel(opts.verbose);

const params: SearchParams = {
  origin:        opts.origin!.toUpperCase(),
  destination:   opts.destination!.toUpperCase(),
  target:        opts.target!,
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
  run.log(`Starting search`);
  const results = await searchFlights(searchParams);
  spinner.stop();

  run.log(`Search complete — ${results.length} offer(s) found`);
  await saveResults(run, params, results);

  if (results.length === 0) {
    console.log('\n  No Azul flights found for the given parameters.\n');
  } else {
    displayResults(params, results);
  }
} catch (err) {
  spinner.fail('Search failed');
  await run.saveError(err);
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await pruneOldRuns();
}
