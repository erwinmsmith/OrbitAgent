import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
  WorkflowDefinition,
  WorkflowStage,
  WorkflowExecution,
  WorkflowExecutionContext,
  StageResult,
  IWorkflowEngine,
} from './types';
import { getSkillManager } from '../skills/SkillManager';
import { getToolManager } from '../tools/ToolManager';
import { getLLMManager } from '../llm/LLMFactory';
import { logger } from '../../utils/logger';
import { generateId, now } from '../../utils/helpers';
import { LLMMessage } from '../llm/types';

export class WorkflowEngine implements IWorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private workflowDir: string;
  private autoReload: boolean;
  private reloadInterval: NodeJS.Timeout | null = null;

  constructor(workflowDir?: string, autoReload?: boolean) {
    this.workflowDir = workflowDir || path.resolve(process.cwd(), 'configs/workflows');
    this.autoReload = autoReload ?? true;
  }

  async initialize(): Promise<void> {
    await this.loadWorkflowsFromDir();

    if (this.autoReload) {
      // Set up file watcher for auto-reload in production
      this.reloadInterval = setInterval(() => {
        this.loadWorkflowsFromDir().catch(err => {
          logger.error('Failed to reload workflows:', err);
        });
      }, 60000); // Check every minute
    }

    logger.info('WorkflowEngine initialized', { workflowCount: this.workflows.size });
  }

  async destroy(): Promise<void> {
    if (this.reloadInterval) {
      clearInterval(this.reloadInterval);
      this.reloadInterval = null;
    }

    // Cancel all running executions
    for (const [id, execution] of this.executions) {
      if (execution.status === 'running') {
        execution.status = 'cancelled';
        execution.completedAt = now();
      }
    }

    this.executions.clear();
    this.workflows.clear();
    logger.info('WorkflowEngine destroyed');
  }

  loadWorkflow(workflow: WorkflowDefinition): void {
    const key = this.getWorkflowKey(workflow.name, workflow.version);
    this.workflows.set(key, workflow);
    logger.info(`Workflow loaded: ${workflow.name} v${workflow.version}`);
  }

  unloadWorkflow(name: string, version?: string): void {
    const key = this.getWorkflowKey(name, version);
    this.workflows.delete(key);
    logger.info(`Workflow unloaded: ${name}`);
  }

  getWorkflow(name: string, version?: string): WorkflowDefinition | null {
    const key = this.getWorkflowKey(name, version);
    let workflow = this.workflows.get(key);

    // If no version specified, find the latest version
    if (!version && !workflow) {
      workflow = this.findLatestWorkflow(name) || undefined;
    }

    return workflow || null;
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  async execute(
    workflowName: string,
    context: WorkflowExecutionContext,
    version?: string
  ): Promise<WorkflowExecution> {
    const workflow = this.getWorkflow(workflowName, version);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowName}`);
    }

    const execution: WorkflowExecution = {
      id: generateId(),
      workflowName: workflow.name,
      workflowVersion: workflow.version,
      status: 'pending',
      context: {
        ...context,
        variables: {
          ...workflow.variables,
          ...context.variables,
        },
      },
      stageResults: new Map(),
      startedAt: now(),
    };

    this.executions.set(execution.id, execution);
    execution.status = 'running';

    logger.info(`Starting workflow execution: ${workflowName}`, { executionId: execution.id });

    try {
      await this.executeStages(workflow, execution);
      execution.status = 'completed';
      execution.completedAt = now();
      logger.info(`Workflow completed: ${workflowName}`, { executionId: execution.id });
    } catch (error: any) {
      execution.status = 'failed';
      execution.error = error.message;
      execution.completedAt = now();
      logger.error(`Workflow failed: ${workflowName}`, { executionId: execution.id, error: error.message });
    }

    return execution;
  }

  async cancel(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution && execution.status === 'running') {
      execution.status = 'cancelled';
      execution.completedAt = now();
      logger.info(`Workflow cancelled: ${executionId}`);
    }
  }

  getExecution(executionId: string): WorkflowExecution | null {
    return this.executions.get(executionId) || null;
  }

  private async executeStages(workflow: WorkflowDefinition, execution: WorkflowExecution): Promise<void> {
    let currentStageId: string | undefined = workflow.stages[0]?.id;
    const visitedStages = new Set<string>();

    while (currentStageId && currentStageId !== 'end' && execution.status === 'running') {
      // Prevent infinite loops
      if (visitedStages.has(currentStageId)) {
        throw new Error(`Circular dependency detected in workflow: ${currentStageId}`);
      }
      visitedStages.add(currentStageId);

      const stage = workflow.stages.find(s => s.id === currentStageId);
      if (!stage) {
        throw new Error(`Stage not found: ${currentStageId}`);
      }

      execution.currentStage = currentStageId;
      logger.debug(`Executing stage: ${stage.id} (${stage.type})`, { executionId: execution.id });

      const startTime = Date.now();

      try {
        const result = await this.executeStage(stage, execution);

        const stageResult: StageResult = {
          stageId: stage.id,
          success: result.success,
          output: result.output,
          error: result.error,
          duration: Date.now() - startTime,
          metadata: result.metadata,
        };

        execution.stageResults.set(stage.id, stageResult);

        if (!result.success && stage.onError === 'stop') {
          throw new Error(result.error || 'Stage failed');
        }

        currentStageId = result.nextStage || stage.next || 'end';
      } catch (error: any) {
        execution.stageResults.set(stage.id, {
          stageId: stage.id,
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
        });

        if (stage.onError === 'stop' || !stage.next) {
          throw error;
        }

        currentStageId = stage.onError || 'end';
      }
    }
  }

  private async executeStage(
    stage: WorkflowStage,
    execution: WorkflowExecution
  ): Promise<{
    success: boolean;
    output?: any;
    error?: string;
    nextStage?: string;
    metadata?: Record<string, any>;
  }> {
    switch (stage.type) {
      case 'preprocessor':
      case 'postprocessor':
        return this.executeSkillStage(stage, execution);

      case 'llm':
        return this.executeLLMStage(stage, execution);

      case 'tool-call':
        return this.executeToolStage(stage, execution);

      case 'conditional':
        return this.executeConditionalStage(stage, execution);

      case 'end':
        return { success: true, output: null, nextStage: 'end' };

      default:
        return { success: false, error: `Unknown stage type: ${stage.type}` };
    }
  }

  private async executeSkillStage(
    stage: WorkflowStage,
    execution: WorkflowExecution
  ): Promise<{ success: boolean; output?: any; error?: string; nextStage?: string }> {
    if (!stage.skills || stage.skills.length === 0) {
      return { success: true, nextStage: stage.next };
    }

    const skillManager = getSkillManager();
    const lastOutput: any = null;

    for (const skillId of stage.skills) {
      const skill = skillManager.getSkill(skillId);
      if (!skill) {
        logger.warn(`Skill not found: ${skillId}`);
        continue;
      }

      const result = await skill.execute({
        userId: execution.context.userId,
        sessionId: execution.context.sessionId,
        conversationId: execution.context.conversationId,
        messages: execution.context.messages,
        currentMessage: execution.context.messages[execution.context.messages.length - 1],
        variables: execution.context.variables,
        metadata: execution.context.metadata,
      });

      if (result.success) {
        execution.context.variables = { ...execution.context.variables, ...result.variables };
      } else {
        return { success: false, error: result.error };
      }
    }

    return { success: true, nextStage: stage.next };
  }

  private async executeLLMStage(
    stage: WorkflowStage,
    execution: WorkflowExecution
  ): Promise<{ success: boolean; output?: any; error?: string; nextStage?: string }> {
    const llmManager = getLLMManager();

    // Convert messages to LLM format
    const messages: LLMMessage[] = execution.context.messages.map(msg => ({
      role: msg.role as LLMMessage['role'],
      content: msg.content,
    }));

    // Add system prompt if specified
    const options: any = {};
    if (stage.prompt) {
      options.systemPrompt = this.resolveVariables(stage.prompt, execution.context.variables);
    }

    try {
      const response = await llmManager.chat(messages, {
        ...options,
        model: stage.model,
      });

      // Add response to context
      execution.context.messages.push({
        id: generateId(),
        role: 'assistant',
        content: response.content,
        timestamp: now(),
      });

      return {
        success: true,
        output: response.content,
        nextStage: stage.next,
        metadata: { usage: response.usage },
      } as { success: boolean; output?: any; error?: string; nextStage?: string; metadata?: any };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeToolStage(
    stage: WorkflowStage,
    execution: WorkflowExecution
  ): Promise<{ success: boolean; output?: any; error?: string; nextStage?: string }> {
    if (!stage.tools || stage.tools.length === 0) {
      return { success: true, nextStage: stage.next };
    }

    const toolManager = getToolManager();

    for (const toolName of stage.tools) {
      const params = this.resolveVariables(
        execution.context.variables.toolParams || {},
        execution.context.variables
      );

      const result = await toolManager.executeTool(toolName, params);

      if (result.success) {
        execution.context.variables.toolResults = {
          ...execution.context.variables.toolResults,
          [toolName]: result.output,
        };
      } else {
        return { success: false, error: result.error };
      }
    }

    return { success: true, nextStage: stage.next };
  }

  private async executeConditionalStage(
    stage: WorkflowStage,
    execution: WorkflowExecution
  ): Promise<{ success: boolean; output?: any; error?: string; nextStage?: string }> {
    if (!stage.condition || !stage.branches) {
      return { success: true, nextStage: stage.next };
    }

    // Evaluate condition
    const conditionMet = this.evaluateCondition(stage.condition, execution.context.variables);

    // Find matching branch
    const branch = stage.branches.find(b =>
      b.condition === 'true' && conditionMet ||
      b.condition === 'false' && !conditionMet
    ) || stage.branches.find(b => b.condition === 'default');

    if (branch) {
      return { success: true, nextStage: branch.then };
    }

    return { success: true, nextStage: stage.next };
  }

  private evaluateCondition(condition: string, variables: Record<string, any>): boolean {
    // Simple condition evaluation
    try {
      // Replace variable references
      let expr = condition;
      for (const [key, value] of Object.entries(variables)) {
        expr = expr.replace(new RegExp(`\\$${key}`, 'g'), JSON.stringify(value));
      }

      // Evaluate as expression
      return !!eval(expr);
    } catch {
      logger.warn(`Failed to evaluate condition: ${condition}`);
      return false;
    }
  }

  private resolveVariables(template: any, variables: Record<string, any>): any {
    if (typeof template === 'string') {
      let result = template;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
        result = result.replace(new RegExp(`\\$${key}`, 'g'), String(value));
      }
      return result;
    }

    if (Array.isArray(template)) {
      return template.map(item => this.resolveVariables(item, variables));
    }

    if (template && typeof template === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.resolveVariables(value, variables);
      }
      return result;
    }

    return template;
  }

  private async loadWorkflowsFromDir(): Promise<void> {
    try {
      if (!fs.existsSync(this.workflowDir)) {
        logger.warn(`Workflow directory not found: ${this.workflowDir}`);
        return;
      }

      const files = fs.readdirSync(this.workflowDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of files) {
        try {
          const filePath = path.join(this.workflowDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const workflow = yaml.load(content) as WorkflowDefinition;

          if (workflow && workflow.name && workflow.stages) {
            this.loadWorkflow(workflow);
          }
        } catch (error) {
          logger.error(`Failed to load workflow from ${file}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to load workflows from directory:', error);
    }
  }

  private getWorkflowKey(name: string, version?: string): string {
    return version ? `${name}:${version}` : name;
  }

  private findLatestWorkflow(name: string): WorkflowDefinition | null {
    let latest: WorkflowDefinition | null = null;

    for (const workflow of this.workflows.values()) {
      if (workflow.name === name) {
        if (!latest || this.compareVersions(workflow.version, latest.version) > 0) {
          latest = workflow;
        }
      }
    }

    return latest;
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }

    return 0;
  }
}

// Singleton instance
let workflowEngineInstance: WorkflowEngine | null = null;

export function getWorkflowEngine(): WorkflowEngine {
  if (!workflowEngineInstance) {
    workflowEngineInstance = new WorkflowEngine();
  }
  return workflowEngineInstance;
}

export async function initializeWorkflowEngine(): Promise<WorkflowEngine> {
  const engine = getWorkflowEngine();
  await engine.initialize();
  return engine;
}

export async function destroyWorkflowEngine(): Promise<void> {
  if (workflowEngineInstance) {
    await workflowEngineInstance.destroy();
    workflowEngineInstance = null;
  }
}

export default WorkflowEngine;
