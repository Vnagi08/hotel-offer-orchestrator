import { Router } from 'express';
import {
  getSupplierAHotelsHandler,
  getSupplierBHotelsHandler,
} from '../controllers/supplier.controller';

export const supplierRouter = Router();

supplierRouter.get('/supplierA/hotels', getSupplierAHotelsHandler);
supplierRouter.get('/supplierB/hotels', getSupplierBHotelsHandler);
