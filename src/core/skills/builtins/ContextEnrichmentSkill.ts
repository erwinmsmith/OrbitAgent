import { BaseSkill } from '../types';
import type { SkillContext, SkillResult, SkillTrigger } from '../types';

/**
 * Adds derived context variables (message length, history depth, language hint)
 * to every conversation turn. Other downstream skills can read them via
 * `context.variables`.
 */
export default class ContextEnrichmentSkill extends BaseSkill {
  readonly id = 'context-enrichment';
  readonly name = 'Context Enrichment';
  readonly description = 'Enriches conversation context with derived signals';
  readonly version = '1.0.0';
  // Default triggers — overridden when the SkillManager merges configs/skills.yaml.
  triggers: SkillTrigger[] = [{ type: 'always', pattern: '' }];
  priority = 10;

  protected async run(context: SkillContext): Promise<SkillResult> {
    const msg = context.currentMessage.content || '';
    // crude language hint: any CJK char => zh, otherwise en.
    const language = /[一-鿿]/.test(msg) ? 'zh' : 'en';

    return {
      success: true,
      shouldContinue: true,
      variables: {
        messageLength: msg.length,
        historyTurns: context.messages.length,
        language,
      },
    };
  }
}
