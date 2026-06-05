/**
 * `orbit liuyao` — interactive 六爻 CLI.
 *
 * This command is intentionally a presentation layer. Casting, chart
 * assembly, RAG retrieval, analysis, and memory persistence still go
 * through the existing API flow.
 */
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import readline from 'readline';
import chalk from 'chalk';
import { apiGet, apiPost } from '../http';
import { postDivinationAsk, renderDivinationReading, renderPipelineTimeline } from './divination';

const DEFAULT_PROMPT = [
  '请结合卦象分析、解答问题。',
  '交互式 CLI 场景下，请先给短结论，再给 3 个以内关键依据。',
  '语言要自然，和用户语言一致；不要默认写成论文式长报告。',
  '可保留足够细节，供用户通过 /why 展开。',
].join('');

const BOX_WIDTH = 72;
const CORE_COMMANDS = '/new  /chart  /why  /rag  /tools  /sessions  /help  /exit';

type LiuyaoAppMethod = 'manual' | 'coins' | 'time' | 'numbers' | 'character';

type AppState = {
  currentSessionId: string | null;
  method: LiuyaoAppMethod;
  lastQuestion: string | null;
  lastReading: any | null;
  lastChat: any | null;
  ragEnabled: boolean;
  memoryEnabled: boolean;
  thinkingLabel: string;
};

export function registerLiuyaoApp(program: Command): void {
  program
    .command('liuyao')
    .description('Start the interactive 六爻 CLI app (complete cast → chart → RAG analysis flow)')
    .option('--method <m>', 'Casting method in the app: manual|coins|time|numbers|character. If omitted, the app asks at startup.')
    .option('--thinking', 'Enable thinking mode for every reading in this app session', false)
    .option('--angles <n>', 'Number of thinking angles, clamped by the server to 1–5', (v) => parseInt(v, 10))
    .option('--timezone <tz>', 'Timezone passed to the calendar skill', 'Asia/Shanghai')
    .option('--debug', 'Show raw debug pipeline after ask/chat calls.', false)
    .option('--no-rag-check', 'Skip startup knowledge-base update check.')
    .action(async (opts) => {
      const state: AppState = {
        currentSessionId: null,
        method: opts.method ? normalizeMethod(opts.method) : 'coins',
        lastQuestion: null,
        lastReading: null,
        lastChat: null,
        ragEnabled: true,
        memoryEnabled: true,
        thinkingLabel: opts.thinking
          ? `on (${Number.isFinite(opts.angles) ? opts.angles : 3} angles)`
          : 'off',
      };

      printLogo(state);
      printStartupCommands();

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

      try {
        if (opts.ragCheck !== false) await checkKnowledgeBase(false);

        state.currentSessionId = await promptSessionChoice(ask);
        printConversationHeader(state);

        if (!state.currentSessionId) {
          const initialMethod = opts.method ? state.method : await promptMethod(ask);
          if (!initialMethod) return;
          state.method = initialMethod;
          printMethodConfirmation(state.method);
        } else {
          printRoyLines([
            `已进入历史会话：${state.currentSessionId}`,
            '普通输入会作为追问发送给 Roy；输入 /new 可重新起卦。',
          ]);
        }

        while (true) {
          const input = (await ask(chalk.cyan('你 > '))).trim();
          if (isExit(input)) break;
          if (!input) continue;

          const commandResult = await handleAppCommand(input, state, opts, ask);
          if (commandResult === 'handled') continue;
          if (commandResult === 'exit') break;

          if (state.currentSessionId) {
            await runFollowup(input, state, opts);
            continue;
          }

          await runNewReading(input, state, opts, ask);
        }
      } finally {
        rl.close();
      }
    });
}

async function runNewReading(
  question: string,
  state: AppState,
  opts: any,
  ask: (q: string) => Promise<string>,
): Promise<void> {
  const sessionId = `sess_cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const castingInput = await promptCastingInput(state.method, ask);
  if (castingInput === 'exit') return;
  if (!castingInput) return;

  const deepMode = opts.thinking || await promptDeepMode(ask, opts.angles);
  state.thinkingLabel = deepMode
    ? `on (${Number.isFinite(opts.angles) ? opts.angles : 3} angles)`
    : 'off';

  const body: any = {
    sessionId,
    question,
    message: DEFAULT_PROMPT,
    timezone: opts.timezone,
    datetime: new Date().toISOString(),
    // Interactive mode keeps structured internals for /tools and /rag,
    // but the default screen renders a concise user-facing view.
    debug: true,
  };
  Object.assign(body, castingInput);
  if (deepMode) body.thinking = true;
  if (Number.isFinite(opts.angles)) body.angles = opts.angles;

  printWorkingBox('Roy 正在起卦、排盘、检索依据并生成分析...');
  try {
    const data = await postDivinationAsk(body);
    if (data._fallback) {
      printBox('Notice', ['当前后端还没有 /divination/ask，已自动使用 chart → chat 兼容流程。']);
    }
    state.currentSessionId = data.sessionId || sessionId;
    state.lastQuestion = question;
    state.lastReading = data;
    state.lastChat = null;

    printConversationHeader(state);
    printRunningBlock(data);
    printChartSummary(data, question);
    printAssistantBrief(data);
    if (opts.debug && data.debug) renderPipelineTimeline(data.debug);
  } catch (err: any) {
    printBox('Error', [String(err.message || err)]);
  }
}

async function runFollowup(input: string, state: AppState, opts: any): Promise<void> {
  printWorkingBox('Roy 正在读取当前会话并回复...');
  try {
    const data = await postChatFollowup(state.currentSessionId!, input, opts);
    state.currentSessionId = data.sessionId || state.currentSessionId;
    state.lastChat = data;
    printAssistantMessage(data.content || '(no response content)');
    if (opts.debug && data.debug) {
      renderPipelineTimeline(data.debug.pipeline || data.debug);
    }
  } catch (err: any) {
    printBox('Error', [String(err.message || err)]);
  }
}

type CommandResult = 'handled' | 'exit' | 'none';

async function handleAppCommand(
  input: string,
  state: AppState,
  opts: any,
  ask: (q: string) => Promise<string>,
): Promise<CommandResult> {
  if (!input.startsWith('/')) return 'none';
  const [cmd, ...args] = input.slice(1).trim().split(/\s+/).filter(Boolean);
  const command = (cmd || '').toLowerCase();
  if (!command) return 'none';

  if (['q', 'quit', 'exit'].includes(command)) return 'exit';
  if (['h', 'help'].includes(command)) {
    printAppCommands(state);
    return 'handled';
  }
  if (command === 'new') {
    if (args[0]) {
      try {
        state.method = normalizeMethod(args[0]);
      } catch (err: any) {
        printBox('Error', [err.message]);
        return 'handled';
      }
    }
    state.currentSessionId = null;
    state.lastQuestion = null;
    state.lastReading = null;
    state.lastChat = null;
    printConversationHeader(state);
    printRoyLines([
      `已切换到新起卦模式，当前方式：${methodLabel(state.method)}。`,
      '下一条输入会作为新问题重新起卦。',
    ]);
    return 'handled';
  }
  if (command === 'method') {
    const next = args[0] ? normalizeMethod(args[0]) : await promptMethod(ask);
    if (next) {
      state.method = next;
      printMethodConfirmation(next);
    }
    return 'handled';
  }
  if (command === 'chart') {
    if (!state.lastReading) {
      printBox('Chart', ['当前会话还没有可展示的排盘。先输入问题起卦，或 /use 切换到已有会话后继续追问。']);
      return 'handled';
    }
    if (['full', '--full', '-f'].includes((args[0] || '').toLowerCase())) {
      renderDivinationReading(state.lastReading);
    } else {
      printChartSummary(state.lastReading, state.lastQuestion || undefined);
      printBox('Hint', ['完整六爻表和卦画：/chart full']);
    }
    return 'handled';
  }
  if (command === 'why') {
    if (!state.lastReading) {
      printBox('Analysis trace', ['当前没有可展开的起卦分析。']);
      return 'handled';
    }
    printAnalysisTrace(state.lastReading);
    printAssistantMessage(cleanReportForDisplay(state.lastReading.content || ''));
    return 'handled';
  }
  if (command === 'rag') {
    if ((args[0] || '').toLowerCase() === 'check') {
      await checkKnowledgeBase(true);
    } else {
      printRagSources(state.lastReading);
    }
    return 'handled';
  }
  if (command === 'rag-check') {
    await checkKnowledgeBase(true);
    return 'handled';
  }
  if (command === 'tools') {
    printToolCalls(state.lastReading);
    return 'handled';
  }
  if (command === 'session') {
    printSessionMemory(state);
    return 'handled';
  }
  if (command === 'sessions') {
    await printSessions(state.currentSessionId);
    return 'handled';
  }
  if (command === 'use') {
    const sessionId = args[0];
    if (!sessionId) {
      printBox('Usage', ['/use <sessionId>']);
      return 'handled';
    }
    state.currentSessionId = sessionId;
    state.lastQuestion = null;
    state.lastReading = null;
    state.lastChat = null;
    printConversationHeader(state);
    printRoyLines([
      `已切换到 session：${sessionId}`,
      '后续输入会作为追问。若要重新起卦，输入 /new。',
    ]);
    return 'handled';
  }
  if (command === 'history') {
    const sessionId = args[0] || state.currentSessionId;
    if (!sessionId) {
      printBox('Usage', ['当前没有 session。用法：/history <sessionId>']);
      return 'handled';
    }
    await printHistory(sessionId);
    return 'handled';
  }
  if (command === 'export') {
    exportLastReading(state);
    return 'handled';
  }
  if (command === 'clear') {
    process.stdout.write('\x1Bc');
    printConversationHeader(state);
    return 'handled';
  }

  printBox('Unknown command', [`/${command}`, `Commands: ${CORE_COMMANDS}`]);
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
    printRoyLines([
      '请选择起卦方式：',
      '[1] 手动六爻',
      '[2] 自动摇卦',
      '[3] 时间起卦',
      '[4] 数字起卦',
      '[5] 汉字起卦',
    ]);
    const raw = (await ask(chalk.cyan('你 > '))).trim();
    if (isExit(raw)) return null;
    try {
      return normalizeMethod(raw || '2');
    } catch (err: any) {
      printBox('Error', [err.message]);
    }
  }
}

async function promptSessionChoice(ask: (q: string) => Promise<string>): Promise<string | null> {
  let conversations: any[] = [];
  try {
    conversations = await listPermanentConversations();
  } catch (err: any) {
    printBox('Sessions', [`历史会话暂不可用：${err.message}`, 'Session: new']);
    return null;
  }
  if (conversations.length === 0) {
    printBox('Sessions', ['最近会话：无', 'Session: new']);
    return null;
  }

  printBox('最近会话', [
    ...conversations.slice(0, 8).map((c, i) => {
      const title = c.title || c.sessionId;
      return `${i + 1}. ${title}    ${c.sessionId}`;
    }),
    '直接回车新建会话；输入序号或 sessionId 切换历史会话。',
  ]);

  while (true) {
    const raw = (await ask(chalk.cyan('选择会话 [new] > '))).trim();
    if (isExit(raw)) return null;
    if (!raw || raw.toLowerCase() === 'new') return null;
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 1 && index <= conversations.length) {
      return conversations[index - 1]!.sessionId;
    }
    const match = conversations.find((c) => c.sessionId === raw);
    if (match) return match.sessionId;
    printBox('Sessions', ['没有找到该会话。请输入序号、sessionId，或回车新建。']);
  }
}

async function promptDeepMode(ask: (q: string) => Promise<string>, angles: number | undefined): Promise<boolean> {
  const label = Number.isFinite(angles) ? `深度推演（${angles} 个角度）` : '深度推演';
  while (true) {
    const raw = (await ask(chalk.cyan(`${label}？[y/N] > `))).trim().toLowerCase();
    if (isExit(raw)) return false;
    if (!raw || raw === 'n' || raw === 'no' || raw === '否') return false;
    if (raw === 'y' || raw === 'yes' || raw === '是') return true;
    printBox('Input', ['请输入 y 或 n。']);
  }
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
      printBox('Input', ['请输入 3 个数字，例如：2 9 5']);
      return null;
    }
    return { casting: { method: 'numbers', numbers } };
  }

  if (method === 'character') {
    const rawCharacter = (await ask(chalk.cyan('汉字 > '))).trim();
    if (isExit(rawCharacter)) return 'exit';
    const characters = Array.from(rawCharacter);
    if (characters.length !== 1) {
      printBox('Input', ['请输入 1 个汉字，例如：财']);
      return null;
    }
    return { casting: { method: 'character', character: characters[0] } };
  }

  const rawValues = (await ask(chalk.cyan('六爻 > '))).trim();
  if (isExit(rawValues)) return 'exit';
  const parsed = parseLineValues(rawValues);
  if (!parsed) {
    printBox('Input', ['请输入 6 个数字，例如：7 8 7 9 7 8 或 1 1 1 1 1 1']);
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

async function listPermanentConversations(): Promise<any[]> {
  const data = await apiGet<any[]>('/memory/permanent', { pageSize: 20 });
  return Array.isArray(data) ? data : [];
}

async function printSessions(currentSessionId: string | null): Promise<void> {
  try {
    const conversations = await listPermanentConversations();
    if (conversations.length === 0) {
      printBox('Sessions', ['当前用户没有历史会话。']);
      return;
    }
    printBox('Sessions', conversations.map((c, i) => {
      const active = currentSessionId === c.sessionId ? '*' : ' ';
      const title = c.title || c.sessionId;
      const when = c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '';
      return `${active} ${i + 1}. ${c.sessionId}  ${title}${when ? `  ${when}` : ''}`;
    }));
  } catch (err: any) {
    printBox('Error', [String(err.message || err)]);
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
      printBox('History', [`no history for ${sessionId}`]);
      return;
    }
    printBox(`History ${sessionId}`, messages.map((m) => {
      const who = m.role === 'user' ? '你' : 'Roy';
      const content = String(m.content || '').replace(/\s+/g, ' ').slice(0, 180);
      return `${who}: ${content}${content.length >= 180 ? '...' : ''}`;
    }));
  } catch (err: any) {
    printBox('Error', [String(err.message || err)]);
  }
}

async function checkKnowledgeBase(manual: boolean): Promise<void> {
  try {
    printWorkingBox(manual ? '正在检查知识库更新...' : '启动检查知识库更新...');
    const r = await apiPost<any>('/divination/rag/rebuild');
    const skipped = r.skipped ?? 0;
    const ingested = r.ingested ?? 0;
    const deleted = r.deleted ?? 0;
    printBox('Knowledge Base', [`更新 ${ingested}，跳过 ${skipped}，删除 ${deleted}。`]);
  } catch (err: any) {
    printBox('Knowledge Base', [`检查跳过：${String(err.message || err)}`]);
  }
}

function printLogo(state: AppState): void {
  printBox('', [
    'Orbit Liuyao · Roy',
    '六爻排盘 · RAG 解卦 · 多轮追问',
  ]);
  console.log(`Session: ${chalk.cyan(state.currentSessionId || 'new')}`);
  console.log(`Mode: ${chalk.cyan(methodLabel(state.method))}`);
  console.log(`Memory: ${chalk.green(state.memoryEnabled ? 'enabled' : 'off')}`);
  console.log(`RAG: ${chalk.green(state.ragEnabled ? 'enabled' : 'off')}`);
}

function printStartupCommands(): void {
  printBox('Commands', [
    CORE_COMMANDS,
    '/chart full 展开完整卦画与六爻表；/rag check 手动检查知识库。',
  ]);
}

function printConversationHeader(state: AppState): void {
  const chartName = state.lastReading ? chartPair(state.lastReading.chart || {}) : 'none';
  printBox('Roy · Liuyao', [
    `session: ${state.currentSessionId || 'new'}`,
    `method: ${state.method}    chart: ${chartName}    rag: ${state.ragEnabled ? 'on' : 'off'}    memory: ${state.memoryEnabled ? 'on' : 'off'}`,
    `thinking: ${state.thinkingLabel}`,
  ]);
}

function printMethodConfirmation(method: LiuyaoAppMethod): void {
  printRoyLines([
    `已切换为：${methodLabel(method)}。`,
    '输入问题后，我会自动完成：起卦 → 排盘 → 检索 → 分析。',
    `Commands: ${CORE_COMMANDS}`,
  ]);
}

function printAppCommands(state: AppState): void {
  printBox('Commands', [
    '/new [method]        重新起卦，可选 manual|coins|time|numbers|character',
    '/method [method]     切换下一次起卦方式',
    '/chart               查看当前排盘摘要',
    '/chart full          查看完整六爻表和卦画',
    '/why                 展开分析摘要与完整报告',
    '/rag                 查看本轮检索依据',
    '/rag check           手动检查知识库并按需更新 embedding',
    '/tools               查看本轮工具调用',
    '/session             查看当前会话状态',
    '/sessions            查看历史会话',
    '/use <sessionId>     切换到已有 session',
    '/history [sessionId] 查看当前或指定 session 最近消息',
    '/export              导出当前报告',
    '/clear               清屏',
    '/exit                退出',
    '',
    `当前：session=${state.currentSessionId || 'new'} method=${state.method} chart=${state.lastReading ? chartPair(state.lastReading.chart || {}) : 'none'}`,
  ]);
}

function printWorkingBox(text: string): void {
  printBox('Roy is working', [`⠋ ${text}`]);
}

function printRunningBlock(data: any): void {
  printBox('Running divination flow', buildToolRows(data, 'summary'));
}

function printToolCalls(data: any | null): void {
  if (!data) {
    printBox('Tool calls', ['当前没有工具调用记录。']);
    return;
  }
  printBox('Tool calls', buildToolRows(data, 'detail'));
}

function buildToolRows(data: any, mode: 'summary' | 'detail'): string[] {
  const chart = data.chart || {};
  const debug = data.debug || {};
  const ragHits = debug.rag?.deduped?.length ?? data.report?.citations?.length ?? 0;
  const usage = debug.synthesis?.usage || data.usage;
  const rows = [
    `✓ cast.${data.casting?.method || 'input'}        ${formatYaoValues(data.casting)}`,
    `✓ chart.assemble    ${chartPair(chart)} · ${movingLabel(chart)}`,
    `✓ calendar          ${formatCalendar(chart)}`,
    `✓ rag.retrieve      ${ragHits} chunks`,
    `✓ analyze           ${data.thinking ? `${data.angles || 3} angles` : 'brief + detailed'}${usage?.outputTokens ? ` · ${usage.outputTokens} tokens` : ''}`,
  ];
  if (mode === 'detail') {
    const queries = debug.rag?.queries || debug.understanding?.ragQueries || [];
    if (Array.isArray(queries) && queries.length) rows.push(`rag.query          ${queries.slice(0, 4).join(' / ')}`);
    const focus = debug.understanding?.focusYongshen || [];
    if (Array.isArray(focus) && focus.length) rows.push(`analysis.focus     ${focus.join('、')}`);
  }
  return rows;
}

function printChartSummary(data: any, question?: string): void {
  const chart = data.chart || {};
  const shi = findLine(chart, 'shi');
  const ying = findLine(chart, 'ying');
  const yongshen = formatYongshen(chart);
  const rows = [
    question ? `问题：${question}` : '',
    `起卦：${formatCasting(data.casting)}`,
    `本卦：${hexName(chart.originalHexagram)}        变卦：${hexName(chart.changedHexagram)}        ${movingLabel(chart)}`,
    `卦宫：${chart.originalHexagram?.palace ?? '?'}宫 · ${chart.originalHexagram?.palaceType ?? '?'} · ${chart.originalHexagram?.element ?? '?'}`,
    `动爻：${formatMoving(chart)}`,
    shi ? `世爻：${formatLineSummary(shi)}` : '世爻：未标注',
    ying ? `应爻：${formatLineSummary(ying)}` : '应爻：未标注',
    yongshen ? `用神：${yongshen}` : '',
  ].filter(Boolean);
  printBox('Chart', rows);
}

function printAssistantBrief(data: any): void {
  const report = data.report || {};
  const conclusion = pickConclusion(report, data.content);
  const points = pickKeyPoints(report, data);
  printAssistantMessage([
    `结论：${conclusion}`,
    '',
    '关键依据：',
    ...points.map((p, i) => `  ${i + 1}. ${p}`),
    '',
    '你可以继续问：',
    '  /why       看详细逻辑',
    '  /chart     看排盘摘要',
    '  /chart full 看完整卦画与六爻表',
    '  /rag       看检索依据',
    '  /new       重新起卦',
  ].join('\n'));
}

function printAssistantMessage(content: string): void {
  console.log(chalk.green('Roy >'));
  console.log(cleanReportForDisplay(content));
  console.log();
}

function printRoyLines(lines: string[]): void {
  console.log(chalk.green('Roy > ') + lines[0]);
  for (const line of lines.slice(1)) console.log(`      ${line}`);
  console.log();
}

function printAnalysisTrace(data: any): void {
  const debug = data.debug || {};
  const chart = data.chart || {};
  const focus = debug.understanding?.focusYongshen || data.brief?.yongshen?.candidates?.map((c: any) => c.relative) || [];
  const questionType = debug.understanding?.refinedQuestionType || data.report?.understanding?.questionType || data.brief?.questionType || '未识别';
  const synthesis = firstSentence(data.report?.synthesis || data.content || '');
  printBox('Analysis trace', [
    `1. 识别问题类型：${questionType}`,
    `2. 程序候选用神：${Array.isArray(focus) && focus.length ? focus.join('、') : '未明确'}`,
    `3. 关键结构：${movingLabel(chart)}；世爻 ${linePos(findLine(chart, 'shi'))}；应爻 ${linePos(findLine(chart, 'ying'))}`,
    `4. 综合方向：${synthesis || '详见完整报告'}`,
  ]);
}

function printRagSources(data: any | null): void {
  if (!data) {
    printBox('RAG Sources', ['当前没有检索记录。']);
    return;
  }
  const hits = data.debug?.rag?.deduped || data.report?.citations || [];
  if (!Array.isArray(hits) || hits.length === 0) {
    printBox('RAG Sources', ['本轮没有可展示的检索命中。']);
    return;
  }
  printBox('RAG Sources', hits.slice(0, 8).map((h: any, i: number) => {
    const source = h.source || 'unknown';
    const title = h.title ? ` · ${h.title}` : '';
    const score = typeof h.score === 'number' ? `score ${h.score.toFixed(2)}` : '';
    return `${i + 1}. ${source}${title}    ${score}`;
  }));
}

function printSessionMemory(state: AppState): void {
  printBox('Session Memory', [
    `当前 session：${state.currentSessionId || 'new'}`,
    `当前问题：${state.lastQuestion || '无'}`,
    `当前卦：${state.lastReading ? chartPair(state.lastReading.chart || {}) : 'none'}`,
    `起卦方式：${state.method}`,
    `已生成报告：${state.lastReading ? 'brief + detailed' : '无'}`,
    `最近追问：${state.lastChat?.content ? trimText(state.lastChat.content, 80) : '无'}`,
  ]);
}

function exportLastReading(state: AppState): void {
  if (!state.lastReading) {
    printBox('Export', ['当前没有可导出的报告。']);
    return;
  }
  const session = state.currentSessionId || 'new';
  const file = path.resolve(process.cwd(), `orbit-liuyao-${session}.md`);
  const data = state.lastReading;
  const content = [
    `# Orbit Liuyao Report`,
    '',
    `- session: ${session}`,
    `- question: ${state.lastQuestion || ''}`,
    `- chart: ${chartPair(data.chart || {})}`,
    `- casting: ${formatCasting(data.casting)}`,
    '',
    '## Analysis',
    '',
    cleanReportForDisplay(data.content || ''),
  ].join('\n');
  fs.writeFileSync(file, content, 'utf8');
  printBox('Export', [`已导出：${file}`]);
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

function parseThreeNumbers(raw: string): [number, number, number] | null {
  const values = raw.split(/[,\s]+/).filter(Boolean).map((v) => Number(v));
  if (values.length !== 3 || values.some((v) => !Number.isFinite(v))) return null;
  return values.map((v) => Math.trunc(v)) as [number, number, number];
}

function methodLabel(method: LiuyaoAppMethod): string {
  const label = {
    manual: '手动六爻 · manual',
    coins: '自动摇卦 · coins',
    time: '时间起卦 · time',
    numbers: '数字起卦 · numbers',
    character: '汉字起卦 · character',
  }[method];
  return label;
}

function chartPair(chart: any): string {
  return `${hexName(chart.originalHexagram)} → ${hexName(chart.changedHexagram)}`;
}

function hexName(hexagram: any): string {
  return hexagram?.fullName || hexagram?.name || '?';
}

function movingLabel(chart: any): string {
  const moving = chart.movingLines || [];
  return Array.isArray(moving) && moving.length ? `动爻 ${moving.join('、')}` : '静卦';
}

function formatMoving(chart: any): string {
  const moving = chart.movingLines || [];
  return Array.isArray(moving) && moving.length ? moving.join('、') : '无';
}

function formatCalendar(chart: any): string {
  const t = chart.time || {};
  if (!t.yearStem) return 'unknown';
  return `${t.yearStem}${t.yearBranch}年 / ${t.monthStem}${t.monthBranch}月 / ${t.dayStem}${t.dayBranch}日 / ${t.hourStem}${t.hourBranch}时`;
}

function formatCasting(casting: any): string {
  if (!casting) return 'unknown';
  const values = formatYaoValues(casting);
  return values ? `${casting.method} · ${values}` : casting.method || 'unknown';
}

function formatYaoValues(casting: any): string {
  if (Array.isArray(casting?.yaoValues)) return casting.yaoValues.join(' ');
  if (Array.isArray(casting?.values)) return casting.values.join(' ');
  return '';
}

function findLine(chart: any, kind: 'shi' | 'ying'): any | null {
  const lines = chart?.lines;
  if (!Array.isArray(lines)) return null;
  return lines.find((l) => kind === 'shi' ? l.isShi : l.isYing) || null;
}

function linePos(line: any | null): string {
  return line ? `第 ${line.position} 爻` : '未标注';
}

function formatLineSummary(line: any): string {
  const parts = [
    `第 ${line.position} 爻`,
    `${line.stem || ''}${line.branch || ''}${line.element ? `(${line.element})` : ''}`,
    line.sixRelative,
    line.sixGod ? `临${line.sixGod}` : '',
    line.void ? '旬空' : '',
    line.moving ? '动' : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function formatYongshen(chart: any): string {
  const candidates = chart?.yongshen?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  return candidates.slice(0, 2).map((c: any) => {
    const positions = Array.isArray(c.positions) && c.positions.length
      ? `，第 ${c.positions.join('、')} 爻`
      : '';
    return `${c.relative}${positions}`;
  }).join('；');
}

function pickConclusion(report: any, content: string): string {
  const source = report?.synthesis || report?.summary || content || '';
  const cleaned = cleanInline(source)
    .replace(/^结论[:：]\s*/, '')
    .replace(/^综合判断[:：]\s*/, '');
  return firstSentence(cleaned) || trimText(cleaned, 120) || '当前卦象需要结合背景谨慎判断。';
}

function pickKeyPoints(report: any, data: any): string[] {
  const points = [
    firstSentence(report?.originalHexagramInterpretation),
    firstSentence(report?.movingLineAnalysis),
    firstSentence(report?.shiYingAnalysis || report?.yongshenAnalysis),
  ].filter(Boolean);
  if (points.length > 0) return points.slice(0, 3);

  const chart = data.chart || {};
  return [
    `本卦为 ${hexName(chart.originalHexagram)}，变卦为 ${hexName(chart.changedHexagram)}。`,
    `${movingLabel(chart)}，这是判断事情是否有变化机制的关键。`,
    `世爻在 ${linePos(findLine(chart, 'shi'))}，应爻在 ${linePos(findLine(chart, 'ying'))}。`,
  ];
}

function firstSentence(value: unknown): string {
  const text = cleanInline(String(value || ''));
  if (!text) return '';
  const match = text.match(/^(.{1,160}?[。！？.!?])(?:\s|$)/);
  return match ? match[1] : trimText(text, 140);
}

function cleanReportForDisplay(value: string): string {
  return String(value || '')
    .replace(/\n## 引用[\s\S]*$/m, '')
    .replace(/\[cite:[^\]]+\]/g, '')
    .replace(/\[[0-9,\s]+\]/g, '')
    .trim();
}

function cleanInline(value: string): string {
  return cleanReportForDisplay(value)
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimText(value: string, max: number): string {
  const text = cleanInline(value);
  return visibleWidth(text) > max ? `${sliceVisible(text, max - 1)}…` : text;
}

function printBox(title: string, lines: string[], width = BOX_WIDTH): void {
  const inner = width - 4;
  const titleText = title ? `─ ${title} ` : '';
  const topFill = Math.max(0, width - 2 - visibleWidth(titleText));
  console.log(chalk.gray(`╭${titleText}${'─'.repeat(topFill)}╮`));
  const body = lines.length ? lines : [''];
  for (const rawLine of body) {
    const wrapped = wrapLine(stripAnsi(String(rawLine)), inner);
    for (const line of wrapped) {
      console.log(chalk.gray('│ ') + line + ' '.repeat(Math.max(0, inner - visibleWidth(line))) + chalk.gray(' │'));
    }
  }
  console.log(chalk.gray(`╰${'─'.repeat(width - 2)}╯`));
}

function wrapLine(line: string, width: number): string[] {
  if (!line) return [''];
  const out: string[] = [];
  let current = '';
  for (const char of Array.from(line)) {
    if (visibleWidth(current + char) > width) {
      out.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function visibleWidth(value: string): number {
  let width = 0;
  for (const char of Array.from(stripAnsi(value))) {
    const code = char.codePointAt(0) || 0;
    width += code > 0x1100 ? 2 : 1;
  }
  return width;
}

function sliceVisible(value: string, max: number): string {
  let width = 0;
  let out = '';
  for (const char of Array.from(value)) {
    const code = char.codePointAt(0) || 0;
    const w = code > 0x1100 ? 2 : 1;
    if (width + w > max) break;
    out += char;
    width += w;
  }
  return out;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}
