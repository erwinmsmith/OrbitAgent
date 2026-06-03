import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ISkill, SkillConfig, SkillContext, SkillResult, SkillRegistration } from './types';
import ContextEnrichmentSkill from './builtins/ContextEnrichmentSkill';
import IntentClassificationSkill from './builtins/IntentClassificationSkill';
import { logger } from '../../utils/logger';
import { getConfig } from '../../config';

// Built-in skill constructors — registered by default, then overridable
// by entries in configs/skills.yaml (enabled flag, triggers, priority).
const BUILTIN_SKILL_CTORS: Array<new () => ISkill> = [
  ContextEnrichmentSkill,
  IntentClassificationSkill,
];

export class SkillManager {
  private skills: Map<string, SkillRegistration> = new Map();
  private skillDir: string;
  private autoLoad: boolean;
  private configPath: string;

  constructor(skillDir?: string, autoLoad?: boolean, configPath?: string) {
    this.skillDir = skillDir || path.resolve(process.cwd(), 'src/core/skills/builtins');
    this.autoLoad = autoLoad ?? true;
    // Default to the path declared in config.yaml (skills.configPath).
    this.configPath = configPath || path.resolve(process.cwd(), getConfig().skills.configPath);
  }

  async initialize(): Promise<void> {
    if (this.autoLoad) {
      // 1. Register built-in skill classes (the actual implementations).
      for (const Ctor of BUILTIN_SKILL_CTORS) {
        try {
          await this.register(new Ctor());
        } catch (err) {
          logger.error('Failed to register built-in skill:', err);
        }
      }
      // 2. Merge declarative config (configs/skills.yaml) over the defaults —
      //    lets ops disable a skill or tweak triggers without code changes.
      await this.loadSkillsFromConfig(this.configPath);
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
    // Kept for backwards compatibility — initialize() now registers built-ins
    // via BUILTIN_SKILL_CTORS so the build (dist/) doesn't depend on src/.
    logger.debug('loadBuiltInSkills() is deprecated; built-ins are registered in initialize()');
  }

  async loadSkillsFromConfig(configPath: string): Promise<void> {
    try {
      if (!fs.existsSync(configPath)) {
        logger.warn(`Skills config not found: ${configPath}`);
        return;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = yaml.load(content) as { skills?: Partial<SkillConfig>[] };

      if (!parsed?.skills) return;

      for (const entry of parsed.skills) {
        if (!entry.id) continue;
        const registration = this.skills.get(entry.id);
        if (!registration) {
          logger.warn(`Skill in config has no implementation registered: ${entry.id}`);
          continue;
        }
        // Merge declarative overrides onto the registration's config — keep
        // implementation-supplied defaults for any field the yaml omits.
        registration.config = {
          ...registration.config,
          ...entry,
          id: registration.skill.id, // never let yaml change the id
        };
        logger.debug(`Skill config merged from yaml: ${entry.id}`, {
          enabled: registration.config.enabled,
          priority: registration.config.priority,
        });
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
