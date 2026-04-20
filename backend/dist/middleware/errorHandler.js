import { logger } from '../config/logger.js';
export class AppError extends Error {
    constructor(statusCode, message, code) {
        super(message);
        Object.defineProperty(this, "statusCode", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: statusCode
        });
        Object.defineProperty(this, "code", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: code
        });
        this.name = 'AppError';
    }
}
export const errorHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        logger.error({
            code: err.code,
            statusCode: err.statusCode,
            message: err.message
        });
        return res.status(err.statusCode).json({
            error: err.message,
            code: err.code
        });
    }
    logger.error({
        error: err.message,
        stack: err.stack
    });
    return res.status(500).json({
        error: 'Internal server error'
    });
};
//# sourceMappingURL=errorHandler.js.map