/**
 * DivinationChart — a single 六爻 ChartResult persisted in MongoDB
 * (NOT Redis — Redis is the volatile cache layer; this is the
 * authoritative record).
 *
 * Per-user isolation: every chart carries the userId of its creator.
 * Reads MUST scope by userId so a user with another user's
 * sessionId cannot load their chart.
 *
 * TTL: a Mongo TTL index on `expiresAt` automatically reaps expired
 * charts (default 24h, configurable per-chart).
 */
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ChartResult } from '../liuyao/types/chart';

export interface IDivinationChart extends Document {
  userId: string;                  // owning user
  sessionId: string;               // chat session this chart was cast on
  chartKey: string;                // logical name within a session (default "default")
  chart: ChartResult;              // the deterministic engine's output
  expiresAt: Date;                 // TTL index — Mongo deletes past this
  createdAt: Date;
  updatedAt: Date;
}

const DivinationChartSchema = new Schema<IDivinationChart>(
  {
    userId: {
      type: String,
      required: true,
      // Indexed via { userId, sessionId, chartKey } below.
    },
    sessionId: {
      type: String,
      required: true,
    },
    chartKey: {
      type: String,
      required: true,
      default: 'default',
    },
    chart: {
      type: Schema.Types.Mixed,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // Mongo TTL index — server deletes docs where expiresAt < now()
      // (runs every ~60s). expireAfterSeconds=0 means "expire AT expiresAt".
    },
  },
  {
    timestamps: true,
    collection: 'divination_charts',
  },
);

// One chart per (user, session, key). Upsert-friendly.
DivinationChartSchema.index({ userId: 1, sessionId: 1, chartKey: 1 }, { unique: true });
// Find all charts in a session for a user.
DivinationChartSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });
// TTL — auto-expire.
DivinationChartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DivinationChartModel: Model<IDivinationChart> =
  mongoose.model<IDivinationChart>('DivinationChart', DivinationChartSchema);
