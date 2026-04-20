import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
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
