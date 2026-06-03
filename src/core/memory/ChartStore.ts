/**
 * ChartStore — persists a single assembled ChartResult per
 * (userId, sessionId, chartKey) in MongoDB. Every operation takes
 * a userId so a caller cannot load another user's chart by guessing
 * a sessionId.
 *
 * Why Mongo and not Redis:
 *   Redis is the cache / pub-sub / ephemeral-state layer. Charts
 *   are user-owned business data and must survive Redis restarts,
 *   so they live in Mongo with a TTL index for automatic cleanup.
 *
 * Public API matches the previous Redis-backed version with one
 * important change: every function now takes a userId argument and
 * throws if a chart doesn't exist OR doesn't belong to that user.
 * Routes that talk to ChartStore must be authenticated and pass
 * req.user.userId.
 */
import { DivinationChartModel } from '../../models/DivinationChart';
import type { ChartResult } from '../../liuyao/types/chart';
import { logger } from '../../utils/logger';

const DEFAULT_TTL_HOURS = 24;

export interface StoredChart {
  userId: string;
  sessionId: string;
  chartKey: string;
  savedAt: string;
  expiresAt: string;
  chart: ChartResult;
}

/**
 * Save (or upsert) a chart for a user+session+key triple. Idempotent
 * — calling it twice on the same triple just updates the chart in
 * place. TTL defaults to 24h, configurable via the fourth arg.
 */
export async function saveChart(
  userId: string,
  sessionId: string,
  chart: ChartResult,
  chartKey: string = 'default',
  ttlHours: number = DEFAULT_TTL_HOURS,
): Promise<StoredChart> {
  if (!userId) throw new Error('ChartStore: userId is required (multi-user isolation)');
  if (!sessionId) throw new Error('ChartStore: sessionId is required');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  const doc = await DivinationChartModel.findOneAndUpdate(
    { userId, sessionId, chartKey },
    {
      $set: { chart, expiresAt },
      $setOnInsert: { userId, sessionId, chartKey },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  logger.info(`ChartStore: saved chart userId=${userId} sessionId=${sessionId} key=${chartKey}`);
  return {
    userId,
    sessionId,
    chartKey,
    savedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    chart: doc.chart as ChartResult,
  };
}

/**
 * Fetch a stored chart. Throws if the chart doesn't exist OR
 * doesn't belong to userId — we deliberately don't return null
 * silently because that lets a caller probe other users' sessionIds
 * for existence.
 */
export async function getChart(
  userId: string,
  sessionId: string,
  chartKey: string = 'default',
): Promise<StoredChart> {
  if (!userId) throw new Error('ChartStore: userId is required');
  if (!sessionId) throw new Error('ChartStore: sessionId is required');

  const doc = await DivinationChartModel.findOne({ userId, sessionId, chartKey }).lean();
  if (!doc) {
    // Same message whether the chart doesn't exist or doesn't belong
    // to this user. Don't leak that distinction.
    throw new Error(
      `No stored chart for sessionId=${sessionId}` +
      (chartKey !== 'default' ? ` chartKey=${chartKey}` : '') +
      '. Run `orbit divination chart <bits> --session <id>` first.',
    );
  }
  return {
    userId: doc.userId,
    sessionId: doc.sessionId,
    chartKey: doc.chartKey,
    savedAt: (doc as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    chart: doc.chart as ChartResult,
  };
}

/** Return the latest chart on a session (any chartKey), or null. */
export async function getLatestChart(
  userId: string,
  sessionId: string,
): Promise<StoredChart | null> {
  if (!userId || !sessionId) return null;
  const doc = await DivinationChartModel
    .findOne({ userId, sessionId })
    .sort({ createdAt: -1 })
    .lean();
  if (!doc) return null;
  return {
    userId: doc.userId,
    sessionId: doc.sessionId,
    chartKey: doc.chartKey,
    savedAt: (doc as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    chart: doc.chart as ChartResult,
  };
}

export async function listChartKeys(
  userId: string,
  sessionId: string,
): Promise<string[]> {
  if (!userId || !sessionId) return [];
  const docs = await DivinationChartModel
    .find({ userId, sessionId })
    .select('chartKey')
    .lean();
  return docs.map((d) => d.chartKey).sort();
}

/** List all charts the user owns on a session. Admin/debug helper. */
export async function listUserChartsOnSession(
  userId: string,
  sessionId: string,
): Promise<StoredChart[]> {
  const docs = await DivinationChartModel
    .find({ userId, sessionId })
    .sort({ createdAt: -1 })
    .lean();
  return docs.map((doc: any) => ({
    userId: doc.userId,
    sessionId: doc.sessionId,
    chartKey: doc.chartKey,
    savedAt: doc.createdAt?.toISOString?.() ?? new Date().toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    chart: doc.chart as ChartResult,
  }));
}
