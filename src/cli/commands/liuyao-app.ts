/**
 * `orbit liuyao` — Ink-powered interactive 六爻 CLI.
 */
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../http';
import { getBaseUrl, getToken } from '../config';
import { postDivinationAsk, renderPipelineTimeline } from './divination';

const DEFAULT_PROMPT = [
  '请结合卦象分析、解答问题。',
  '交互式 CLI 场景下，请保留完整分析内容，但最终默认展示会由 summary 模型另行压缩。',
  '语言要自然，和用户语言一致；不要暴露 RAG、LLM、pipeline、debug、JSON、provider、token 等工程术语。',
].join('');

const CORE_COMMANDS = '/new  /method  /sessions  /chart  /why  /rag  /tools  /help  /exit';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

type LiuyaoAppMethod = 'manual' | 'coins' | 'time' | 'numbers' | 'character';
type PendingKind = 'method' | 'manual' | 'numbers' | 'character' | 'analysis_mode' | null;
type AppPhase =
  | 'select_method'
  | 'ask_question'
  | 'analysis_mode'
  | 'casting'
  | 'charting'
  | 'retrieving'
  | 'analyzing'
  | 'chat'
  | 'error';

type MessageBlock = {
  id: string;
  kind: 'roy' | 'user' | 'system' | 'tools' | 'chart' | 'sessions' | 'error' | 'answer' | 'rag';
  title?: string;
  lines: string[];
};

type AppState = {
  currentSessionId: string | null;
  method: LiuyaoAppMethod;
  lastQuestion: string | null;
  lastReading: any | null;
  lastSummary: string;
  lastChat: any | null;
  pendingQuestion: string | null;
  pendingCasting: Record<string, unknown> | null;
  pendingKind: PendingKind;
  phase: AppPhase;
  thinking: boolean;
  angles: number;
  ragEnabled: boolean;
  memoryEnabled: boolean;
  kbStatus: string;
};

type InkModule = {
  render: (node: React.ReactElement, options?: any) => { waitUntilExit: () => Promise<void> };
  Box: React.ComponentType<any>;
  Text: React.ComponentType<any>;
  useInput: (handler: (input: string, key: any) => void) => void;
  useApp: () => { exit: () => void };
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T = any>(specifier: string) => Promise<T>;

export function registerLiuyaoApp(program: Command): void {
  program
    .command('liuyao')
    .description('Start the interactive 六爻 CLI app (Ink TUI, cast → chart → RAG analysis → streaming summary)')
    .option('--method <m>', 'Casting method: manual|coins|time|numbers|character. If omitted, Roy asks in the app.')
    .option('--thinking', 'Start with thinking mode enabled; angle count is selected in the app unless --angles is set.', false)
    .option('--angles <n>', 'Thinking angles, 1-5.', (v) => parseInt(v, 10))
    .option('--timezone <tz>', 'Timezone passed to the calendar skill', 'Asia/Shanghai')
    .option('--debug', 'Show raw debug pipeline after ask/chat calls.', false)
    .option('--no-rag-check', 'Skip startup knowledge-base update check.')
    .action(async (opts) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log('orbit liuyao is an interactive Ink TUI and requires a TTY.');
        console.log(`Commands inside the app: ${CORE_COMMANDS}`);
        console.log('For non-interactive use, run: orbit divination ask --method coins -q "你的问题"');
        return;
      }
      const ink = await dynamicImport<InkModule>('ink');
      const initialState: AppState = {
        currentSessionId: null,
        method: opts.method ? normalizeMethod(opts.method) : 'coins',
        lastQuestion: null,
        lastReading: null,
        lastSummary: '',
        lastChat: null,
        pendingQuestion: null,
        pendingCasting: null,
        pendingKind: opts.method ? null : 'method',
        phase: opts.method ? 'ask_question' : 'select_method',
        thinking: !!opts.thinking,
        angles: clampAngles(opts.angles),
        ragEnabled: true,
        memoryEnabled: true,
        kbStatus: 'checking',
      };
      const app = ink.render(React.createElement(LiuyaoInkApp, { ink, opts, initialState }), {
        exitOnCtrlC: true,
      });
      await app.waitUntilExit();
    });
}

function LiuyaoInkApp(props: { ink: InkModule; opts: any; initialState: AppState }) {
  const { ink, opts } = props;
  const { Box, Text, useInput, useApp } = ink;
  const app = useApp();
  const [state, setState] = useState<AppState>(props.initialState);
  const [blocks, setBlocks] = useState<MessageBlock[]>(initialBlocks(props.initialState));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => {
      setSpinnerIndex(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, [busy]);

  const append = useCallback((block: Omit<MessageBlock, 'id'>) => {
    setBlocks(prev => [...prev, { ...block, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` }].slice(-80));
  }, []);

  const updateLastAssistant = useCallback((content: string) => {
    setBlocks(prev => {
      const copy = [...prev];
      let idx = -1;
      for (let i = copy.length - 1; i >= 0; i -= 1) {
        const block = copy[i];
        if ((block.kind === 'roy' || block.kind === 'answer') && block.title === 'Roy') {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        copy[idx] = { ...copy[idx], lines: content.split('\n') };
      } else {
        copy.push({ id: `${Date.now()}_stream`, kind: 'roy', title: 'Roy', lines: content.split('\n') });
      }
      return copy;
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    setBusy(true);
    setStatus('正在读取会话列表...');
    try {
      const conversations = await listPermanentConversations();
      append({
        kind: 'sessions',
        title: 'Session manager',
        lines: conversations.length
          ? [
              ...conversations.slice(0, 12).map((c, i) => {
                const active = state.currentSessionId === c.sessionId ? '*' : ' ';
                const title = c.title || c.sessionId;
                return `${active} ${i + 1}. ${c.sessionId}  ${title}`;
              }),
              '',
              'Commands: /use <sessionId>  /delete <sessionId>  /delete all  /history <sessionId>',
            ]
          : ['当前用户没有历史会话。'],
      });
    } catch (err: any) {
      append({
        kind: 'roy',
        title: 'Roy',
        lines: [
          formatConnectionHelp(err, '会话管理暂时不可用。'),
          '启动后端后再输入 /sessions 即可重试。',
        ],
      });
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, [append, state.currentSessionId]);

  const checkKnowledgeBase = useCallback(async (manual: boolean) => {
    setBusy(true);
    setStatus(manual ? '正在检查知识库更新...' : '启动检查知识库更新...');
    try {
      const r = await apiPost<any>('/divination/rag/rebuild');
      const summary = `ready · 更新 ${r.ingested ?? 0} · 跳过 ${r.skipped ?? 0}`;
      setState(prev => ({ ...prev, kbStatus: summary }));
      if (manual) append({ kind: 'system', title: 'Knowledge Base', lines: [`知识库 ${summary}，删除 ${r.deleted ?? 0}。`] });
    } catch (err: any) {
      setState(prev => ({ ...prev, kbStatus: 'unavailable' }));
      if (manual) append({ kind: 'error', title: 'Knowledge Base', lines: [`检查跳过：${String(err.message || err)}`] });
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, [append]);

  useEffect(() => {
    if (opts.ragCheck !== false) void checkKnowledgeBase(false);
  }, [checkKnowledgeBase, opts.ragCheck]);

  const runReading = useCallback(async (question: string, castingInput: Record<string, unknown>, thinking: boolean, angles: number) => {
    setBusy(true);
    setStatus('摇动三枚铜钱 / 生成起卦结果...');
    setState(prev => ({ ...prev, phase: 'casting' }));
    const sessionId = `sess_cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const body: any = {
        sessionId,
        question,
        message: DEFAULT_PROMPT,
        timezone: opts.timezone,
        datetime: new Date().toISOString(),
        debug: true,
      };
      Object.assign(body, castingInput);
      if (thinking) body.thinking = true;
      body.angles = angles;

      setTimeout(() => {
        setStatus('正在装卦、排盘并写入当前 session...');
        setState(prev => ({ ...prev, phase: 'charting' }));
      }, 250);
      setTimeout(() => {
        setStatus('正在检索知识库依据...');
        setState(prev => ({ ...prev, phase: 'retrieving' }));
      }, 700);
      setTimeout(() => {
        setStatus('Roy 正在分析卦象...');
        setState(prev => ({ ...prev, phase: 'analyzing' }));
      }, 1100);

      const data = await postDivinationAsk(body);
      setState(prev => ({
        ...prev,
        currentSessionId: data.sessionId || sessionId,
        lastQuestion: question,
        lastReading: data,
        lastSummary: '',
        lastChat: null,
        pendingQuestion: null,
        pendingCasting: null,
        pendingKind: null,
        phase: 'analyzing',
        thinking,
        angles,
      }));
      append({ kind: 'chart', title: 'Chart', lines: buildChartSummary(data, question) });
      append({ kind: 'rag', title: 'RAG', lines: buildRagSummaryLines(data) });
      append({ kind: 'answer', title: 'Roy', lines: ['Roy：'] });

      setStatus('Roy 正在流式生成交互式短答...');
      let summary = '';
      await streamPost('/divination/summarize/stream', {
        question,
        chart: data.chart,
        content: data.content,
        agentId: data.agentId,
      }, (chunk) => {
        summary += chunk;
        updateLastAssistant(`Roy：\n${summary}`);
      });
      setState(prev => ({ ...prev, lastSummary: summary, phase: 'chat' }));
      if (opts.debug && data.debug) renderPipelineTimeline(data.debug);
    } catch (err: any) {
      append({ kind: 'error', title: 'Error', lines: [String(err.message || err)] });
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, [append, opts, updateLastAssistant]);

  const runFollowup = useCallback(async (message: string) => {
    if (!state.currentSessionId) return;
    setBusy(true);
    setStatus('Roy 正在流式回复...');
    setState(prev => ({ ...prev, phase: 'chat' }));
    append({ kind: 'answer', title: 'Roy', lines: ['Roy：'] });
    try {
      let content = '';
      await streamPost('/chat/stream', {
        sessionId: state.currentSessionId,
        message,
        agentId: 'default',
        thinking: state.thinking,
        angles: state.angles,
      }, (chunk) => {
        content += chunk;
        updateLastAssistant(`Roy：\n${content}`);
      });
      setState(prev => ({ ...prev, lastChat: { content } }));
    } catch (err: any) {
      append({ kind: 'error', title: 'Error', lines: [String(err.message || err)] });
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, [append, state.angles, state.currentSessionId, state.thinking, updateLastAssistant]);

  const completeQuestionFlow = useCallback((question: string, castingInput: Record<string, unknown>) => {
    const presetThinking = !!opts.thinking;
    setState(prev => ({
      ...prev,
      pendingQuestion: question,
      pendingCasting: castingInput,
      pendingKind: 'analysis_mode',
      phase: 'analysis_mode',
      thinking: presetThinking ? true : prev.thinking,
      angles: presetThinking ? clampAngles(opts.angles) : prev.angles,
    }));
    append({
      kind: 'system',
      title: 'Analysis mode',
      lines: [
        '[1] 快速分析    直接给结论，适合普通问题',
        '[2] 深度推演    默认 3 angles，可输入 /think 5 调整',
        '[3] 只排盘      当前版本会先生成 Chart，不调用短答请用 /chart 查看',
        '默认：[1] 快速分析。也可以直接输入 /think 3。',
      ],
    });
  }, [append, opts.angles, opts.thinking]);

  const handlePlainInput = useCallback(async (value: string) => {
    append({ kind: 'user', title: '你', lines: [value] });

    if (state.pendingKind === 'method') {
      try {
        const method = normalizeMethod(value || '2');
        setState(prev => ({ ...prev, method, pendingKind: null, phase: 'ask_question' }));
        append({ kind: 'roy', title: 'Roy', lines: [`已切换为：${methodLabel(method)}。`, '输入问题后，我会自动完成：起卦 → 排盘 → 检索 → 分析。'] });
      } catch (err: any) {
        append({ kind: 'error', title: 'Input', lines: [err.message] });
      }
      return;
    }

    if (state.pendingKind === 'manual') {
      const parsed = parseLineValues(value);
      if (!parsed) {
        append({ kind: 'error', title: 'Input', lines: ['请输入 6 个数字，例如：7 8 7 9 7 8 或 1 1 1 1 1 1'] });
        return;
      }
      const castingInput = parsed.kind === 'bits' ? { bits: parsed.values } : { yaoValues: parsed.values };
      completeQuestionFlow(state.pendingQuestion!, castingInput);
      return;
    }

    if (state.pendingKind === 'numbers') {
      const numbers = parseThreeNumbers(value);
      if (!numbers) {
        append({ kind: 'error', title: 'Input', lines: ['请输入 3 个数字，例如：2 9 5'] });
        return;
      }
      completeQuestionFlow(state.pendingQuestion!, { casting: { method: 'numbers', numbers } });
      return;
    }

    if (state.pendingKind === 'character') {
      const characters = Array.from(value.trim());
      if (characters.length !== 1) {
        append({ kind: 'error', title: 'Input', lines: ['请输入 1 个汉字，例如：财'] });
        return;
      }
      completeQuestionFlow(state.pendingQuestion!, { casting: { method: 'character', character: characters[0] } });
      return;
    }

    if (state.pendingKind === 'analysis_mode') {
      const normalized = value.trim().toLowerCase();
      if (normalized === '2' || normalized === 'deep' || normalized === '深度') {
        await runReading(state.pendingQuestion!, state.pendingCasting!, true, 3);
        return;
      }
      if (normalized === '3' || normalized === 'chart' || normalized === '只排盘') {
        append({ kind: 'system', title: 'Analysis mode', lines: ['只排盘模式将在下一版拆分为独立流程；当前请使用 /chart 查看排盘摘要。现在先按快速分析继续。'] });
        await runReading(state.pendingQuestion!, state.pendingCasting!, false, state.angles);
        return;
      }
      await runReading(state.pendingQuestion!, state.pendingCasting!, false, state.angles);
      return;
    }

    if (state.currentSessionId) {
      await runFollowup(value);
      return;
    }

    if (state.method === 'manual') {
      setState(prev => ({ ...prev, pendingQuestion: value, pendingKind: 'manual', phase: 'analysis_mode' }));
      append({ kind: 'roy', title: 'Roy', lines: ['请输入 6 个爻值，顺序为初爻到上爻。支持 6/7/8/9，也支持 0/1 静卦。'] });
      return;
    }
    if (state.method === 'numbers') {
      setState(prev => ({ ...prev, pendingQuestion: value, pendingKind: 'numbers', phase: 'analysis_mode' }));
      append({ kind: 'roy', title: 'Roy', lines: ['请输入 3 个数字：第 1 数上卦，第 2 数下卦，第 3 数动爻。'] });
      return;
    }
    if (state.method === 'character') {
      setState(prev => ({ ...prev, pendingQuestion: value, pendingKind: 'character', phase: 'analysis_mode' }));
      append({ kind: 'roy', title: 'Roy', lines: ['请输入 1 个汉字。'] });
      return;
    }
    const casting = state.method === 'time'
      ? { casting: { method: 'time' } }
      : { casting: { method: 'coins' } };
    completeQuestionFlow(value, casting);
  }, [append, completeQuestionFlow, runFollowup, runReading, state]);

  const handleCommand = useCallback(async (value: string): Promise<boolean> => {
    if (!value.startsWith('/')) return false;
    const [cmd, ...args] = value.slice(1).trim().split(/\s+/).filter(Boolean);
    const command = (cmd || '').toLowerCase();

    if (['exit', 'quit', 'q'].includes(command)) {
      app.exit();
      return true;
    }
    if (command === 'help') {
      append({ kind: 'system', title: 'Commands', lines: commandHelpLines(state) });
      return true;
    }
    if (command === 'new') {
      const method = args[0] ? normalizeMethod(args[0]) : state.method;
      setState(prev => ({ ...prev, currentSessionId: null, method, lastQuestion: null, lastReading: null, lastSummary: '', lastChat: null, pendingKind: null, phase: 'ask_question' }));
      append({ kind: 'roy', title: 'Roy', lines: [`已切换到新起卦模式：${methodLabel(method)}。`] });
      return true;
    }
    if (command === 'method') {
      if (args[0]) {
        const method = normalizeMethod(args[0]);
        setState(prev => ({ ...prev, method, phase: 'ask_question' }));
        append({ kind: 'roy', title: 'Roy', lines: [`已切换为：${methodLabel(method)}。`] });
      } else {
        setState(prev => ({ ...prev, pendingKind: 'method', phase: 'select_method' }));
        append({ kind: 'roy', title: 'Roy', lines: methodChoiceLines() });
      }
      return true;
    }
    if (command === 'think') {
      const raw = (args[0] || '').toLowerCase();
      if (!raw || raw === 'on') {
        setState(prev => ({ ...prev, thinking: true, angles: 3 }));
        append({ kind: 'roy', title: 'Roy', lines: ['已启用深度推演：3 angles。'] });
        return true;
      }
      if (raw === 'off' || raw === 'quick') {
        setState(prev => ({ ...prev, thinking: false }));
        append({ kind: 'roy', title: 'Roy', lines: ['已切换为快速分析。'] });
        if (state.pendingKind === 'analysis_mode' && state.pendingQuestion && state.pendingCasting) {
          await runReading(state.pendingQuestion, state.pendingCasting, false, state.angles);
        }
        return true;
      }
      const angles = clampAngles(Number(raw));
      setState(prev => ({ ...prev, thinking: true, angles }));
      append({ kind: 'roy', title: 'Roy', lines: [`已启用深度推演：${angles} angles。`] });
      if (state.pendingKind === 'analysis_mode' && state.pendingQuestion && state.pendingCasting) {
        await runReading(state.pendingQuestion, state.pendingCasting, true, angles);
      }
      return true;
    }
    if (command === 'sessions') {
      await refreshSessions();
      return true;
    }
    if (command === 'use') {
      const sessionId = args[0];
      if (!sessionId) append({ kind: 'roy', title: 'Roy', lines: ['用法：/use <sessionId>'] });
      else {
        setState(prev => ({ ...prev, currentSessionId: sessionId, lastReading: null, lastQuestion: null, lastSummary: '', lastChat: null, phase: 'chat' }));
        append({ kind: 'roy', title: 'Roy', lines: [`已切换到 session：${sessionId}`, '后续输入会作为追问。'] });
      }
      return true;
    }
    if (command === 'delete') {
      const target = args[0];
      if (!target) append({ kind: 'roy', title: 'Roy', lines: ['用法：/delete <sessionId>，或 /delete all'] });
      else if (target === 'all') {
        setBusy(true);
        setStatus('正在删除全部会话...');
        try {
          const r = await apiDelete<any>('/memory/permanent?confirm=true');
          setState(prev => ({ ...prev, currentSessionId: null, lastReading: null, lastQuestion: null, lastSummary: '', lastChat: null, phase: 'ask_question' }));
          append({ kind: 'sessions', title: 'Session manager', lines: [`已删除全部会话：${r.deletedCount ?? 0} 个。`] });
        } catch (err: any) {
          append({ kind: 'roy', title: 'Roy', lines: [formatConnectionHelp(err, '删除会话失败。')] });
        } finally {
          setBusy(false);
          setStatus('');
        }
      } else {
        setBusy(true);
        setStatus(`正在删除会话 ${target}...`);
        try {
          await apiDelete(`/memory/permanent/session/${encodeURIComponent(target)}`);
          if (state.currentSessionId === target) {
            setState(prev => ({ ...prev, currentSessionId: null, lastReading: null, lastQuestion: null, lastSummary: '', lastChat: null, phase: 'ask_question' }));
          }
          append({ kind: 'sessions', title: 'Session manager', lines: [`已删除：${target}`] });
        } catch (err: any) {
          append({ kind: 'roy', title: 'Roy', lines: [formatConnectionHelp(err, '删除会话失败。')] });
        } finally {
          setBusy(false);
          setStatus('');
        }
      }
      return true;
    }
    if (command === 'chart') {
      if (!state.lastReading) append({ kind: 'chart', title: 'Chart', lines: ['当前没有可展示的排盘。'] });
      else if (['full', '--full', '-f'].includes((args[0] || '').toLowerCase())) {
        append({ kind: 'chart', title: 'Lines 初爻 → 上爻', lines: buildFullChartLines(state.lastReading) });
      } else {
        append({ kind: 'chart', title: 'Chart', lines: buildChartSummary(state.lastReading, state.lastQuestion || undefined) });
      }
      return true;
    }
    if (command === 'why') {
      if (!state.lastReading) append({ kind: 'roy', title: 'Analysis trace', lines: ['当前没有可展开的起卦分析。'] });
      else append({ kind: 'roy', title: 'Analysis trace', lines: buildWhyLines(state.lastReading) });
      return true;
    }
    if (command === 'rag') {
      if ((args[0] || '').toLowerCase() === 'check') await checkKnowledgeBase(true);
      else append({ kind: 'system', title: 'RAG Sources', lines: buildRagLines(state.lastReading) });
      return true;
    }
    if (command === 'tools') {
      append({ kind: 'tools', title: 'Tool calls', lines: state.lastReading ? buildToolRows(state.lastReading, true) : ['当前没有工具调用记录。'] });
      return true;
    }
    if (command === 'session') {
      append({ kind: 'system', title: 'Session', lines: sessionLines(state) });
      return true;
    }
    if (command === 'history') {
      const sessionId = args[0] || state.currentSessionId;
      if (!sessionId) append({ kind: 'roy', title: 'Roy', lines: ['当前没有 session。'] });
      else await printHistoryBlock(sessionId, append);
      return true;
    }
    if (command === 'export') {
      exportLastReading(state, append);
      return true;
    }
    if (command === 'clear') {
      setBlocks(initialBlocks(state));
      return true;
    }
    append({ kind: 'roy', title: 'Roy', lines: [`未知命令：/${command}`, `可用命令：${CORE_COMMANDS}`] });
    return true;
  }, [app, append, checkKnowledgeBase, refreshSessions, runReading, state]);

  useInput((inputChar: string, key: any) => {
    if (key.ctrl && inputChar === 'c') {
      app.exit();
      return;
    }
    if (busy) return;
    if (key.return) {
      const value = input.trim();
      setInput('');
      if (!value) return;
      void (async () => {
        const handled = await handleCommand(value);
        if (!handled) await handlePlainInput(value);
      })();
      return;
    }
    if (key.backspace || key.delete) {
      setInput(prev => Array.from(prev).slice(0, -1).join(''));
      return;
    }
    if (inputChar && !key.ctrl && !key.meta) {
      setInput(prev => prev + inputChar);
    }
  });

  const headerLines = useMemo(() => {
    const chart = state.lastReading ? chartPair(state.lastReading.chart || {}) : 'none';
    return [
      `session: ${state.currentSessionId || 'new'}`,
      `method: ${state.method}    chart: ${chart}    mode: ${state.phase}`,
      `rag: ${state.ragEnabled ? 'on' : 'off'}    memory: ${state.memoryEnabled ? 'on' : 'off'}    thinking: ${state.thinking ? `${state.angles} angles` : 'quick'}    kb: ${state.kbStatus}`,
      `Commands: ${CORE_COMMANDS}`,
    ];
  }, [state]);

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(PixelLogo, { ink }),
    React.createElement(Card, { ink, title: 'Status', color: 'cyan', lines: headerLines }),
    React.createElement(FlowBar, { ink, phase: state.phase, spinner: SPINNER_FRAMES[spinnerIndex] }),
    renderPrimaryPanel(ink, state, busy, status, SPINNER_FRAMES[spinnerIndex]),
    React.createElement(Box, { flexDirection: 'column' },
      blocks.map(block => renderBlock(ink, block)),
    ),
    React.createElement(InputPanel, { ink, input, busy, hint: inputHint(state, busy) }),
  );
}

function PixelLogo({ ink }: { ink: InkModule }) {
  const { Box, Text } = ink;
  return React.createElement(Box, { flexDirection: 'column', marginBottom: 1 },
    React.createElement(Text, { color: 'yellow' }, '  ▓▓▓      ▓▓▓      ▓▓▓  '),
    React.createElement(Text, { color: 'yellow' }, ' ▓   ▓    ▓   ▓    ▓   ▓ '),
    React.createElement(Text, { color: 'yellow' }, ' ▓ ░ ▓    ▓ ░ ▓    ▓ ░ ▓ '),
    React.createElement(Text, { color: 'yellow' }, ' ▓   ▓    ▓   ▓    ▓   ▓ '),
    React.createElement(Text, { color: 'yellow' }, '  ▓▓▓      ▓▓▓      ▓▓▓  '),
    React.createElement(Text, { bold: true }, 'Orbit Liuyao · Roy'),
    React.createElement(Text, { color: 'gray' }, '六爻排盘 · RAG 解卦 · 多轮追问 · Ink TUI'),
    React.createElement(Text, { color: 'gray' }, `Commands: ${CORE_COMMANDS}`),
    React.createElement(Text, { color: 'gray' }, '注意：占断结果仅供参考；重大健康、法律、投资决策请以专业意见为准。'),
  );
}

function FlowBar({ ink, phase, spinner }: { ink: InkModule; phase: AppPhase; spinner: string }) {
  const order: Array<[AppPhase, string]> = [
    ['select_method', '① 方式'],
    ['ask_question', '② 问题'],
    ['analysis_mode', '③ 推演'],
    ['casting', '④ 起卦'],
    ['charting', '⑤ 排盘'],
    ['retrieving', '⑥ 检索'],
    ['analyzing', '⑦ 分析'],
    ['chat', '⑧ 追问'],
  ];
  const currentIndex = Math.max(0, order.findIndex(([p]) => p === phase));
  const line = order.map(([p, label], i) => {
    const mark = i < currentIndex ? '✓' : i === currentIndex ? spinner : '·';
    return `${label} ${mark}`;
  }).join('   ');
  return React.createElement(Card, { ink, title: 'Flow', color: phase === 'error' ? 'red' : 'yellow', lines: [line] });
}

function renderPrimaryPanel(ink: InkModule, state: AppState, busy: boolean, status: string, spinner: string): React.ReactElement | null {
  if (busy) {
    const lines = [status || 'working...'];
    if (state.phase === 'casting' && state.method === 'coins') {
      lines.push('', `${spinner} 正在摇动三枚铜钱...`, `已得：${formatYaoValues(state.lastReading?.casting) || '_  _  _  _  _  _'}`);
    } else {
      lines[0] = `${spinner} ${lines[0]}`;
    }
    return React.createElement(Card, { ink, title: 'Working', color: 'yellow', lines });
  }
  if (state.pendingKind === 'method') {
    return React.createElement(Card, { ink, title: 'Choose method', color: 'cyan', lines: methodChoiceLines() });
  }
  if (!state.currentSessionId && !state.pendingKind) {
    return React.createElement(Card, { ink, title: 'Ask', color: 'green', lines: [
      `当前方式：${methodLabel(state.method)}`,
      '你想问什么？',
      '',
      '示例：这个项目能不能推进？ / 我和猫关系好吗？ / 这笔钱什么时候能到？',
    ] });
  }
  return null;
}

function renderBlock(ink: InkModule, block: MessageBlock): React.ReactElement {
  if (block.kind === 'user' || block.kind === 'roy') {
    return React.createElement(DialogLine, { key: block.id, ink, speaker: block.kind === 'user' ? '你' : 'Roy', color: block.kind === 'user' ? 'blue' : 'green', lines: block.lines });
  }
  return React.createElement(Card, { key: block.id, ink, title: block.title || block.kind, color: colorFor(block.kind), lines: block.lines });
}

function DialogLine({ ink, speaker, color, lines }: { ink: InkModule; speaker: string; color: string; lines: string[] }) {
  const { Box, Text } = ink;
  return React.createElement(Box, { flexDirection: 'column', marginBottom: 0 },
    ...lines.map((line, i) => React.createElement(Box, { key: i },
      React.createElement(Text, { color: color as any }, i === 0 ? `${speaker}：` : '     '),
      React.createElement(Text, null, ' '),
      React.createElement(Text, null, line),
    )),
  );
}

function InputPanel({ ink, input, busy, hint }: { ink: InkModule; input: string; busy: boolean; hint: string }) {
  return React.createElement(Card, { ink, title: 'Input', color: busy ? 'gray' : 'cyan', lines: [
    hint,
    `> ${busy ? '(working...)' : input}`,
  ] });
}

function Card({ ink, title, lines, color = 'gray' }: { ink: InkModule; title: string; lines: string[]; color?: string }) {
  const { Box, Text } = ink;
  return React.createElement(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: color as any, paddingX: 1, marginBottom: 1 },
    React.createElement(Text, { color: color as any, bold: true }, title),
    ...lines.flatMap((line, i) => wrapPlain(line, 84).map((wrapped, j) =>
      React.createElement(Text, { key: `${i}-${j}` }, wrapped),
    )),
  );
}

function initialBlocks(state: AppState): MessageBlock[] {
  return [
    {
      id: 'intro',
      kind: 'roy',
      title: 'Roy',
      lines: state.pendingKind === 'method'
        ? ['请选择起卦方式。']
        : [`已进入 ${methodLabel(state.method)}。输入问题后，我会完成：起卦 → 排盘 → 检索 → 分析 → 流式短答。`],
    },
  ];
}

function methodChoiceLines(): string[] {
  return [
    '> [2] 自动摇卦     模拟三枚硬币摇六次，适合标准六爻问事',
    '  [1] 手动六爻     输入 6 个 6/7/8/9，用于复盘或测试',
    '  [3] 时间起卦     按当前时间生成上卦、下卦和动爻',
    '  [4] 数字起卦     输入 3 个数字：上卦、下卦、动爻',
    '  [5] 汉字起卦     输入 1 个汉字，按笔画/时间取数',
  ];
}

function colorFor(kind: MessageBlock['kind']): string {
  switch (kind) {
    case 'roy': return 'green';
    case 'user': return 'blue';
    case 'tools': return 'yellow';
    case 'chart': return 'magenta';
    case 'sessions': return 'cyan';
    case 'rag': return 'yellow';
    case 'answer': return 'green';
    case 'error': return 'red';
    default: return 'gray';
  }
}

function inputHint(state: AppState, busy: boolean): string {
  if (busy) return '系统正在执行当前流程，输入暂时锁定。';
  if (state.pendingKind === 'method') return '输入 1-5 选择起卦方式；输入 /help 查看命令。';
  if (state.pendingKind === 'manual') return '请输入 6 个爻值：6/7/8/9 或 0/1。';
  if (state.pendingKind === 'numbers') return '请输入 3 个数字，例如：2 9 5。';
  if (state.pendingKind === 'character') return '请输入 1 个汉字。';
  if (state.pendingKind === 'analysis_mode') return '输入 1 快速分析，2 深度推演，或 /think 3。';
  if (state.currentSessionId) return '直接输入可继续追问；/new 重新起卦；/chart 查看排盘。';
  return '输入你的问题；/method 切换起卦方式；/sessions 管理历史会话。';
}

async function streamPost(pathname: string, body: any, onContent: (chunk: string) => void): Promise<string> {
  const token = getToken();
  const response = await fetch(`${getBaseUrl()}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    throw new Error(`stream request failed: ${response.status} ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const line = event.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      const payload = JSON.parse(line.slice(5).trim());
      if (payload.type === 'content') {
        full += payload.content;
        onContent(payload.content);
      } else if (payload.type === 'done') {
        if (payload.content && !full) full = payload.content;
      } else if (payload.type === 'error') {
        throw new Error(payload.error || 'stream error');
      }
    }
  }
  return full;
}

async function listPermanentConversations(): Promise<any[]> {
  const data = await apiGet<any[]>('/memory/permanent', { pageSize: 20 });
  return Array.isArray(data) ? data : [];
}

function formatConnectionHelp(err: unknown, prefix: string): string {
  const message = String((err as any)?.message || err || '');
  if (message.includes('ECONNREFUSED') || message.includes('connect')) {
    return `${prefix} 当前无法连接 Orbit API（${getBaseUrl()}）。请先确认后端已启动：npm run dev。`;
  }
  return `${prefix} ${message || '未知错误'}`;
}

async function printHistoryBlock(sessionId: string, append: (block: Omit<MessageBlock, 'id'>) => void): Promise<void> {
  try {
    const conversations = await listPermanentConversations();
    const conversation = conversations.find((c) => c.sessionId === sessionId);
    const messages = conversation
      ? await apiGet<any[]>(`/memory/permanent/${encodeURIComponent(conversation.id)}/messages`, { pageSize: 8 })
      : await apiGet<any[]>(`/chat/${encodeURIComponent(sessionId)}`, { limit: 6 });
    append({
      kind: 'sessions',
      title: `History ${sessionId}`,
      lines: messages.length ? messages.map((m) => `${m.role === 'user' ? '你' : 'Roy'}: ${trimInline(m.content, 160)}`) : ['没有历史消息。'],
    });
  } catch (err: any) {
    append({ kind: 'roy', title: 'Roy', lines: [formatConnectionHelp(err, '读取历史消息失败。')] });
  }
}

function buildToolRows(data: any, detail = false): string[] {
  const chart = data.chart || {};
  const debug = data.debug || {};
  const ragHits = debug.rag?.deduped?.length ?? data.report?.citations?.length ?? 0;
  const rows = [
    `✓ cast.${data.casting?.method || 'input'}        ${formatYaoValues(data.casting)}`,
    `✓ chart.assemble    ${chartPair(chart)} · ${movingLabel(chart)}`,
    `✓ calendar          ${formatCalendar(chart)}`,
    `✓ rag.retrieve      ${ragHits} chunks`,
    `✓ analyze           ${data.thinking ? `${data.angles || 3} angles` : 'brief + detailed'}`,
    '✓ summary.stream    interactive brief',
  ];
  if (detail) {
    const queries = debug.rag?.queries || debug.understanding?.ragQueries || [];
    if (Array.isArray(queries) && queries.length) rows.push(`rag.query          ${queries.slice(0, 5).join(' / ')}`);
  }
  return rows;
}

function buildChartSummary(data: any, question?: string): string[] {
  const chart = data.chart || {};
  const shi = findLine(chart, 'shi');
  const ying = findLine(chart, 'ying');
  return [
    question ? `问题：${question}` : '',
    `起卦：${formatCasting(data.casting)}`,
    `本卦：${hexName(chart.originalHexagram)}        变卦：${hexName(chart.changedHexagram)}        ${movingLabel(chart)}`,
    `卦宫：${chart.originalHexagram?.palace ?? '?'}宫 · ${chart.originalHexagram?.palaceType ?? '?'} · ${chart.originalHexagram?.element ?? '?'}`,
    `动爻：${formatMoving(chart)}`,
    shi ? `世爻：${formatLineSummary(shi)}` : '世爻：未标注',
    ying ? `应爻：${formatLineSummary(ying)}` : '应爻：未标注',
    formatYongshen(chart) ? `用神：${formatYongshen(chart)}` : '',
  ].filter(Boolean);
}

function buildFullChartLines(data: any): string[] {
  const chart = data.chart || {};
  const rows = [
    `本卦：${hexName(chart.originalHexagram)}    变卦：${hexName(chart.changedHexagram)}`,
    `卦宫：${chart.originalHexagram?.palace ?? '?'}宫 · ${chart.originalHexagram?.palaceType ?? '?'} · ${chart.originalHexagram?.element ?? '?'}`,
    '',
    ...buildHexagramPictureLines(chart),
    '',
    'Lines 初爻 → 上爻',
  ];
  const lines = Array.isArray(chart.lines) ? chart.lines : [];
  for (const l of lines) {
    rows.push(`${l.position}  ${l.stem || ''}${l.branch || ''} ${l.element || ''}  ${l.sixRelative || ''}  ${l.sixGod || ''}${l.isShi ? '  世' : ''}${l.isYing ? '  应' : ''}${l.void ? '  旬空' : ''}${l.moving ? `  动→${l.changedStem || ''}${l.changedBranch || ''} ${l.changedSixRelative || ''}` : ''}`);
  }
  return rows;
}

function buildHexagramPictureLines(chart: any): string[] {
  const lines = Array.isArray(chart.lines) ? chart.lines : [];
  if (lines.length !== 6) return ['卦画：当前 chart.lines 不完整，无法绘制。'];
  const movingSet = new Set(Array.isArray(chart.movingLines) ? chart.movingLines : []);
  const rows = [
    '卦画（上爻 → 初爻）',
    '本卦              变卦              标记',
  ];
  for (let i = 5; i >= 0; i -= 1) {
    const l = lines[i]!;
    const isMoving = movingSet.has(l.position);
    const original = plainHexLine(l.yinYang);
    const changed = plainHexLine(l.changedYinYang || l.yinYang);
    const tags = [
      `第${l.position}爻`,
      l.isShi ? '世' : '',
      l.isYing ? '应' : '',
      isMoving ? '动' : '',
      l.void ? '旬空' : '',
    ].filter(Boolean).join(' ');
    rows.push(`${original}    ${changed}    ${tags}`);
  }
  const shiLine = lines.find((l: any) => l.isShi);
  const yingLine = lines.find((l: any) => l.isYing);
  if (shiLine || yingLine) {
    rows.push('');
    if (shiLine) rows.push(`世爻：第${shiLine.position}爻 ${shiLine.stem || ''}${shiLine.branch || ''} ${shiLine.sixRelative || ''} 临${shiLine.sixGod || ''}`);
    if (yingLine) rows.push(`应爻：第${yingLine.position}爻 ${yingLine.stem || ''}${yingLine.branch || ''} ${yingLine.sixRelative || ''} 临${yingLine.sixGod || ''}`);
  }
  return rows;
}

function plainHexLine(yinYang: unknown): string {
  return yinYang === '阳' ? '━━━━━━━━━━' : '━━━━  ━━━━';
}

function buildWhyLines(data: any): string[] {
  const debug = data.debug || {};
  const report = cleanReportForDisplay(data.content || '');
  return [
    'Analysis trace',
    `1. 问题类型：${debug.understanding?.refinedQuestionType || data.report?.understanding?.questionType || '未识别'}`,
    `2. 焦点用神：${(debug.understanding?.focusYongshen || []).join('、') || '未明确'}`,
    `3. 检索命中：${debug.rag?.deduped?.length ?? data.report?.citations?.length ?? 0} 条`,
    '',
    ...report.split('\n').slice(0, 120),
  ];
}

function buildRagLines(data: any | null): string[] {
  if (!data) return ['当前没有检索记录。'];
  const hits = data.debug?.rag?.deduped || data.report?.citations || [];
  if (!Array.isArray(hits) || hits.length === 0) return ['本轮没有可展示的检索命中。'];
  return hits.slice(0, 10).map((h: any, i: number) => `${i + 1}. ${h.source || 'unknown'}${h.title ? ` · ${h.title}` : ''}    ${typeof h.score === 'number' ? `score ${h.score.toFixed(2)}` : ''}`);
}

function buildRagSummaryLines(data: any | null): string[] {
  if (!data) return ['· 暂无检索记录'];
  const debug = data.debug || {};
  const hits = debug.rag?.deduped || data.report?.citations || [];
  const queries = debug.rag?.queries || debug.understanding?.ragQueries || [];
  const topics = Array.isArray(queries) && queries.length
    ? queries.slice(0, 6).map((q: string) => q.replace(/\s+/g, ' ').slice(0, 12)).join('、')
    : '世应、用神、动爻、卦象';
  return [`✓ 命中 ${Array.isArray(hits) ? hits.length : 0} 条：${topics}`, '输入 /rag 查看检索依据。'];
}

function commandHelpLines(state: AppState): string[] {
  return [
    '/new [method]        重新起卦',
    '/method [method]     切换起卦方式',
    '/sessions            调出历史会话管理',
    '/use <sessionId>     切换会话',
    '/delete <sessionId>  删除某一会话',
    '/delete all          删除当前用户全部会话',
    '/chart               查看排盘摘要',
    '/chart full          查看卦画 + 完整六爻表',
    '/why                 展开完整报告和分析摘要',
    '/rag                 查看检索依据',
    '/rag check           检查知识库更新',
    '/tools               查看工具执行块',
    '/session             查看当前上下文',
    '/history [session]   查看历史消息',
    '/export              导出当前报告',
    '/clear               清屏',
    '/exit                退出',
    '',
    `当前：session=${state.currentSessionId || 'new'} method=${state.method}`,
  ];
}

function sessionLines(state: AppState): string[] {
  return [
    `session: ${state.currentSessionId || 'new'}`,
    `method: ${state.method}`,
    `chart: ${state.lastReading ? chartPair(state.lastReading.chart || {}) : 'none'}`,
    `thinking: ${state.thinking ? `${state.angles} angles` : 'off'}`,
    `last question: ${state.lastQuestion || 'none'}`,
  ];
}

function exportLastReading(state: AppState, append: (block: Omit<MessageBlock, 'id'>) => void): void {
  if (!state.lastReading) {
    append({ kind: 'error', title: 'Export', lines: ['当前没有可导出的报告。'] });
    return;
  }
  const session = state.currentSessionId || 'new';
  const file = path.resolve(process.cwd(), `orbit-liuyao-${session}.md`);
  fs.writeFileSync(file, [
    '# Orbit Liuyao Report',
    '',
    `- session: ${session}`,
    `- question: ${state.lastQuestion || ''}`,
    `- chart: ${chartPair(state.lastReading.chart || {})}`,
    '',
    state.lastSummary ? `## Summary\n\n${state.lastSummary}\n` : '',
    `## Full Report\n\n${cleanReportForDisplay(state.lastReading.content || '')}`,
  ].join('\n'), 'utf8');
  append({ kind: 'system', title: 'Export', lines: [`已导出：${file}`] });
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

function methodLabel(method: LiuyaoAppMethod): string {
  return ({
    manual: '手动六爻 · manual',
    coins: '自动摇卦 · coins',
    time: '时间起卦 · time',
    numbers: '数字起卦 · numbers',
    character: '汉字起卦 · character',
  } as const)[method];
}

function clampAngles(value: unknown): number {
  const raw = Number(value);
  return Number.isFinite(raw) ? Math.max(1, Math.min(5, Math.floor(raw))) : 3;
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
  return '';
}

function findLine(chart: any, kind: 'shi' | 'ying'): any | null {
  const lines = chart?.lines;
  if (!Array.isArray(lines)) return null;
  return lines.find((l) => kind === 'shi' ? l.isShi : l.isYing) || null;
}

function formatLineSummary(line: any): string {
  return [
    `第 ${line.position} 爻`,
    `${line.stem || ''}${line.branch || ''}${line.element ? `(${line.element})` : ''}`,
    line.sixRelative,
    line.sixGod ? `临${line.sixGod}` : '',
    line.void ? '旬空' : '',
    line.moving ? '动' : '',
  ].filter(Boolean).join(' ');
}

function formatYongshen(chart: any): string {
  const candidates = chart?.yongshen?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  return candidates.slice(0, 2).map((c: any) => {
    const positions = Array.isArray(c.positions) && c.positions.length ? `，第 ${c.positions.join('、')} 爻` : '';
    return `${c.relative}${positions}`;
  }).join('；');
}

function cleanReportForDisplay(value: string): string {
  return String(value || '')
    .replace(/\n## 引用[\s\S]*$/m, '')
    .replace(/\[cite:[^\]]+\]/g, '')
    .replace(/\[[0-9,\s]+\]/g, '')
    .trim();
}

function trimInline(value: string, max: number): string {
  const s = cleanReportForDisplay(String(value || '')).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function wrapPlain(value: string, width: number): string[] {
  if (!value) return [''];
  const out: string[] = [];
  let cur = '';
  let curWidth = 0;
  for (const ch of Array.from(value)) {
    const w = (ch.codePointAt(0) || 0) > 0x1100 ? 2 : 1;
    if (curWidth + w > width) {
      out.push(cur);
      cur = ch;
      curWidth = w;
    } else {
      cur += ch;
      curWidth += w;
    }
  }
  out.push(cur);
  return out;
}
