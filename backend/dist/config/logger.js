import pino from 'pino';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function resolveDevTransport() {
    if (process.env.NODE_ENV !== 'development') {
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
    }
    catch {
        return undefined;
    }
}
export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: resolveDevTransport()
});
//# sourceMappingURL=logger.js.map