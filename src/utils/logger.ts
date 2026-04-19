import pino from 'pino';

const isDev = process.env['LOG_PRETTY'] !== 'false';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export function setLogLevel(verbose: boolean): void {
  logger.level = verbose ? 'debug' : 'warn';
}
