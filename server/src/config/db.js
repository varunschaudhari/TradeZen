/**
 * @file db.js
 * @description MongoDB connection with exponential-backoff retry logic
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import mongoose from 'mongoose';
import { logger } from './logger.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Connects to MongoDB, retrying up to MAX_RETRIES times on failure
 * @returns {Promise<void>}
 * @throws {Error} When all retry attempts are exhausted
 */
const connectDB = async () => {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      const connection = await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      logger.info(`MongoDB connected: ${connection.connection.host}`);
      return;
    } catch (error) {
      retries += 1;
      logger.error(`MongoDB connection attempt ${retries}/${MAX_RETRIES} failed`, {
        error: error.message,
      });

      if (retries === MAX_RETRIES) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
};

export { connectDB };
