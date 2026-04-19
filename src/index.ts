import { Command } from 'commander';
import ora from 'ora';
import { searchFlights } from './scrapers/azul.ts';
import { displayResults } from './display/terminal.ts';
import { setLogLevel } from './utils/logger.ts';
import type { SearchParams } from './types/index.ts';

const program = new Command();

program
  .name('flight-tracker')
  .description('Azul Airlines flight price tracker')
  .version('1.0.0')
  .requiredOption('-o, --origin <IATA>', 'Origin airport code (e.g. GRU)')
  .requiredOption('-d, --destination <IATA>', 'Destination airport code (e.g. CGH)')
  .requiredOption('-t, --target <number>', 'Target price in BRL', parseFloat)
  .requiredOption('-s, --outbound-start <YYYY-MM-DD>', 'Outbound search start date')
  .option('-e, --outbound-end <YYYY-MM-DD>', 'Outbound search end date (inclusive)')
  .option('-m, --margin <decimal>', 'Acceptable margin above target (e.g. 0.1 = 10%)', parseFloat, 0.1)
  .option('--return-start <YYYY-MM-DD>', 'Return search start date')
  .option('--return-end <YYYY-MM-DD>', 'Return search end date (inclusive)')
  .option('-p, --passengers <number>', 'Number of adult passengers', parseInt, 1)
  .option('-v, --verbose', 'Enable verbose debug output and save screenshots on error')
  .parse(process.argv);

const opts = program.opts<{
  origin: string;
  destination: string;
  target: number;
  margin: number;
  outboundStart: string;
  outboundEnd?: string;
  returnStart?: string;
  returnEnd?: string;
  passengers: number;
  verbose?: boolean;
}>();

setLogLevel(opts.verbose ?? false);

const params: SearchParams = {
  origin: opts.origin.toUpperCase(),
  destination: opts.destination.toUpperCase(),
  target: opts.target,
  margin: opts.margin,
  outboundStart: opts.outboundStart,
  outboundEnd: opts.outboundEnd,
  returnStart: opts.returnStart,
  returnEnd: opts.returnEnd,
  passengers: opts.passengers,
  verbose: opts.verbose ?? false,
};

const spinner = ora({
  text: `Searching Azul flights ${params.origin} → ${params.destination}…`,
  color: 'cyan',
}).start();

try {
  const results = await searchFlights(params);
  spinner.stop();

  if (results.length === 0) {
    console.log('\n  No Azul flights found for the given parameters.\n');
    process.exit(0);
  }

  displayResults(params, results);
} catch (err) {
  spinner.fail('Search failed');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
