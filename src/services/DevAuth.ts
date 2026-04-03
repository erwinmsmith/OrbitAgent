import { UserModel } from '../models/User';
import { logger } from '../utils/logger';

/**
 * Dev 模式下自动准备测试用户
 * 检查是否存在，不存在则创建
 */
export async function initDevTestUser(): Promise<{ email: string; password: string } | null> {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) return null;

  const devEmail = process.env.DEV_TEST_EMAIL || 'dev@test.local';
  const devPassword = process.env.DEV_TEST_PASSWORD || 'devpassword123';

  try {
    const existing = await UserModel.findOne({ email: devEmail }).select('+password');
    if (existing) {
      logger.info(`[DevAuth] Using existing test user: ${devEmail}`);
      return { email: devEmail, password: devPassword };
    }

    const user = new UserModel({
      email: devEmail,
      username: 'devuser',
      password: devPassword,
      displayName: 'Dev User',
      isActive: true,
      isAdmin: true,
    });

    await user.save();
    logger.info(`[DevAuth] Created test user: ${devEmail} / ${devPassword}`);
    logger.info(`[DevAuth] Use this token in frontend: POST /auth/login with the credentials above`);

    return { email: devEmail, password: devPassword };
  } catch (error) {
    logger.error('[DevAuth] Failed to init dev user:', error);
    return null;
  }
}

/**
 * 获取 dev 测试用户的 JWT token（方便前端直接使用）
 */
export async function getDevTestToken(): Promise<string | null> {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) return null;

  const devEmail = process.env.DEV_TEST_EMAIL || 'dev@test.local';
  const devPassword = process.env.DEV_TEST_PASSWORD || 'devpassword123';

  try {
    const jwt = await import('jsonwebtoken');
    const config = await import('../config').then(m => m.getConfig());

    // Quick token generation without full auth flow
    const user = await UserModel.findOne({ email: devEmail });
    if (!user) return null;

    const token = jwt.default.sign(
      { userId: user._id, email: user.email },
      config.auth.jwt.secret,
      { expiresIn: '30d' }
    );

    logger.info(`[DevAuth] Test token ready for: ${devEmail}`);
    return token;
  } catch (error) {
    logger.error('[DevAuth] Failed to get dev token:', error);
    return null;
  }
}
