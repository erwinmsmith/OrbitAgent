/**
 * Helpers shared by command files. Keeping these tiny + side-effect free.
 */
import { ApiResponse } from '../http';

export function unwrap<T>(body: ApiResponse<T>): T {
  if (body.success) return body.data;
  const msg = body.error?.message || 'unknown error';
  const code = body.error?.code || 'ERR';
  const err = new Error(`${code}: ${msg}`) as Error & { code?: string };
  err.code = code;
  throw err;
}

/** Format a unix timestamp as "YYYY-MM-DD HH:mm:ss" in local time. */
export function fmtDate(input: Date | string | number | undefined): string {
  if (input === undefined) return '—';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
