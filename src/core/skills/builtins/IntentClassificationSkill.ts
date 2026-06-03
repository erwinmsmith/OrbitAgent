import { BaseSkill } from '../types';
import type { SkillContext, SkillResult, SkillTrigger } from '../types';

/**
 * Keyword-only intent classifier. Sets `context.variables.intent` so other
 * skills / agents can branch on it without calling another LLM.
 *
 * This is intentionally simple — real intent detection would go through a
 * dedicated model. The point here is that the skill pipeline runs end-to-end
 * and the value lands in the chat handler's contextVariables.
 */
export default class IntentClassificationSkill extends BaseSkill {
  readonly id = 'intent-classification';
  readonly name = 'Intent Classification';
  readonly description = 'Classifies user intent via keyword heuristics';
  readonly version = '1.0.0';
  triggers: SkillTrigger[] = [{ type: 'always', pattern: '' }];
  priority = 5;

  private static readonly INTENTS: Array<[string, RegExp]> = [
    ['help', /\b(help|usage|how to|怎么|如何|帮助)\b/i],
    ['question', /\?|？|why|what|when|where|who|how/i],
    ['command', /^\s*[\/!](\w+)/],
  ];

  protected async run(context: SkillContext): Promise<SkillResult> {
    const msg = context.currentMessage.content || '';
    let intent = 'chat';
    for (const [name, re] of IntentClassificationSkill.INTENTS) {
      if (re.test(msg)) { intent = name; break; }
    }
    return {
      success: true,
      shouldContinue: true,
      variables: { intent },
    };
  }
}
