const redis = require('redis');
const logger = require('../utils/logger');

let client;

const connectRedis = async () => {
  try {
    const redisUrl = process.env.REDIS_URL || 
      `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
    
    client = redis.createClient({
      url: redisUrl,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.error('Redis server connection refused');
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          logger.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          logger.error('Redis max retry attempts reached');
          return undefined;
        }
        // reconnect after
        return Math.min(options.attempt * 100, 3000);
      }
    });
    
    client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });
    
    client.on('connect', () => {
      logger.info('Redis Client Connected');
    });
    
    client.on('ready', () => {
      logger.info('Redis Client Ready');
    });
    
    await client.connect();
    
    // Test connection
    await client.ping();
    
    logger.info('Redis connected successfully');
    return client;
  } catch (error) {
    logger.error('Redis connection failed:', error);
    throw error;
  }
};

const getRedis = () => {
  if (!client) {
    throw new Error('Redis not initialized. Call connectRedis() first.');
  }
  return client;
};

// Cache helper functions
const setCache = async (key, value, ttl = 3600) => {
  try {
    await client.setEx(key, ttl, JSON.stringify(value));
    logger.debug(`Cache set for key: ${key}`);
  } catch (error) {
    logger.error('Cache set failed:', error);
  }
};

const getCache = async (key) => {
  try {
    const value = await client.get(key);
    if (value) {
      logger.debug(`Cache hit for key: ${key}`);
      return JSON.parse(value);
    }
    logger.debug(`Cache miss for key: ${key}`);
    return null;
  } catch (error) {
    logger.error('Cache get failed:', error);
    return null;
  }
};

const deleteCache = async (key) => {
  try {
    await client.del(key);
    logger.debug(`Cache deleted for key: ${key}`);
  } catch (error) {
    logger.error('Cache delete failed:', error);
  }
};

const clearCache = async (pattern = '*') => {
  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
      logger.debug(`Cache cleared for pattern: ${pattern}, keys: ${keys.length}`);
    }
  } catch (error) {
    logger.error('Cache clear failed:', error);
  }
};

module.exports = {
  connectRedis,
  getRedis,
  setCache,
  getCache,
  deleteCache,
  clearCache
};
