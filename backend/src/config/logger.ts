import pino from 'pino';
import { createRequire } from 'node:module';
import { env } from './env.js';

const require = createRequire(import.meta.url);

function resolveDevTransport() {
  if (!env.isDevelopment) {
    return undefined;
  }

  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    };
  } catch {
    return undefined;
  }
}

export const logger = pino({
  level: env.logLevel,
  transport: resolveDevTransport()
});
