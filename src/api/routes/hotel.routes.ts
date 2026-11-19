import { Router } from 'express';
import { getHotels } from '../controllers/hotel.controller';

export const hotelRouter = Router();

hotelRouter.get('/hotels', getHotels);
