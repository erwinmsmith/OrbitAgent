import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { getConfig } from './config';
import { logger } from './utils/logger';
import { initializeDatabases, closeDatabases } from './services/database';
import { initializeLLM, destroyLLM } from './core/llm/LLMFactory';
import { initializeSkillManager, destroySkillManager } from './core/skills/SkillManager';
import { initializeToolManager, destroyToolManager } from './core/tools/ToolManager';
import { initializeWorkflowEngine, destroyWorkflowEngine } from './core/workflow/WorkflowEngine';
import { initializePromptManager, destroyPromptManager } from './core/prompts/PromptManager';
import { getTemporaryMemory } from './core/memory/TemporaryMemory';
import { getPermanentMemory } from './core/memory/PermanentMemory';
import routes from './routes';
import { errorHandler, notFoundHandler, requestLogger, rateLimitHandler } from './middleware/errorHandler';
import { HTTP_STATUS } from './constants';

class Application {
  private app: Express;
  private config: ReturnType<typeof getConfig>;
  private server: any = null;

  constructor() {
    this.app = express();
    this.config = getConfig();
  }

  async initialize(): Promise<void> {
    // Setup middleware
    this.setupMiddleware();

    // Setup routes
    this.setupRoutes();

    // Setup error handling
    this.setupErrorHandling();

    // Initialize services
    await this.initializeServices();

    logger.info('Application initialized successfully');
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable for API
    }));

    // CORS
    this.app.use(cors({
      origin: '*', // Configure for production
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use(requestLogger);
  }

  private setupRoutes(): void {
    const apiPrefix = this.config.app.apiPrefix;

    // API routes
    this.app.use(apiPrefix, routes);

    // Root endpoint - redirect to status page
    this.app.get('/', (_req, res) => {
      res.redirect(`${apiPrefix}/status/page`);
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);

    // Rate limiting
    if (this.config.rateLimit.enabled) {
      const limiter = rateLimit({
        windowMs: this.config.rateLimit.windowMs,
        max: this.config.rateLimit.max,
        handler: rateLimitHandler,
        standardHeaders: true,
        legacyHeaders: false,
      });

      this.app.use(limiter);
    }
  }

  private async initializeServices(): Promise<void> {
    logger.info('Initializing services...');

    // Initialize databases
    await initializeDatabases();

    // Initialize LLM Manager
    await initializeLLM();

    // Initialize Memory
    const tempMemory = getTemporaryMemory();
    await tempMemory.startCleanup();

    // Initialize Skill Manager
    await initializeSkillManager();

    // Initialize Tool Manager
    await initializeToolManager();

    // Initialize Workflow Engine
    await initializeWorkflowEngine();

    // Initialize Prompt Manager
    await initializePromptManager();

    logger.info('All services initialized');
  }

  async start(): Promise<void> {
    const { host, port } = this.config.app;

    return new Promise((resolve) => {
      this.server = this.app.listen(port, host, () => {
        logger.info(`Server started`, {
          host,
          port,
          env: this.config.app.env,
          url: `http://${host}:${port}`,
        });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    logger.info('Shutting down...');

    // Stop accepting new connections
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    }

    // Cleanup services
    await destroyLLM();
    await destroySkillManager();
    await destroyToolManager();
    await destroyWorkflowEngine();
    await destroyPromptManager();

    // Close databases
    await closeDatabases();

    logger.info('Shutdown complete');
  }

  getApp(): Express {
    return this.app;
  }
}

// Create application instance
const app = new Application();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await app.stop();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the application
async function main() {
  try {
    await app.initialize();
    await app.start();
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

main();

export default app;
