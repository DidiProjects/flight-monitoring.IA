import pino from 'pino';

const isDev = process.env['LOG_PRETTY'] !== 'false';
const lokiUrl   = process.env['GRAFANA_LOKI_URL'];
const lokiUser  = process.env['GRAFANA_LOKI_USER'];
const lokiToken = process.env['GRAFANA_LOKI_TOKEN'];
const hasLoki   = !!(lokiUrl && lokiUser && lokiToken);

function buildTransport(): pino.TransportSingleOptions | pino.TransportMultiOptions {
  const targets: pino.TransportTargetOptions[] = [];
  const level = process.env['LOG_LEVEL'] ?? 'info';

  if (isDev) {
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      level,
    });
  } else {
    targets.push({
      target: 'pino/file',
      options: { destination: 1 },
      level,
    });
  }

  if (hasLoki) {
    targets.push({
      target: 'pino-loki',
      options: {
        host: lokiUrl,
        basicAuth: { username: lokiUser, password: lokiToken },
        labels: { app: 'scraping-api', env: process.env['NODE_ENV'] ?? 'production' },
        interval: 5,
        replaceTimestamp: true,
        silenceErrors: false,
      },
      level: 'info',
    });
  }

  if (targets.length === 1) {
    const { target, options } = targets[0]!;
    return { target, options } as pino.TransportSingleOptions;
  }

  return { targets } as pino.TransportMultiOptions;
}

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: buildTransport(),
});
