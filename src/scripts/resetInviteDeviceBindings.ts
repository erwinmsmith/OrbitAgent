import mongoose from 'mongoose';
import { SEED_INVITE_CODES } from '../data/inviteCodes';
import { logger } from '../utils/logger';

function mongoUri(): string {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const host = process.env.MONGODB_HOST || 'localhost';
  const port = process.env.MONGODB_PORT || '27017';
  const database = process.env.MONGODB_DATABASE || 'orbit_agent';
  return `mongodb://${host}:${port}/${database}`;
}

async function main(): Promise<void> {
  await mongoose.connect(mongoUri());
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');

  const hashes = SEED_INVITE_CODES.map(invite => invite.codeHash);
  const result = await db.collection('invite_codes').updateMany(
    { codeHash: { $in: hashes } },
    { $unset: { deviceIdHash: '', deviceBoundAt: '' } },
  );
  logger.info(
    `Invite code device bindings reset: ${result.modifiedCount}/${result.matchedCount} updated`,
  );
}

main()
  .catch(error => {
    logger.error('Failed to reset invite code device bindings:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
