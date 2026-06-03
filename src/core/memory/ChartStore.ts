/**
 * ChartStore — persists a single assembled ChartResult per session
 * in Redis, so that subsequent /chat calls (or the analyze tool) can
 * read it without re-running the assembly pipeline.
 *
 * Design (per the user's request):
 *   - User runs `orbit divination chart <bits>` once.
 *   - Server stores the ChartResult under
 *     `orbit:chart:<sessionId>` (TTL = 24h, matches TemporaryMemory).
 *   - Subsequent /chat on the same sessionId has the chart
 *     auto-injected into the agent's context, and the `divination`
 *     tool only exposes an `analyze` action that reads from the store.
 *
 * Multi-chart-per-session is supported via the optional `chartKey`
 * field — if the user casts twice on the same session, the second
 * chart is stored under `orbit:chart:<sessionId>:<chartKey>`, and the
 * most-recent key for the session is tracked at
 * `orbit:chart:<sessionId>:latest`.
 */
import { getRedisClient } from '../../services/database';
import { logger } from '../../utils/logger';
import type { ChartResult } from '../../liuyao/types/chart';

const TTL_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = 'orbit:chart';

function keyFor(sessionId: string, chartKey: string = 'default'): string {
  return `${KEY_PREFIX}:${sessionId}:${chartKey}`;
}

function latestKeyFor(sessionId: string): string {
  return `${KEY_PREFIX}:${sessionId}:latest`;
}

function sessionKeysSetKey(sessionId: string): string {
  return `${KEY_PREFIX}:${sessionId}:keys`;
}

export interface StoredChart {
  chartKey: string;
  savedAt: string;
  chart: ChartResult;
}

export async function saveChart(
  sessionId: string,
  chart: ChartResult,
  chartKey: string = 'default',
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) throw new Error('ChartStore: redis not initialized');
  const key = keyFor(sessionId, chartKey);
  const latest = latestKeyFor(sessionId);
  const keys = sessionKeysSetKey(sessionId);
  const payload: StoredChart = {
    chartKey,
    savedAt: new Date().toISOString(),
    chart,
  };
  await redis.set(key, JSON.stringify(payload), 'EX', TTL_SECONDS);
  await redis.set(latest, chartKey, 'EX', TTL_SECONDS);
  await redis.sadd(keys, chartKey);
  await redis.expire(keys, TTL_SECONDS);
  logger.info(`ChartStore: saved chart for session=${sessionId} key=${chartKey}`);
}

export async function getChart(
  sessionId: string,
  chartKey?: string,
): Promise<StoredChart | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  // If no key supplied, use the latest.
  let key = chartKey;
  if (!key) {
    key = (await redis.get(latestKeyFor(sessionId))) ?? 'default';
  }
  const raw = await redis.get(keyFor(sessionId, key));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredChart;
  } catch (err) {
    logger.warn(`ChartStore: failed to parse stored chart for ${sessionId}/${key}: ${err}`);
    return null;
  }
}

export async function listChartKeys(sessionId: string): Promise<string[]> {
  const redis = getRedisClient();
  if (!redis) return [];
  const keys = await redis.smembers(sessionKeysSetKey(sessionId));
  return (keys as string[]).sort();
}
