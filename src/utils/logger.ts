import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { getConfig } from '../config';

let loggerInstance: winston.Logger | null = null;

export function createLogger(): winston.Logger {
  if (loggerInstance) {
    return loggerInstance;
  }

  const logDir = path.resolve(process.cwd(), 'logs');

  // Ensure logs directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  let config: { level: string; format: string; outputs?: Array<{ type: string; path?: string }> };
  try {
    config = getConfig().logging;
  } catch {
    // Default config if not loaded yet
    config = {
      level: 'info',
      format: 'json',
      outputs: [
        { type: 'console' },
        { type: 'file', path: './logs/app.log' }
      ]
    };
  }

  const formats = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
  ];

  if (config.format === 'json') {
    formats.push(winston.format.json());
  } else {
    formats.push(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
        return `${timestamp} [${level}]: ${message} ${metaStr}`;
      })
    );
  }

  const transports: winston.transport[] = [];

  for (const output of config.outputs || [{ type: 'console' }]) {
    if (output.type === 'console') {
      transports.push(
        new winston.transports.Console({
          level: config.level,
        })
      );
    } else if (output.type === 'file' && output.path) {
      const logPath = path.resolve(process.cwd(), output.path);
      const logDir = path.dirname(logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      transports.push(
        new winston.transports.File({
          filename: logPath,
          level: config.level,
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        })
      );
    }
  }

  loggerInstance = winston.createLogger({
    level: config.level,
    format: winston.format.combine(...formats),
    transports,
    exitOnError: false,
  });

  return loggerInstance;
}

export const logger = createLogger();

export default logger;
