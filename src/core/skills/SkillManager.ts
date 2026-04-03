import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ISkill, SkillConfig, SkillContext, SkillResult, SkillRegistration } from './types';
import { logger } from '../../utils/logger';

export class SkillManager {
  private skills: Map<string, SkillRegistration> = new Map();
  private skillDir: string;
  private autoLoad: boolean;

  constructor(skillDir?: string, autoLoad?: boolean) {
    this.skillDir = skillDir || path.resolve(process.cwd(), 'src/core/skills/builtins');
    this.autoLoad = autoLoad ?? true;
  }

  async initialize(): Promise<void> {
    if (this.autoLoad) {
      await this.loadBuiltInSkills();
    }
    logger.info('SkillManager initialized', { skillCount: this.skills.size });
  }

  async destroy(): Promise<void> {
    // Call unload on all skills
    for (const [id, registration] of this.skills) {
      if (registration.skill.onUnload) {
        try {
          await registration.skill.onUnload();
          logger.debug(`Skill ${id} unloaded`);
        } catch (error) {
          logger.error(`Error unloading skill ${id}:`, error);
        }
      }
    }
    this.skills.clear();
    logger.info('SkillManager destroyed');
  }

  async register(skill: ISkill, config?: Partial<SkillConfig>): Promise<void> {
    const skillConfig: SkillConfig = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      enabled: true,
      triggers: skill.triggers,
      priority: skill.priority,
      ...config,
    };

    // Call onLoad if defined
    if (skill.onLoad) {
      await skill.onLoad();
    }

    this.skills.set(skill.id, { skill, config: skillConfig });
    logger.info(`Skill registered: ${skill.id} (${skill.name})`);
  }

  async unregister(skillId: string): Promise<boolean> {
    const registration = this.skills.get(skillId);
    if (!registration) {
      return false;
    }

    if (registration.skill.onUnload) {
      await registration.skill.onUnload();
    }

    this.skills.delete(skillId);
    logger.info(`Skill unregistered: ${skillId}`);
    return true;
  }

  getSkill(skillId: string): ISkill | null {
    return this.skills.get(skillId)?.skill || null;
  }

  getSkillConfig(skillId: string): SkillConfig | null {
    return this.skills.get(skillId)?.config || null;
  }

  listSkills(enabledOnly: boolean = false): SkillConfig[] {
    const list: SkillConfig[] = [];
    for (const registration of this.skills.values()) {
      if (!enabledOnly || registration.config.enabled) {
        list.push(registration.config);
      }
    }
    return list.sort((a, b) => b.priority - a.priority);
  }

  async executeSkills(context: SkillContext): Promise<SkillContext> {
    const sortedSkills = Array.from(this.skills.values())
      .filter(reg => reg.config.enabled)
      .sort((a, b) => b.config.priority - a.config.priority);

    let currentContext = context;

    for (const registration of sortedSkills) {
      // Check if skill should be triggered
      if (!this.shouldTrigger(registration.skill, currentContext)) {
        continue;
      }

      try {
        logger.debug(`Executing skill: ${registration.skill.id}`);
        const result = await registration.skill.execute(currentContext);

        if (result.success) {
          // Update context with skill results
          if (result.variables) {
            currentContext.variables = {
              ...currentContext.variables,
              ...result.variables,
            };
          }

          if (result.modifiedContent && currentContext.currentMessage) {
            currentContext.currentMessage.content = result.modifiedContent;
          }
        }

        // Check if we should stop processing
        if (!result.shouldContinue) {
          logger.debug(`Skill ${registration.skill.id} stopped further processing`);
          break;
        }
      } catch (error) {
        logger.error(`Error executing skill ${registration.skill.id}:`, error);
        if (registration.skill.onError) {
          registration.skill.onError(error as Error);
        }
      }
    }

    return currentContext;
  }

  private shouldTrigger(skill: ISkill, context: SkillContext): boolean {
    // If no triggers, skill is always available
    if (!skill.triggers || skill.triggers.length === 0) {
      return true;
    }

    for (const trigger of skill.triggers) {
      switch (trigger.type) {
        case 'always':
          return true;

        case 'keyword':
          if (context.currentMessage.content.toLowerCase().includes(trigger.pattern.toLowerCase())) {
            return true;
          }
          break;

        case 'regex':
          try {
            const regex = new RegExp(trigger.pattern, 'i');
            if (regex.test(context.currentMessage.content)) {
              return true;
            }
          } catch {
            logger.warn(`Invalid regex pattern for skill ${skill.id}: ${trigger.pattern}`);
          }
          break;

        case 'intent':
          // Intent detection would be implemented here
          // For now, check if variable matches
          if (context.variables.intent === trigger.pattern) {
            return true;
          }
          break;
      }
    }

    return false;
  }

  private async loadBuiltInSkills(): Promise<void> {
    try {
      if (!fs.existsSync(this.skillDir)) {
        logger.warn(`Skill directory not found: ${this.skillDir}`);
        return;
      }

      const files = fs.readdirSync(this.skillDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));

      for (const file of files) {
        try {
          const filePath = path.join(this.skillDir, file);
          const skillModule = await import(filePath);

          // Find the default export or the skill class
          const SkillClass = skillModule.default || skillModule.Skill;
          if (SkillClass) {
            const skillInstance = new SkillClass();
            await this.register(skillInstance);
          }
        } catch (error) {
          logger.error(`Failed to load skill from ${file}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to load built-in skills:', error);
    }
  }

  async loadSkillsFromConfig(configPath: string): Promise<void> {
    try {
      if (!fs.existsSync(configPath)) {
        logger.warn(`Skills config not found: ${configPath}`);
        return;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.load(content) as { skills: SkillConfig[] };

      if (config.skills) {
        for (const skillConfig of config.skills) {
          // Try to load the skill module
          const skill = this.getSkill(skillConfig.id);
          if (skill) {
            // Update config
            const registration = this.skills.get(skillConfig.id);
            if (registration) {
              registration.config = skillConfig;
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load skills from config:', error);
    }
  }
}

// Singleton instance
let skillManagerInstance: SkillManager | null = null;

export function getSkillManager(): SkillManager {
  if (!skillManagerInstance) {
    skillManagerInstance = new SkillManager();
  }
  return skillManagerInstance;
}

export async function initializeSkillManager(): Promise<SkillManager> {
  const manager = getSkillManager();
  await manager.initialize();
  return manager;
}

export async function destroySkillManager(): Promise<void> {
  if (skillManagerInstance) {
    await skillManagerInstance.destroy();
    skillManagerInstance = null;
  }
}

export default SkillManager;
