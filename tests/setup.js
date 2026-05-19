import { MongoMemoryServer } from 'mongodb-memory-server';
import { beforeAll, afterAll } from 'vitest';
import { connectDB, disconnectDB } from '../src/db/index.js';
import { config } from '../src/config.js';

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  // Patch config before connectDB reads it — avoids needing a real MongoDB URI
  config.mongodb.uri = mongod.getUri();
  await connectDB();
}, 60_000); // generous timeout: first run downloads the MongoDB binary

afterAll(async () => {
  await disconnectDB();
  await mongod?.stop();
});
