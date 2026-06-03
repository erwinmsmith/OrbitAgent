/**
 * Agent loader — reads configs/agents.yaml once at boot and exposes
 * a typed lookup keyed by agent id. The /chat route uses this to
 * pick the right model + system prompt + skills + tools per request.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  skills: string[];
  tools: string[];
  systemPromptId: string;
}

let cache: Map<string, AgentConfig> | null = null;
let defaultId: string | null = null;

export function loadAgents(): Map<string, AgentConfig> {
  if (cache) return cache;
  const configPath = path.resolve(
    process.cwd(),
    (getConfig().agents as any).configPath || './configs/agents.yaml',
  );
  try {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as { agents: AgentConfig[] };
    const m = new Map<string, AgentConfig>();
    for (const a of raw.agents ?? []) m.set(a.id, a);
    if (!m.has('default') && m.size > 0) {
      defaultId = m.keys().next().value ?? null;
    } else {
      defaultId = 'default';
    }
    cache = m;
    logger.info('AgentLoader: loaded', { count: m.size, default: defaultId });
    return m;
  } catch (err) {
    logger.error('AgentLoader: failed to load agents.yaml:', err);
    cache = new Map();
    return cache;
  }
}

export function getAgent(id?: string): AgentConfig | undefined {
  const m = loadAgents();
  if (id) return m.get(id);
  return m.get(defaultId ?? 'default');
}

export function listAgents(): AgentConfig[] {
  return Array.from(loadAgents().values());
}
