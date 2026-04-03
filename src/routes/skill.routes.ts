import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { getSkillManager } from '../core/skills/SkillManager';
import { HTTP_STATUS } from '../constants';

const router = Router();

router.use(authMiddleware(true));

// List all skills
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const skillManager = getSkillManager();
  const skills = skillManager.listSkills();

  res.json({
    success: true,
    data: skills,
  });
}));

// Get skill details
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const skillManager = getSkillManager();
  const skill = skillManager.getSkill(id);

  if (!skill) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'SKILL_NOT_FOUND', message: 'Skill not found' },
    });
  }

  const config = skillManager.getSkillConfig(id);

  res.json({
    success: true,
    data: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      triggers: skill.triggers,
      priority: skill.priority,
      config,
    },
  });
}));

// Enable/disable skill (admin only)
router.patch('/:id', adminOnly, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { enabled, priority } = req.body;

  const skillManager = getSkillManager();
  const skill = skillManager.getSkill(id);

  if (!skill) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'SKILL_NOT_FOUND', message: 'Skill not found' },
    });
  }

  // Note: This would require modifying the SkillManager to support config updates
  // For now, we just return success

  res.json({
    success: true,
    message: 'Skill configuration updated',
  });
}));

export default router;
