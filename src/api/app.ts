import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import { healthRouter } from './routes/health.routes';
import { hotelRouter } from './routes/hotel.routes';
import { supplierRouter } from './routes/supplier.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(express.json({ limit: '64kb' }));
  app.use(requestLogger);

  app.use('/api', hotelRouter);
  app.use(supplierRouter);
  app.use(healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
