/**
 * `orbit liuyao` — an interactive CLI app for the complete 六爻 flow.
 *
 * This deliberately stays a thin client: every reading goes through
 * POST /divination/ask, which does chart assembly + RAG-backed analysis
 * on the server and stores a chat turn for follow-up.
 */
import { Command } from 'commander';
import readline from 'readline';
import chalk from 'chalk';
import { apiGet, apiPost } from '../http';
import { postDivinationAsk, renderDivinationReading, renderPipelineTimeline } from './divination';

const DEFAULT_PROMPT = '请结合卦象分析、解答问题';
type LiuyaoAppMethod = 'manual' | 'coins' | 'time' | 'numbers' | 'character';

export function registerLiuyaoApp(program: Command): void {
  program
    .command('liuyao')
    .description('Start the interactive 六爻 CLI app (complete cast → chart → RAG analysis flow)')
    .option('--method <m>', 'Casting method in the app: manual|coins|time|numbers|character. If omitted, the app asks at startup.')
    .option('--thinking', 'Enable thinking mode for every reading in this app session', false)
    .option('--angles <n>', 'Number of thinking angles, clamped by the server to 1–5', (v) => parseInt(v, 10))
    .option('--timezone <tz>', 'Timezone passed to the calendar skill', 'Asia/Shanghai')
    .option('--debug', 'Show debug pipeline for ask/chat calls.', false)
    .option('--no-rag-check', 'Skip startup knowledge-base update check.')
    .action(async (opts) => {
      printLogo(opts);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

      try {
        if (opts.ragCheck !== false) await checkKnowledgeBase(false);
        let currentSessionId: string | null = await promptSessionChoice(ask);
        let method: LiuyaoAppMethod = opts.method ? normalizeMethod(opts.method) : 'coins';
        if (!currentSessionId) {
          const initialMethod = opts.method ? method : await promptMethod(ask);
          if (!initialMethod) return;
          method = initialMethod;
          printUsage(method);
          console.log();
        } else {
          console.log(chalk.gray(`已进入追问模式：${currentSessionId}`));
          console.log(chalk.gray('普通输入会作为追问发送给 Roy；输入 /new 可重新起卦，/help 查看命令。\n'));
        }

        while (true) {
          const input = (await ask(chalk.cyan(currentSessionId ? '追问 > ' : '问题 > '))).trim();
          if (isExit(input)) break;
          if (!input) continue;

          const commandResult = await handleAppCommand(input, {
            ask,
            getCurrentSession: () => currentSessionId,
            setCurrentSession: (sessionId) => { currentSessionId = sessionId; },
            getMethod: () => method,
            setMethod: (nextMethod) => {
              method = nextMethod;
              printUsage(method);
              console.log();
            },
          });
          if (commandResult === 'handled') continue;
          if (commandResult === 'exit') break;

          if (currentSessionId) {
            printStatus('Roy 正在读取当前会话并回复...');
            try {
              const data = await postChatFollowup(currentSessionId, input, opts);
              currentSessionId = data.sessionId || currentSessionId;
              printChatReply(data, opts);
            } catch (err: any) {
              console.log(chalk.red(`✗ ${err.message}`));
            }
            continue;
          }

          const sessionId = `sess_cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const castingInput = await promptCastingInput(method, ask);
          if (castingInput === 'exit') break;
          if (!castingInput) continue;

          const body: any = {
            sessionId,
            question: input,
            message: DEFAULT_PROMPT,
            timezone: opts.timezone,
            datetime: new Date().toISOString(),
            debug: !!opts.debug,
          };
          Object.assign(body, castingInput);
          const deepMode = opts.thinking || await promptDeepMode(ask, opts.angles);
          if (deepMode) body.thinking = true;
          if (Number.isFinite(opts.angles)) body.angles = opts.angles;

          printStatus('Roy 正在排盘并解卦...');
          try {
            const data = await postDivinationAsk(body);
            if (data._fallback) {
              console.log(chalk.yellow('⚠ 当前后端还没有 /divination/ask，已自动使用 chart → chat 兼容流程。重启 npm run dev 后会走新 API。'));
              console.log();
            }
            printReadingSummary(data);
            currentSessionId = data.sessionId || sessionId;
            printRoyMessage(data.content || '(no analysis content)');
            if (opts.debug && data.debug) renderPipelineTimeline(data.debug);
            console.log(chalk.gray(`\n当前 session：${currentSessionId}`));
            console.log(chalk.gray('继续输入会作为追问进入同一 session。输入 /new 重新起卦，/sessions 查看会话，/use <sessionId> 切换，/help 查看命令。\n'));
          } catch (err: any) {
            console.log(chalk.red(`✗ ${err.message}`));
          }
        }
      } finally {
        rl.close();
      }
    });
}

type CommandContext = {
  ask: (q: string) => Promise<string>;
  getCurrentSession: () => string | null;
  setCurrentSession: (sessionId: string | null) => void;
  getMethod: () => LiuyaoAppMethod;
  setMethod: (method: LiuyaoAppMethod) => void;
};

async function handleAppCommand(input: string, ctx: CommandContext): Promise<'handled' | 'exit' | 'none'> {
  if (!input.startsWith('/')) return 'none';
  const [cmd, ...args] = input.slice(1).trim().split(/\s+/).filter(Boolean);
  const command = (cmd || '').toLowerCase();
  if (!command) return 'none';

  if (['q', 'quit', 'exit'].includes(command)) return 'exit';
  if (['h', 'help'].includes(command)) {
    printAppCommands(ctx.getCurrentSession(), ctx.getMethod());
    return 'handled';
  }
  if (command === 'new') {
    if (args[0]) {
      try {
        ctx.setMethod(normalizeMethod(args[0]));
      } catch (err: any) {
        console.log(chalk.red(err.message));
        return 'handled';
      }
    }
    ctx.setCurrentSession(null);
    console.log(chalk.gray('已切换到新起卦模式。下一条「问题」会重新起卦。'));
    return 'handled';
  }
  if (command === 'method') {
    const next = args[0] ? normalizeMethod(args[0]) : await promptMethod(ctx.ask);
    if (next) ctx.setMethod(next);
    return 'handled';
  }
  if (command === 'sessions') {
    await printSessions(ctx.getCurrentSession());
    return 'handled';
  }
  if (command === 'use') {
    const sessionId = args[0];
    if (!sessionId) {
      console.log(chalk.red('用法：/use <sessionId>'));
      return 'handled';
    }
    ctx.setCurrentSession(sessionId);
    console.log(chalk.green(`已切换到 session：${sessionId}`));
    return 'handled';
  }
  if (command === 'history') {
    const sessionId = args[0] || ctx.getCurrentSession();
    if (!sessionId) {
      console.log(chalk.red('当前没有 session。用法：/history <sessionId>'));
      return 'handled';
    }
    await printHistory(sessionId);
    return 'handled';
  }
  if (command === 'rag-check') {
    await checkKnowledgeBase(true);
    return 'handled';
  }

  console.log(chalk.red(`未知命令：/${command}`));
  printAppCommands(ctx.getCurrentSession(), ctx.getMethod());
  return 'handled';
}

function normalizeMethod(value: string): LiuyaoAppMethod {
  const method = String(value || '').trim().toLowerCase();
  if (['1', 'manual', 'input', 'direct', '手动', '手动六爻'].includes(method)) return 'manual';
  if (['', '2', 'coins', 'coin', 'auto', 'random', '自动', '摇卦', '自动摇卦'].includes(method)) return 'coins';
  if (['3', 'time', 'datetime', 'date', '时间', '时间起卦'].includes(method)) return 'time';
  if (['4', 'numbers', 'number', 'num', '数字', '三数', '数字起卦'].includes(method)) return 'numbers';
  if (['5', 'character', 'char', 'hanzi', 'text', '汉字', '汉字起卦'].includes(method)) return 'character';
  throw new Error(`未知起卦方式 "${value}"`);
}

async function promptMethod(ask: (q: string) => Promise<string>): Promise<LiuyaoAppMethod | null> {
  while (true) {
    console.log(chalk.gray('请选择起卦方式：'));
    console.log(chalk.gray('  1. 手动六爻       输入 6 个 6/7/8/9 或 0/1'));
    console.log(chalk.gray('  2. 自动摇卦       模拟三枚硬币摇六次'));
    console.log(chalk.gray('  3. 时间起卦       使用当前时间'));
    console.log(chalk.gray('  4. 数字起卦       输入 3 个数字'));
    console.log(chalk.gray('  5. 汉字起卦       输入 1 个汉字'));
    const raw = (await ask(chalk.cyan('方式 [2] > '))).trim();
    if (isExit(raw)) return null;
    try {
      return normalizeMethod(raw || '2');
    } catch (err: any) {
      console.log(chalk.red(err.message));
      console.log();
    }
  }
}

async function promptSessionChoice(ask: (q: string) => Promise<string>): Promise<string | null> {
  let conversations: any[] = [];
  try {
    conversations = await listPermanentConversations();
  } catch (err: any) {
    console.log(chalk.yellow(`历史会话暂不可用：${err.message}`));
    return null;
  }
  if (conversations.length === 0) return null;
  console.log(chalk.gray('最近会话：'));
  conversations.slice(0, 8).forEach((c, i) => {
    const title = c.title || c.sessionId;
    const when = c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '';
    console.log(chalk.gray(`  ${i + 1}. ${title}  ${chalk.cyan(c.sessionId)} ${when ? chalk.gray(when) : ''}`));
  });
  console.log(chalk.gray('直接回车新建会话；输入序号或 sessionId 切换历史会话。'));
  while (true) {
    const raw = (await ask(chalk.cyan('会话 [new] > '))).trim();
    if (isExit(raw)) return null;
    if (!raw || raw.toLowerCase() === 'new') return null;
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 1 && index <= conversations.length) {
      const sessionId = conversations[index - 1]!.sessionId;
      console.log(chalk.green(`已进入历史会话：${sessionId}`));
      return sessionId;
    }
    const match = conversations.find((c) => c.sessionId === raw);
    if (match) {
      console.log(chalk.green(`已进入历史会话：${match.sessionId}`));
      return match.sessionId;
    }
    console.log(chalk.red('没有找到该会话。请输入序号、sessionId，或回车新建。'));
  }
}

async function promptDeepMode(ask: (q: string) => Promise<string>, angles: number | undefined): Promise<boolean> {
  const label = Number.isFinite(angles) ? `深度推演（${angles} 个角度）` : '深度推演';
  while (true) {
    const raw = (await ask(chalk.cyan(`${label}？[y/N] > `))).trim().toLowerCase();
    if (isExit(raw)) return false;
    if (!raw || raw === 'n' || raw === 'no' || raw === '否') return false;
    if (raw === 'y' || raw === 'yes' || raw === '是') return true;
    console.log(chalk.red('请输入 y 或 n。'));
  }
}

function printUsage(method: LiuyaoAppMethod): void {
  const methodLabel = {
    manual: '手动六爻',
    coins: '自动摇卦',
    time: '时间起卦',
    numbers: '三数起卦',
    character: '汉字起卦',
  }[method];
  console.log(chalk.gray(`当前起卦方式：${methodLabel}。每次都会完成：起卦 → 排盘 → RAG 解卦 → 可继续追问的 session。`));
  if (method === 'manual') {
    console.log(chalk.gray('爻值顺序：初爻到上爻，自下而上。支持 6/7/8/9；也支持 0/1 静卦。输入 /exit 退出。'));
  } else if (method === 'coins') {
    console.log(chalk.gray('每次输入问题后自动模拟三枚硬币摇六次；输入 /exit 退出。'));
  } else if (method === 'time') {
    console.log(chalk.gray('每次输入问题后按当前时间起卦；输入 /exit 退出。'));
  } else if (method === 'numbers') {
    console.log(chalk.gray('每次输入问题后继续输入 3 个数字：第 1 数上卦，第 2 数下卦，第 3 数动爻；输入 /exit 退出。'));
  } else {
    console.log(chalk.gray('每次输入问题后继续输入 1 个汉字；优先按笔画起卦，查不到用 Unicode 兜底；输入 /exit 退出。'));
  }
}

function printAppCommands(currentSessionId: string | null, method: LiuyaoAppMethod): void {
  console.log(chalk.gray('可用命令：'));
  console.log(chalk.gray('  /new [method]        重新起卦，可选 method: manual|coins|time|numbers|character'));
  console.log(chalk.gray('  /method [method]     切换下一次起卦方式'));
  console.log(chalk.gray('  /sessions            查看当前用户的历史会话'));
  console.log(chalk.gray('  /use <sessionId>     切换到已有 session，后续输入作为追问'));
  console.log(chalk.gray('  /history [sessionId] 查看当前或指定 session 最近消息'));
  console.log(chalk.gray('  /rag-check           手动检查知识库文件并按需更新 embedding'));
  console.log(chalk.gray('  /exit                退出'));
  console.log(chalk.gray(`当前 method=${method}${currentSessionId ? `，session=${currentSessionId}` : '，尚未起卦'}`));
}

async function promptCastingInput(
  method: LiuyaoAppMethod,
  ask: (q: string) => Promise<string>,
): Promise<Record<string, unknown> | 'exit' | null> {
  if (method === 'coins') return { casting: { method: 'coins' } };
  if (method === 'time') return { casting: { method: 'time' } };

  if (method === 'numbers') {
    const rawNumbers = (await ask(chalk.cyan('数字 > '))).trim();
    if (isExit(rawNumbers)) return 'exit';
    const numbers = parseThreeNumbers(rawNumbers);
    if (!numbers) {
      console.log(chalk.red('请输入 3 个数字，例如：2 9 5'));
      return null;
    }
    return { casting: { method: 'numbers', numbers } };
  }

  if (method === 'character') {
    const rawCharacter = (await ask(chalk.cyan('汉字 > '))).trim();
    if (isExit(rawCharacter)) return 'exit';
    const characters = Array.from(rawCharacter);
    if (characters.length !== 1) {
      console.log(chalk.red('请输入 1 个汉字，例如：财'));
      return null;
    }
    return { casting: { method: 'character', character: characters[0] } };
  }

  const rawValues = (await ask(chalk.cyan('六爻 > '))).trim();
  if (isExit(rawValues)) return 'exit';
  const parsed = parseLineValues(rawValues);
  if (!parsed) {
    console.log(chalk.red('请输入 6 个数字，例如：7 8 7 9 7 8 或 1 1 1 1 1 1'));
    return null;
  }
  return parsed.kind === 'bits'
    ? { bits: parsed.values }
    : { yaoValues: parsed.values };
}

async function postChatFollowup(sessionId: string, message: string, opts: any): Promise<any> {
  const body: any = {
    sessionId,
    message,
    debug: !!opts.debug,
  };
  if (opts.thinking) body.thinking = true;
  if (Number.isFinite(opts.angles)) body.angles = opts.angles;
  return apiPost<any>('/chat', body);
}

function printChatReply(data: any, opts: any): void {
  printRoyMessage(data.content || '(no response content)');
  if (opts.debug && data.debug) {
    renderPipelineTimeline(data.debug.pipeline || data.debug);
  }
  const usage = data.usage
    ? ` in=${data.usage.inputTokens ?? 0} out=${data.usage.outputTokens ?? 0}`
    : '';
  console.log(chalk.gray(`\n[session=${data.sessionId}${usage}]`));
  console.log(chalk.gray('继续输入可追问；输入 /new 重新起卦。\n'));
}

async function listPermanentConversations(): Promise<any[]> {
  const data = await apiGet<any[]>('/memory/permanent', { pageSize: 20 });
  return Array.isArray(data) ? data : [];
}

async function printSessions(currentSessionId: string | null): Promise<void> {
  try {
    const conversations = await listPermanentConversations();
    if (conversations.length === 0) {
      console.log(chalk.gray('(当前用户没有历史会话)'));
      return;
    }
    console.log(chalk.gray('当前用户历史会话：'));
    conversations.forEach((c, i) => {
      const active = currentSessionId === c.sessionId ? chalk.green(' *') : '  ';
      const title = c.title || c.sessionId;
      const when = c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '';
      console.log(`${active}${i + 1}. ${chalk.cyan(c.sessionId)}  ${title}${when ? chalk.gray(`  ${when}`) : ''}`);
    });
  } catch (err: any) {
    console.log(chalk.red(`✗ ${err.message}`));
  }
}

async function printHistory(sessionId: string): Promise<void> {
  try {
    const conversations = await listPermanentConversations();
    const conversation = conversations.find((c) => c.sessionId === sessionId);
    const messages = conversation
      ? await apiGet<any[]>(`/memory/permanent/${encodeURIComponent(conversation.id)}/messages`, { pageSize: 8 })
      : await apiGet<any[]>(`/chat/${encodeURIComponent(sessionId)}`, { limit: 6 });
    if (!Array.isArray(messages) || messages.length === 0) {
      console.log(chalk.gray(`(no history for ${sessionId})`));
      return;
    }
    console.log(chalk.gray(`session ${sessionId} 最近消息：`));
    for (const m of messages) {
      const who = m.role === 'user' ? chalk.cyan('You') : chalk.green('Roy');
      const content = String(m.content || '').replace(/\s+/g, ' ').slice(0, 240);
      console.log(`${who}: ${content}${content.length >= 240 ? '...' : ''}`);
    }
  } catch (err: any) {
    console.log(chalk.red(`✗ ${err.message}`));
  }
}

async function checkKnowledgeBase(manual: boolean): Promise<void> {
  try {
    printStatus(manual ? '正在检查知识库更新...' : '启动检查知识库更新...');
    const r = await apiPost<any>('/divination/rag/rebuild');
    const skipped = r.skipped ?? 0;
    const ingested = r.ingested ?? 0;
    const deleted = r.deleted ?? 0;
    console.log(chalk.gray(`知识库检查完成：更新 ${ingested}，跳过 ${skipped}，删除 ${deleted}。`));
  } catch (err: any) {
    const msg = String(err.message || err);
    console.log(chalk.yellow(`知识库检查跳过：${msg}`));
  }
}

function parseThreeNumbers(raw: string): [number, number, number] | null {
  const values = raw.split(/[,\s]+/).filter(Boolean).map((v) => Number(v));
  if (values.length !== 3 || values.some((v) => !Number.isFinite(v))) return null;
  return values.map((v) => Math.trunc(v)) as [number, number, number];
}

function printLogo(opts: any): void {
  const coin = chalk.yellow.bold('◯');
  const hole = chalk.gray('□');
  console.log(chalk.bold(`
 ${coin} ${coin} ${coin}
${chalk.yellow('╭─────╮ ╭─────╮ ╭─────╮')}
${chalk.yellow('│')}  ${hole}  ${chalk.yellow('│ │')}  ${hole}  ${chalk.yellow('│ │')}  ${hole}  ${chalk.yellow('│')}
${chalk.yellow('╰─────╯ ╰─────╯ ╰─────╯')}
 Orbit Liuyao · Roy
`));
  console.log(chalk.gray('────────────────────────────────────────────────────────────'));
  console.log(`${chalk.green('Roy')}  六爻 Agent · RAG 解卦 · 多会话记忆`);
  console.log(chalk.gray(`     深度推演：${opts.thinking ? '默认开启' : '解卦前询问'} · 输入 /help 查看命令`));
  console.log(chalk.gray('────────────────────────────────────────────────────────────'));
}

function printStatus(text: string): void {
  console.log();
  console.log(chalk.gray('────────────────────────────────────────────────────────────'));
  console.log(`${chalk.green('Roy')} ${chalk.gray(text)}`);
  console.log(chalk.gray('────────────────────────────────────────────────────────────'));
  console.log();
}

function printRoyMessage(content: string): void {
  console.log(chalk.green('Roy'));
  console.log(chalk.gray('────────────────────────────────────────────────────────────'));
  console.log(content);
  console.log(chalk.gray('────────────────────────────────────────────────────────────'));
}

function isExit(value: string): boolean {
  return ['/q', '/quit', '/exit', 'exit', 'quit'].includes(value.trim().toLowerCase());
}

function parseLineValues(raw: string): { kind: 'bits' | 'yaoValues'; values: number[] } | null {
  const values = raw.split(/[,\s]+/).filter(Boolean).map((v) => Number(v));
  if (values.length !== 6 || values.some((v) => !Number.isInteger(v))) return null;
  if (values.every((v) => v === 0 || v === 1)) return { kind: 'bits', values };
  if (values.every((v) => [6, 7, 8, 9].includes(v))) return { kind: 'yaoValues', values };
  return null;
}

function printReadingSummary(data: any): void {
  renderDivinationReading(data);
  console.log();
}
