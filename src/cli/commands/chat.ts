/**
 * `orbit chat` — POST /chat (or /chat/stream) with optional sessionId.
 *
 * Multi-turn conversations just pass --session sess_xxx; the server replays
 * the Redis history automatically. There's no client-side message buffer.
 */
import { Command } from 'commander';
import axios from 'axios';
import chalk from 'chalk';
import { generateSessionId, now } from '../../utils/helpers';
import { apiPost } from '../http';
import { getToken } from '../config';
import { unwrap } from './_util';
import { renderPipelineTimeline } from './divination';

export function registerChat(program: Command): void {
  program
    .command('chat [message...]')
    .description('Send a message (POST /chat). Reads stdin if no args given.')
    .option('-m, --model <model>', 'Model id (e.g. deepseek-v4-flash)')
    .option('-p, --provider <provider>', 'Provider key (e.g. deepseek, siliconflow)')
    .option('-s, --session <id>', 'Session id for multi-turn; auto-generated if omitted')
    .option('--stream', 'Stream tokens via Server-Sent Events (POST /chat/stream)')
    .option('--system <text>', 'Prepend a system message (note: not all models honor it)')
    .option('--agent <id>', 'Agent id from configs/agents.yaml. Default agent for this project is the 六爻 specialist — pass `generic` if you want a vanilla LLM call without divination behaviour.')
    .option('--debug', 'Show the full multi-stage analysis pipeline timeline (build brief → LLM #1 understand → RAG retrieve → LLM #2 synthesize) plus RAG citations and tool calls.')
    .option('--thinking', 'Enable multi-angle thinking mode: the analyze pipeline runs 1 + N + 1 LLM calls (one per angle, each with its own RAG), then a final synthesis. Slower and more thorough than the default 3-stage pipeline.')
    .option('--angles <n>', 'Number of independent angles to investigate in --thinking mode. Clamped to 1–5, default 3.', (v) => parseInt(v, 10))
    .action(async (messageParts: string[], opts) => {
      const message = messageParts.length ? messageParts.join(' ') : await readStdin();
      if (!message.trim()) {
        console.error(chalk.red('✗ No message. Pass as arg or pipe via stdin.'));
        process.exit(2);
      }
      if (!getToken()) {
        console.error(chalk.red('✗ Not logged in. Run `orbit login --dev` first.'));
        process.exit(1);
      }

      const session = opts.session || generateSessionId();
      const body: any = { sessionId: session, message };
      // Only send model/provider in the body when the caller EXPLICITLY
      // passes --model / --provider. The agent's own model (from
      // configs/agents.yaml) is the source of truth — falling back to
      // ~/.orbit/config.json's defaultModel would silently override it
      // (e.g. "I set `default` agent to deepseek-v4-flash but my CLI
      // default is glm-4-flash, so /chat sends glm"). If the caller
      // didn't type --model, let the route pick the agent's model.
      if (opts.model) body.model = opts.model;
      if (opts.provider) body.provider = opts.provider;
      if (opts.system) body.systemPrompt = opts.system;
      if (opts.agent) body.agentId = opts.agent;
      if (opts.debug) body.debug = true;
      if (opts.thinking) body.thinking = true;
      if (Number.isFinite(opts.angles)) body.angles = opts.angles;

      if (opts.stream) {
        await runStream(body, session);
      } else {
        await runBlocking(body, session);
      }
    });
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise<string>((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
  });
}

async function runBlocking(body: any, session: string): Promise<void> {
  try {
    const data = await apiPost<any>('/chat', body);
    // data shape: { sessionId, content, model, provider, usage, toolCalls, debug? }
    process.stdout.write(data.content);
    if (!data.content.endsWith('\n')) process.stdout.write('\n');
    const thinkingTag = (data.debug && data.debug.thinking) ? ' • thinking' : '';
    process.stderr.write(chalk.gray(
      `\n[${data.model}/${data.provider} • session=${data.sessionId}` +
      ` • in=${data.usage?.inputTokens ?? 0} out=${data.usage?.outputTokens ?? 0}` +
      ` • cacheHit=${data.usage?.cacheHitTokens ?? 0}${thinkingTag}]\n`,
    ));
    if (body.debug && data.debug) {
      // Print the full multi-stage pipeline timeline. The render is
      // shared with `orbit divination analyze --debug` so the output
      // shape is consistent across both commands.
      if (data.debug.pipeline) {
        renderPipelineTimeline(data.debug.pipeline);
      }
      // Legacy rag block (citations + ragSearch) for backward compat.
      const rag = data.debug.rag || {};
      if ((rag.citations && rag.citations.length) || (rag.ragSearch && rag.ragSearch.length)) {
        process.stderr.write(chalk.cyan('RAG citations (final report):\n'));
        for (const c of rag.citations || []) {
          process.stderr.write(chalk.cyan(
            `  - ${c.source}  score=${(c.score ?? 0).toFixed(3)}\n` +
            `    ${(c.snippet || '').replace(/\s+/g, ' ').slice(0, 160)}\n`,
          ));
        }
        if (rag.ragSearch?.length) {
          process.stderr.write(chalk.cyan('\nExplicit rag-search tool calls:\n'));
          for (const h of rag.ragSearch) {
            process.stderr.write(chalk.cyan(
              `  - ${h.source} (${h.title})  score=${(h.score ?? 0).toFixed(3)}\n`,
            ));
          }
        }
      }
      if (data.debug.toolCalls?.length) {
        process.stderr.write(chalk.cyan('\nChat-loop tool calls:\n'));
        for (const t of data.debug.toolCalls) {
          process.stderr.write(chalk.cyan(
            `  - ${t.name} ${t.ok ? '✓' : '✗'}${t.error ? ` (${t.error})` : ''}\n`,
          ));
        }
      }
    }
  } catch (err: any) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

async function runStream(body: any, session: string): Promise<void> {
  const { getBaseUrl } = await import('../config');
  const token = getToken();
  if (!token) { console.error(chalk.red('✗ Not logged in.')); process.exit(1); }

  try {
    const response = await axios.post(`${getBaseUrl()}/chat/stream`, body, {
      responseType: 'stream',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 120_000,
    });

    let buffer = '';
    let tokens = { in: 0, out: 0, hit: 0, model: '' };
    await new Promise<void>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const evt = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of evt.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6);
            try {
              const m = JSON.parse(json);
              if (m.type === 'content' && m.content) {
                process.stdout.write(m.content);
              } else if (m.type === 'done') {
                tokens.in  = m.usage?.inputTokens  ?? tokens.in;
                tokens.out = m.usage?.outputTokens ?? tokens.out;
                tokens.hit = m.usage?.cacheHitTokens ?? tokens.hit;
                tokens.model = m.model || tokens.model;
              } else if (m.type === 'error') {
                process.stderr.write(chalk.red(`\n✗ ${m.error || 'stream error'}\n`));
              }
            } catch { /* ignore partial line */ }
          }
        }
      });
      response.data.on('end', () => resolve());
      response.data.on('error', (e: Error) => reject(e));
    });
    if (!buffer.endsWith('\n')) process.stdout.write('\n');
    process.stderr.write(chalk.gray(
      `\n[${tokens.model || body.model || '?'} • session=${session}` +
      ` • in=${tokens.in} out=${tokens.out} • cacheHit=${tokens.hit}]\n`,
    ));
  } catch (err: any) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

// Re-export so other commands can reuse the unwrap helper without
// re-importing it from http (keeps command files self-contained).
export { unwrap };
