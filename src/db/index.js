import { MongoClient } from 'mongodb';
import { config } from '../config.js';

let mongoClient;
let db;

export async function connectDB() {
  if (db) {
    return db;
  }

  mongoClient = new MongoClient(config.mongodb.uri);

  await mongoClient.connect();
  db = mongoClient.db(config.mongodb.dbName);

  console.log(`Connected to MongoDB: ${config.mongodb.dbName}`);
  return db;
}

export async function disconnectDB() {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    db = null;
    console.log('Disconnected from MongoDB');
  }
}

export function getDB() {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
}

// Export collection accessors
export function users() {
  return getDB().collection('users');
}

export function apiCredentials() {
  return getDB().collection('api_credentials');
}

export function buckets() {
  return getDB().collection('buckets');
}

export function storageNodes() {
  return getDB().collection('storage_nodes');
}

export function usageMetrics() {
  return getDB().collection('usage_metrics');
}

export function billingRecords() {
  return getDB().collection('billing_records');
}

export function quotas() {
  return getDB().collection('quotas');
}

export function auditLog() {
  return getDB().collection('audit_log');
}
