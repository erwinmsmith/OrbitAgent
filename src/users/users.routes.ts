import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { getUserService } from './UserService';
import { HTTP_STATUS } from '../constants';
import { logger } from '../utils/logger';

const router = Router();

// All routes require authentication
router.use(authMiddleware(true));

const userService = getUserService();

// ─── Profile ─────────────────────────────────────────────────────────

/**
 * GET /users/profile
 * Get current user's profile
 */
router.get('/profile', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const profile = await userService.getOrCreateProfile(userId);

  res.json({
    success: true,
    data: profile,
  });
}));

/**
 * PUT /users/profile
 * Update current user's profile
 */
router.put('/profile', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const profile = await userService.updateProfile(userId, req.body);

  res.json({
    success: true,
    data: profile,
  });
}));

/**
 * POST /users/profile/check-in
 * Daily check-in to maintain streak
 */
router.post('/profile/check-in', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const profile = await userService.checkIn(userId);

  res.json({
    success: true,
    data: {
      checkInStreak: profile?.checkInStreak,
      badges: profile?.badges,
      message: `连续签到 ${profile?.checkInStreak} 天`,
    },
  });
}));

/**
 * GET /users/profile/stats
 * Get user stats summary
 */
router.get('/profile/stats', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const stats = await userService.getUserStats(userId);

  res.json({
    success: true,
    data: stats,
  });
}));

// ─── Conversation Tasks ─────────────────────────────────────────────

/**
 * POST /users/tasks
 * Create a new ritual conversation task
 */
router.post('/tasks', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const task = await userService.createTask(userId, req.body);

  logger.debug(`[Users] Task created by user: ${userId}`);

  res.status(HTTP_STATUS.CREATED).json({
    success: true,
    data: task,
  });
}));

/**
 * GET /users/tasks
 * List current user's conversation tasks
 */
router.get('/tasks', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    page,
    limit,
    archived,
    sortBy,
    sortOrder,
  } = req.query;

  const result = await userService.listTasks(userId, {
    page: page ? parseInt(page as string) : 1,
    limit: limit ? parseInt(limit as string) : 20,
    archived: archived !== undefined ? archived === 'true' : undefined,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
  });

  res.json({
    success: true,
    data: result,
  });
}));

/**
 * GET /users/tasks/feed
 * Global feed of shared tasks (for "回响之谷")
 */
router.get('/tasks/feed', asyncHandler(async (req: Request, _res: Response) => {
  const page = req.query.page ? parseInt(req.query.page as string) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

  // Public feed — no auth required beyond the router middleware
  const result = await userService.getSharedTasksFeed(page, limit);

  _res.json({
    success: true,
    data: result,
  });
}));

/**
 * GET /users/tasks/:taskId
 * Get a single task by ID
 */
router.get('/tasks/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const task = await userService.getTask(taskId, userId);

  if (!task) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
    });
  }

  res.json({
    success: true,
    data: task,
  });
}));

/**
 * PUT /users/tasks/:taskId
 * Update a task (response, rounds, archive, share)
 */
router.put('/tasks/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const task = await userService.updateTask(taskId, userId, req.body);

  if (!task) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
    });
  }

  res.json({
    success: true,
    data: task,
  });
}));

/**
 * POST /users/tasks/:taskId/like
 * Like a task
 */
router.post('/tasks/:taskId/like', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const task = await userService.likeTask(taskId, userId);

  if (!task) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
    });
  }

  res.json({
    success: true,
    data: { likedCount: task.likedCount },
  });
}));

/**
 * POST /users/tasks/:taskId/archive
 * Archive a task
 */
router.post('/tasks/:taskId/archive', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const task = await userService.archiveTask(taskId, userId);

  if (!task) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
    });
  }

  res.json({
    success: true,
    data: task,
  });
}));

/**
 * DELETE /users/tasks/:taskId
 * Delete a task permanently
 */
router.delete('/tasks/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const deleted = await userService.deleteTask(taskId, userId);

  if (!deleted) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
    });
  }

  res.json({
    success: true,
    message: 'Task deleted',
  });
}));

export default router;
