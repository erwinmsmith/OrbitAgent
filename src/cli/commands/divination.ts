/**
 * `orbit divination ...` — client for /api/v1/divination/*.
 *
 * Subcommands:
 *   cast <b1>..<b6>           — six raw bits (0|1) → CastResult
 *   chart <b1>..<b6> [--question Q] [--day-stem 甲] [--day-branch 子] ...
 *                                — full ChartResult
 *   brief --session <id>       — read the structured ChartBrief for a stored
 *                                chart (the deterministic "understanding
 *                                material" doc that the analyze pipeline
 *                                feeds to its first LLM call). No LLM cost.
 *   analyze <chart.json>       — run the analysis agent on a chart
 *                                (multi-stage pipeline: brief → understand
 *                                → RAG → synthesize). --debug prints the
 *                                full timeline.
 *   rag stats | search Q       — query the RAG index
 *   rag rebuild                — rebuild the RAG index
 *   rag upload <file.md>       — ingest a markdown file (user-scope; --system for admin)
 *   rag list                   — list docs you can see
 *   rag delete <source>        — delete a doc you own (or any, if admin)
 */
import { Command } from 'commander';
import fs from 'fs';
import chalk from 'chalk';
import { apiPost, apiGet, apiDelete } from '../http';

export async function postDivinationAsk(body: any): Promise<any> {
  try {
    return await apiPost<any>('/divination/ask', body);
  } catch (err: any) {
    if (!isMissingAskRoute(err)) throw err;

    // Backward-compatible fallback for a running server that has not
    // been restarted since /divination/ask was added. It preserves the
    // same user-facing flow by calling the old endpoints:
    //   chart/store -> chat with the default 六爻 prompt.
    const chartBody = { ...body };
    delete chartBody.message;
    delete chartBody.debug;
    delete chartBody.thinking;
    delete chartBody.angles;
    const chart = await apiPost<any>('/divination/chart', chartBody);
    const chatBody: any = {
      sessionId: body.sessionId,
      message: body.message || '请结合卦象分析、解答问题',
      agentId: body.agentId || 'default',
      debug: !!body.debug,
    };
    if (body.thinking) chatBody.thinking = true;
    if (Number.isFinite(body.angles)) chatBody.angles = body.angles;
    const chat = await apiPost<any>('/chat', chatBody);
    return {
      sessionId: chat.sessionId || body.sessionId,
      chartKey: body.chartKey || 'default',
      message: chatBody.message,
      thinking: !!body.thinking,
      angles: body.thinking ? body.angles : undefined,
      content: chat.content,
      chart,
      debug: chat.debug,
      _fallback: 'server-missing-/divination/ask; used /divination/chart + /chat',
    };
  }
}

function isMissingAskRoute(err: any): boolean {
  if (err?.response?.status !== 404) return false;
  const code = err.response.data?.error?.code || '';
  const message = err.response.data?.error?.message || '';
  return code === 'RESOURCE_NOT_FOUND' && String(message).includes('/divination/ask');
}

export function registerDivination(program: Command): void {
  const cmd = new Command('divination')
    .description('六爻 client — coins → cast → chart → analyze, plus RAG search');

  cmd.command('cast <bits...>')
    .description('Convert six 0/1 bits into a CastResult. Example: orbit divination cast 0 1 1 0 1 1')
    .action(async (bits: string[]) => {
      const arr = parseSixBits(bits);
      try {
        const data = await apiPost<any>('/divination/cast', { bits: arr });
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) { console.error(chalk.red(`✗ ${err.message}`)); process.exit(1); }
    });

  cmd.command('cast-method <method> [values...]')
    .description('Normalize a casting method into six yaoValues. Methods: coins(auto/random), time, numbers, character, manual.')
    .option('--numbers <values...>', 'Three numbers for numbers casting. You may also pass them as positional values.')
    .option('--char <c>', 'One Han character for character casting. You may also pass it as the first positional value.')
    .option('--datetime <iso>', 'Datetime used by time/character casting. Defaults to now on the server.')
    .option('--timezone <tz>', 'IANA timezone used by time/character casting. Default: Asia/Shanghai.')
    .option('--yao', 'For manual casting, interpret positional values as 6/7/8/9 instead of 0/1 bits.', false)
    .option('--json', 'Print raw JSON response.', false)
    .action(async (method: string, values: string[] | undefined, opts) => {
      try {
        const body = buildCastingRequest(method, values ?? [], opts);
        const data = await apiPost<any>('/divination/cast', body);
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        renderCastingSummary(data);
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`));
        process.exit(1);
      }
    });

  cmd.command('chart [bits...]')
    .description('Run the full chart assembler AND persist it to the session store. Positional args are 6 × 0/1 (static yin/yang) by default. Pass --yao to switch to 6 × 6/7/8/9 (supports moving lines 6 and 9). If you don\'t pass --day-stem / --day-branch, they are auto-derived from --datetime (or "now" if omitted) using lunar-typescript.')
    .option('-q, --question <q>', 'Question text (used for 用神 + analysis)')
    .option('--question-type <t>', 'Override question type (e.g. 求财, 求事业)')
    .option('--day-stem <s>', '日干 (e.g. 甲) — overrides the auto-derived value')
    .option('--day-branch <b>', '日支 (e.g. 子) — overrides the auto-derived value')
    .option('--month-branch <b>', '月支 (e.g. 寅) — needed for 月破 + 旺衰')
    .option('--datetime <iso>', 'ISO-8601 datetime string (e.g. 2026-06-04T14:00:00+08:00). Defaults to "now" if omitted.')
    .option('--timezone <tz>', 'IANA timezone for the calendar skill (e.g. Asia/Shanghai). Defaults to system local.')
    .option('-s, --session <id>', 'Session id under which to store the chart (auto-generated if omitted; pass the same value to `orbit chat` later)')
    .option('--chart-key <k>', 'Logical name for this chart within the session (default: "default")', 'default')
    .option('--method <m>', 'Casting method: manual|coins|time|numbers|character. Alias auto=random coins.')
    .option('--numbers <values...>', 'Three numbers for --method numbers.')
    .option('--char <c>', 'One Han character for --method character.')
    .option('--yao', 'Interpret the 6 positional args as 6/7/8/9 爻值 (with moving lines) instead of 0/1 bits.', false)
    .action(async (bits: string[] | undefined, opts) => {
      bits = bits ?? [];
      const usesStructuredCasting = shouldUseStructuredCasting(opts, bits);
      if (!usesStructuredCasting && bits.length === 0) {
        console.error(chalk.red(
          `✗ missing 6 positional args.\n` +
          `  Examples:\n` +
          `    orbit divination chart 1 1 1 1 1 1 ...        # static yin/yang (bits)\n` +
          `    orbit divination chart --yao 7 7 7 7 9 7 ...  # raw 爻值 (6/7/8/9, supports moving lines)\n`,
        ));
        process.exit(2);
      }
      const sessionId = opts.session || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const body: any = { sessionId, chartKey: opts.chartKey };
      if (usesStructuredCasting) {
        Object.assign(body, buildCastingRequest(opts.method, bits, opts));
      } else if (opts.yao) {
        const yaoArr = parseSixYao(bits);
        body.yaoValues = yaoArr;
      } else {
        const arr = parseSixBits(bits);
        body.bits = arr;
      }
      if (opts.question) body.question = opts.question;
      if (opts.questionType) body.questionType = opts.questionType;
      if (opts.dayStem) body.dayStem = opts.dayStem;
      if (opts.dayBranch) body.dayBranch = opts.dayBranch;
      if (opts.monthBranch) body.monthBranch = opts.monthBranch;
      if (opts.datetime) body.datetime = opts.datetime;
      if (opts.timezone) body.timezone = opts.timezone;
      try {
        const data = await apiPost<any>('/divination/chart', body);
        // Print the warnings prominently if present.
        if (data.warnings?.length) {
          console.log(chalk.yellow(`⚠ warnings:`));
          for (const w of data.warnings) console.log(chalk.yellow(`  - ${w}`));
          console.log();
        }
        // Time block (if calendar skill ran) — show the 4 pillars
        // and xunkong that were auto-derived, so the user can verify
        // the engine used the right date.
        if (data.time?.yearStem) {
          console.log(`  ${chalk.gray('time:')}  ${chalk.cyan(`${data.time.yearStem}${data.time.yearBranch}年 / ${data.time.monthStem}${data.time.monthBranch}月 / ${data.time.dayStem}${data.time.dayBranch}日 / ${data.time.hourStem}${data.time.hourBranch}时`)}`);
          if (data.time.xunkong?.length) {
            console.log(`         ${chalk.gray('旬空:')} ${chalk.yellow(data.time.xunkong.join('、'))}    ${chalk.gray('节气:')} ${data.time.solarTerm || '?'}`);
          }
          console.log();
        }
        // Strip the ChartResult noise and just print the essentials.
        console.log(chalk.green(`✓ Chart assembled and stored.`));
        console.log(`  sessionId: ${chalk.cyan(sessionId)}`);
        console.log(`  chartKey:   ${chalk.cyan(opts.chartKey)}`);
        if (data.casting) {
          console.log(`  casting:    ${chalk.cyan(formatCastingOneLine(data.casting))}`);
        }
        console.log(`  palace:     ${chalk.cyan(`${data.originalHexagram?.palace ?? '?'}宫 · ${data.originalHexagram?.palaceType ?? '?'} · ${data.originalHexagram?.element ?? '?'}`)}`);
        console.log(`  shi/ying:   ${chalk.cyan(`${data.lines?.find((l: any) => l.isShi)?.position ?? '?'}/${data.lines?.find((l: any) => l.isYing)?.position ?? '?'}`)}`);
        const moving = (data.movingLines as number[]) || [];
        console.log(`  moving:     ${chalk.cyan(moving.length ? moving.join(',') : 'none')}`);
        // Hexagram picture — both 本卦 and 变卦 side by side, top-to-bottom.
        // The renderer marks moving lines and shows the changed yin/yang
        // for each moving line.
        console.log();
        console.log(`  ${chalk.bold('本卦')} ${data.originalHexagram?.fullName ?? data.originalHexagram?.name ?? '?'}` +
                    `     ${chalk.bold('变卦')} ${chalk.cyan(data.changedHexagram?.fullName ?? data.changedHexagram?.name ?? '?')}`);
        renderHexagramPair(data);
        renderLineDetails(data);
        console.log();
        console.log(chalk.gray(`Next: orbit chat --session ${sessionId} "帮我分析"`));
        console.log(chalk.gray(`Or:   orbit divination analyze <chart.json>  (for a stand-alone report)`));
      } catch (err: any) { console.error(chalk.red(`✗ ${err.message}`)); process.exit(1); }
    });

  cmd.command('ask [bits...]')
    .description('One-shot full flow: cast/chart/store, then run the default 六爻 agent analysis with RAG. Positional args are 6 × 0/1 by default; pass --yao for 6/7/8/9 moving-line input.')
    .option('-q, --question <q>', 'Question text')
    .option('--question-type <t>', 'Override question type (e.g. 求财, 求事业)')
    .option('--day-stem <s>', '日干 (e.g. 甲) — overrides the auto-derived value')
    .option('--day-branch <b>', '日支 (e.g. 子) — overrides the auto-derived value')
    .option('--month-branch <b>', '月支 (e.g. 寅) — needed for 月破 + 旺衰')
    .option('--datetime <iso>', 'ISO-8601 datetime string. Defaults to "now" on the server if omitted.')
    .option('--timezone <tz>', 'IANA timezone for the calendar skill (e.g. Asia/Shanghai).')
    .option('-s, --session <id>', 'Session id for storing the chart and chat turn (auto-generated if omitted)')
    .option('--chart-key <k>', 'Logical name for this chart within the session (default: "default")', 'default')
    .option('--method <m>', 'Casting method: manual|coins|time|numbers|character. Alias auto=random coins.')
    .option('--numbers <values...>', 'Three numbers for --method numbers.')
    .option('--char <c>', 'One Han character for --method character.')
    .option('--yao', 'Interpret positional args as 6/7/8/9 爻值 instead of 0/1 bits.', false)
    .option('--message <text>', 'Chat prompt sent after charting', '请结合卦象分析、解答问题')
    .option('--thinking', 'Enable multi-angle thinking mode (slower, more thorough, more tokens).', false)
    .option('--angles <n>', 'Number of independent angles in --thinking mode. Clamped to 1–5, default 3.', (v) => parseInt(v, 10))
    .option('--debug', 'Include and render the analysis pipeline timeline.', false)
    .option('--json', 'Print raw JSON response instead of the formatted report.', false)
    .action(async (bits: string[] | undefined, opts) => {
      bits = bits ?? [];
      const usesStructuredCasting = shouldUseStructuredCasting(opts, bits);
      if (!usesStructuredCasting && bits.length === 0) {
        console.error(chalk.red(
          `✗ missing 6 positional args.\n` +
          `  Examples:\n` +
          `    orbit divination ask --yao 7 8 7 9 7 8 -q "我是否应该接受 offer？"\n` +
          `    orbit divination ask 1 1 1 1 1 1 -q "这件事能成吗？"\n`,
        ));
        process.exit(2);
      }
      const sessionId = opts.session || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const body: any = {
        sessionId,
        chartKey: opts.chartKey,
        message: opts.message,
        debug: !!opts.debug,
      };
      if (usesStructuredCasting) Object.assign(body, buildCastingRequest(opts.method, bits, opts));
      else if (opts.yao) body.yaoValues = parseSixYao(bits);
      else body.bits = parseSixBits(bits);
      if (opts.question) body.question = opts.question;
      if (opts.questionType) body.questionType = opts.questionType;
      if (opts.dayStem) body.dayStem = opts.dayStem;
      if (opts.dayBranch) body.dayBranch = opts.dayBranch;
      if (opts.monthBranch) body.monthBranch = opts.monthBranch;
      if (opts.datetime) body.datetime = opts.datetime;
      if (opts.timezone) body.timezone = opts.timezone;
      if (opts.thinking) body.thinking = true;
      if (Number.isFinite(opts.angles)) body.angles = opts.angles;

      try {
        const data = await postDivinationAsk(body);
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        if (data._fallback) {
          console.log(chalk.yellow('⚠ server does not expose /divination/ask yet; used chart → chat fallback. Restart npm run dev to use the new API directly.'));
        }
        renderDivinationReading(data);
        console.log();
        console.log(data.content || '(no analysis content)');
        if (opts.debug && data.debug) renderPipelineTimeline(data.debug);
        console.log(chalk.gray(`\nContinue: orbit chat --session ${data.sessionId} "继续追问..."`));
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`));
        process.exit(1);
      }
    });

  cmd.command('analyze <file>')
    .description('Run the analysis agent on a chart read from a JSON file (e.g. one produced by `chart`). Pass --debug to see the full multi-stage pipeline timeline. Pass --thinking to enable multi-angle analysis (1 + N + 1 LLM calls, each angle with its own RAG pass).')
    .option('--debug', 'Show the full pipeline timeline: build brief → LLM #1 understand → RAG retrieve → LLM #2 synthesize')
    .option('--thinking', 'Enable multi-angle thinking mode (1 + N + 1 LLM calls; one per angle, each with its own RAG pass). Slower and more thorough than the default 3-stage pipeline.')
    .option('--angles <n>', 'Number of independent angles to investigate in --thinking mode. Clamped to 1–5, default 3.', (v) => parseInt(v, 10))
    .action(async (file: string, opts) => {
      let chart: any;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        // Accept either a raw ChartResult or the { success, data } envelope
        // that the /chart endpoint returns.
        chart = (parsed && typeof parsed === 'object' && 'data' in parsed && 'success' in parsed)
          ? parsed.data
          : parsed;
      }
      catch (err: any) {
        console.error(chalk.red(`✗ cannot read chart from ${file}: ${err.message}`));
        process.exit(1);
      }
      try {
        const body: any = { chart, debug: !!opts.debug };
        if (opts.thinking) body.thinking = true;
        if (Number.isFinite(opts.angles)) body.angles = opts.angles;
        const data = await apiPost<any>('/divination/analyze', body);
        // When debug=false, the route returns the report at the top
        // level. When debug=true, it returns { report, brief, debug }.
        const report = data.report ?? data;
        // Render the report sections in fixed order.
        const order = [
          ['summary',                       '一、排盘摘要'],
          ['originalHexagramInterpretation','二、本卦状态'],
          ['changedHexagramInterpretation','三、变卦趋势'],
          ['movingLineAnalysis',           '四、动爻分析'],
          ['shiYingAnalysis',              '五、世应关系'],
          ['yongshenAnalysis',             '六、用神与关键六亲'],
          ['strengthAndRelations',         '七、旺衰、空破与冲合'],
          ['synthesis',                     '八、综合判断'],
        ];
        for (const [k, label] of order) {
          if (report[k]) {
            console.log(chalk.bold(label));
            console.log(report[k]);
            console.log();
          }
        }
        if (report.uncertainties?.length) {
          console.log(chalk.bold('九、不确定性与需要补充的信息'));
          for (const u of report.uncertainties) console.log(`- ${u}`);
          console.log();
        }
        if (report.citations?.length) {
          console.log(chalk.gray('引用 (RAG):'));
          for (const c of report.citations) {
            console.log(chalk.gray(`  · ${c.source} (score=${c.score.toFixed(3)})`));
            console.log(chalk.gray(`    ${c.snippet}`));
          }
        }
        if (opts.debug && data.debug) {
          renderPipelineTimeline(data.debug);
        }
      } catch (err: any) { console.error(chalk.red(`✗ ${err.message}`)); process.exit(1); }
    });

  cmd.command('brief')
    .description('Read the structured ChartBrief for a stored chart. The brief is the deterministic "understanding material" doc that the analyze pipeline feeds to its first LLM call — inspect it on its own without paying for LLM calls.')
    .requiredOption('-s, --session <id>', 'Session id (same as the one passed to `chart`)')
    .option('--chart-key <k>', 'Logical name for the chart within the session (default: latest)', undefined as string | undefined)
    .option('--json', 'Print the full structured brief as JSON (default: print the markdown rendering)', false)
    .action(async (opts) => {
      const qs = new URLSearchParams();
      if (opts.chartKey) qs.set('chartKey', opts.chartKey);
      const url = `/divination/brief/${encodeURIComponent(opts.session)}${qs.toString() ? `?${qs.toString()}` : ''}`;
      try {
        const brief = await apiGet<any>(url);
        if (opts.json) {
          console.log(JSON.stringify(brief, null, 2));
        } else {
          console.log(chalk.bold(`ChartBrief for session ${chalk.cyan(opts.session)}`));
          console.log(chalk.gray('─'.repeat(60)));
          console.log(brief.asMarkdown);
        }
      } catch (err: any) { console.error(chalk.red(`✗ ${err.message}`)); process.exit(1); }
    });

  // ─── RAG ────────────────────────────────────────────────────────────
  const rag = new Command('rag').description('RAG knowledge-base commands');
  rag.command('stats')
    .description('Show RAG index stats')
    .action(async () => {
      // The server exposes /rag/list (not /rag/stats) with the
      // { totalChunks, totalDocuments, per-scope, sources } shape.
      const data = await apiGet<any>('/divination/rag/list');
      console.log(`chunks:     ${data.totalChunks ?? 0}`);
      console.log(`documents:  ${data.totalDocuments ?? 0}`);
      if (data.systemChunks != null) console.log(`  system:  ${data.systemChunks}`);
      if (data.userChunksForRequester != null) console.log(`  user:    ${data.userChunksForRequester}  (yours)`);
      if (Array.isArray(data.sources)) {
        for (const s of data.sources) {
          console.log(`  - ${s.source}  (${s.scope})  ${s.title ? '— ' + s.title : ''}`);
        }
      }
    });

  rag.command('search <query...>')
    .description('Search the RAG index')
    .option('-k <n>', 'top-k results', (v) => parseInt(v, 10))
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ');
      const body: any = { query: q };
      if (opts.k) body.k = parseInt(opts.k, 10);
      const results = await apiPost<any[]>('/divination/rag/search', body);
      for (const r of results) {
        console.log(`${chalk.cyan(r.source)} — ${chalk.bold(r.title || '?')} (${r.score.toFixed(3)})`);
        // Server returns `snippet` (truncated to 200 chars), not
        // the full chunk `text`.
        console.log(chalk.gray(`  ${r.snippet || ''}`));
        console.log();
      }
    });

  rag.command('rebuild')
    .description('Rebuild the RAG index (run after editing docs/base_knowledge/*.md)')
    .action(async () => {
      const r = await apiPost<any>('/divination/rag/rebuild');
      console.log(chalk.green(`✓ rebuilt: ${r.chunkCount} chunks from ${r.sourceCount} sources`));
    });

  rag.command('upload <file>')
    .description('Ingest a markdown file into the RAG index. Defaults to user-scope (private to you). Pass --system as admin to add to the system knowledge base.')
    .option('--system', 'Admin only: ingest as system-scope (visible to all users)', false)
    .action(async (file: string, opts) => {
      let body: string;
      try {
        body = fs.readFileSync(file, 'utf-8');
      } catch (err: any) {
        console.error(chalk.red(`✗ cannot read ${file}: ${err.message}`));
        process.exit(1);
      }
      const filename = file.split('/').pop() || 'upload.md';
      if (!filename.endsWith('.md')) {
        console.error(chalk.red(`✗ filename must end in .md (got ${filename})`));
        process.exit(2);
      }
      const scope = opts.system ? 'system' : 'user';
      const r = await apiPost<any>('/divination/rag/upload', {
        filename, body, scope,
      });
      console.log(chalk.green(`✓ ingested ${r.chunkCount} chunks from ${r.source} (scope=${r.scope})`));
    });

  rag.command('list')
    .description('List documents in the RAG index that you can see (system + your user-scope uploads).')
    .action(async () => {
      const data = await apiGet<any>('/divination/rag/list');
      const { totalChunks, totalDocuments, systemChunks, userChunksForRequester, sources } = data;
      console.log(`chunks:    ${chalk.cyan(totalChunks ?? 0)}   documents: ${chalk.cyan(totalDocuments ?? 0)}`);
      if (systemChunks != null || userChunksForRequester != null) {
        console.log(`  system: ${systemChunks ?? 0}    user: ${userChunksForRequester ?? 0}  (yours)`);
      }
      console.log();
      if (Array.isArray(sources)) {
        for (const s of sources) {
          console.log(`  - ${s.source}  (${s.scope})  ${s.title ? '— ' + s.title : ''}`);
        }
      }
    });

  rag.command('delete <source>')
    .description('Delete a document from the RAG index. You can delete your own user-scope uploads; admins can delete any source. Run `orbit divination rag list` to see exact source strings.')
    .action(async (source: string) => {
      // Sanity: don't let the user accidentally paste the README's
      // example placeholders (with `...`) into the live command.
      if (source.includes('...') || source === 'user:.../test.md' || source === 'docs/base_knowledge/...') {
        console.error(chalk.red(
          `✗ "${source}" looks like a placeholder. Run \`orbit divination rag list\` to see real source strings, then paste the one you want.`,
        ));
        process.exit(2);
      }
      try {
        await apiDelete(`/divination/rag/${encodeURIComponent(source)}`);
        console.log(chalk.green(`✓ deleted ${source}`));
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`));
        console.error(chalk.gray(`  (Run \`orbit divination rag list\` to see what's actually in the index.)`));
        process.exit(1);
      }
    });

  cmd.addCommand(rag);
  program.addCommand(cmd);
}

function parseSixBits(bits: string[]): [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1] {
  if (bits.length !== 6) {
    console.error(chalk.red(`✗ need exactly 6 bits, got ${bits.length}`));
    process.exit(2);
  }
  const out: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    const v = bits[i]!.trim();
    if (v !== '0' && v !== '1') {
      console.error(chalk.red(`✗ bit ${i + 1} must be 0 or 1, got "${bits[i]}"`));
      process.exit(2);
    }
    // Cast to 0|1 (NUMBER, not the original string) so the server's
    // castSkill receives the right JSON type. Sending "1" as a string
    // made the server's yaoValue check (v !== 6 && v !== 7 && ... !==
    // 9) fail, which fell back to an empty chart.
    out[i] = (v === '1' ? 1 : 0) as 0 | 1;
  }
  return out;
}

/** Pretty-print the multi-stage pipeline timeline returned by
 *  `runAnalysisAgent` (or wrapped in `/chat` debug). Used by both
 *  `orbit divination analyze --debug` and `orbit chat --debug`. */
export function renderPipelineTimeline(debug: any): void {
  if (!debug) return;
  const pipeline = debug.pipeline as Array<{
    stage: string;
    durationMs: number;
    meta: Record<string, unknown>;
  }>;
  const titleSep = chalk.gray('─'.repeat(60));
  console.log();
  console.log(chalk.bold.cyan('分析流程时间线 (pipeline)'));
  console.log(titleSep);
  if (Array.isArray(pipeline)) {
    for (const step of pipeline) {
      const stageLabel = stageDisplayName(step.stage);
      const ms = `${step.durationMs}ms`;
      const detail = stageDetail(step);
      console.log(`${chalk.bold(stageLabel)}  ${chalk.gray(ms)}${detail ? '  ' + chalk.gray(detail) : ''}`);
    }
  }

  // Stage 1 detail: the LLM's intermediate understanding.
  const u = debug.understanding;
  if (u) {
    console.log();
    console.log(chalk.cyan('  [理解阶段输出]'));
    if (u.refinedQuestionType) console.log(`    细化的提问类型: ${chalk.yellow(u.refinedQuestionType)}`);
    if (Array.isArray(u.focusYongshen) && u.focusYongshen.length) {
      console.log(`    焦点用神: ${chalk.yellow(u.focusYongshen.join('、'))}`);
    }
    if (Array.isArray(u.ragQueries) && u.ragQueries.length) {
      console.log(`    LLM 提出的 RAG 查询 (${u.ragQueries.length} 个):`);
      for (const q of u.ragQueries) console.log(`      · ${chalk.cyan(q)}`);
    }
    if (u.intermediateUnderstanding) {
      const prose = String(u.intermediateUnderstanding).replace(/\s+/g, ' ').slice(0, 300);
      console.log(`    中间理解: ${chalk.gray(prose)}${prose.length >= 300 ? '…' : ''}`);
    }
  }

  // Stage 2 detail: the actual RAG hits with provenance.
  const rag = debug.rag;
  if (rag) {
    console.log();
    console.log(chalk.cyan('  [RAG 召回]'));
    if (Array.isArray(rag.queries) && rag.queries.length) {
      console.log(`    总查询数: ${chalk.yellow(rag.queries.length)}`);
      console.log(`    合并去重后的 top-k: ${chalk.yellow((rag.deduped ?? []).length)}`);
      console.log('    每个查询的命中:');
      const perQ = rag.perQueryHits ?? [];
      for (const r of perQ) {
        console.log(`      · ${chalk.cyan(r.query)}  hits=${chalk.yellow(r.hitCount)}  topScore=${(r.topScore ?? 0).toFixed(3)}`);
      }
    } else {
      console.log('    没有 RAG 查询');
    }
    if (Array.isArray(rag.deduped) && rag.deduped.length) {
      console.log('    去重后的命中 (含来源追溯):');
      for (const d of rag.deduped) {
        const prov = Array.isArray(d.provenanceQueries) && d.provenanceQueries.length
          ? chalk.gray(` ← [${d.provenanceQueries.join(', ')}]`)
          : '';
        console.log(`      - ${chalk.cyan(d.source)}  ${chalk.gray(d.title)}  score=${d.score.toFixed(3)}${prov}`);
      }
    }
  }

  // Stage 3 detail: synthesis model + token usage.
  const s = debug.synthesis;
  if (s) {
    console.log();
    console.log(chalk.cyan('  [综合分析阶段]'));
    console.log(`    model: ${chalk.yellow(s.model)}  provider: ${chalk.yellow(s.provider)}`);
    if (s.usage) {
      const u = s.usage;
      console.log(`    tokens: in=${u.inputTokens ?? 0}  out=${u.outputTokens ?? 0}  cacheHit=${u.cacheHitTokens ?? 0}`);
    }
  }

  // Thinking-mode per-angle block. Only populated when the pipeline
  // was run with `thinking: true`. Each angle did its own RAG + LLM
  // call; we render the perspective + the LLM's analysis + the
  // per-angle RAG hits so the caller can audit grounding per angle.
  const perAngle = (debug as any).perAngle as Array<{
    name: string;
    perspective: string;
    ragQueries: string[];
    hits: Array<{ source: string; title: string; score: number; snippet: string }>;
    analysis: string;
    model: string;
    provider: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheHitTokens?: number };
  }> | undefined;
  if (Array.isArray(perAngle) && perAngle.length > 0) {
    console.log();
    console.log(chalk.cyan('  [多角度分析 (thinking 模式)]'));
    console.log(`    角度数: ${chalk.yellow(perAngle.length)}`);
    perAngle.forEach((a, i) => {
      console.log();
      console.log(`    ${chalk.bold(`角度 ${i + 1}：${a.name}`)}`);
      console.log(`      perspective: ${chalk.gray(a.perspective)}`);
      if (Array.isArray(a.ragQueries) && a.ragQueries.length) {
        console.log(`      RAG queries: ${a.ragQueries.map((q) => chalk.cyan(q)).join(', ')}`);
      }
      if (Array.isArray(a.hits) && a.hits.length) {
        console.log(`      RAG hits (${a.hits.length}):`);
        for (const h of a.hits) {
          console.log(`        - ${chalk.cyan(h.source)}  ${chalk.gray(h.title)}  score=${(h.score ?? 0).toFixed(3)}`);
          console.log(`          ${chalk.gray((h.snippet || '').replace(/\s+/g, ' ').slice(0, 150))}`);
        }
      }
      if (a.analysis) {
        const prose = String(a.analysis).replace(/\s+/g, ' ').slice(0, 400);
        console.log(`      LLM 分析: ${chalk.gray(prose)}${prose.length >= 400 ? '…' : ''}`);
      }
      if (a.usage) {
        console.log(`      tokens: in=${a.usage.inputTokens ?? 0}  out=${a.usage.outputTokens ?? 0}`);
      }
    });
  }

  console.log(titleSep);
  console.log(chalk.gray(`总耗时: ${debug.totalDurationMs ?? 0}ms`));
}

function stageDisplayName(stage: string): string {
  switch (stage) {
    case 'build-brief':    return '①  构建 ChartBrief';
    case 'understand':     return '②  LLM #1 — 理解';
    case 'rag-retrieve':   return '③  RAG 召回';
    case 'angle-analyze':  return '④  角度分析';
    case 'synthesize':     return '⑤  LLM #N — 综合分析';
    default:                return stage;
  }
}

function stageDetail(step: { stage: string; meta: Record<string, unknown>; angleName?: string }): string {
  const m = step.meta || {};
  switch (step.stage) {
    case 'build-brief':
      return `lines=${m.lineCount ?? '?'}`;
    case 'understand': {
      const u = m.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const tokens = u ? `in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0}` : '';
      const model = m.model ? `${m.model}` : '';
      const anglesTag = m.anglesPlanned ? ` angles=${m.anglesPlanned}` : '';
      return `${model} ${tokens}${anglesTag}`.trim();
    }
    case 'rag-retrieve': {
      const angleTag = step.angleName ? ` (angle=${step.angleName})` : '';
      return `queries=${m.queryCount ?? 0} hits=${m.dedupedCount ?? 0}${angleTag}`.trim();
    }
    case 'angle-analyze': {
      const u = m.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const tokens = u ? `in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0}` : '';
      return `angle=${step.angleName ?? '?'} ${tokens}`.trim();
    }
    case 'synthesize': {
      const u = m.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const tokens = u ? `in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0}` : '';
      const len = m.contentLength ? `${m.contentLength}chars` : '';
      const angleTag = m.angleCount ? ` (merged ${m.angleCount} angles)` : '';
      return `${m.model ?? '?'} ${tokens} ${len}${angleTag}`.trim();
    }
    default:
      return '';
  }
}

function parseSixYao(values: string[]): [6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9] {
  if (values.length !== 6) {
    console.error(chalk.red(`✗ need exactly 6 爻值, got ${values.length}`));
    process.exit(2);
  }
  const out: [6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9] = [7, 7, 7, 7, 7, 7];
  for (let i = 0; i < 6; i++) {
    const v = parseInt(values[i]!.trim(), 10);
    if (v !== 6 && v !== 7 && v !== 8 && v !== 9) {
      console.error(chalk.red(`✗ yao value ${i + 1} must be 6/7/8/9, got "${values[i]}"`));
      process.exit(2);
    }
    out[i] = v as any;
  }
  return out;
}

function shouldUseStructuredCasting(opts: any, values: string[]): boolean {
  if (opts.method || opts.numbers || opts.char) return true;
  if (values.length === 0) return false;
  return ['coins', 'coin', 'auto', 'random', 'time', 'datetime', 'date', 'numbers', 'number', 'num', 'character', 'char', 'hanzi', 'text']
    .includes(String(opts.method || '').toLowerCase());
}

function buildCastingRequest(method: string | undefined, values: string[], opts: any): any {
  const normalizedMethod = method || inferCastingMethod(values, opts);
  const body: any = {
    casting: {
      method: normalizedMethod,
    },
  };
  if (opts.datetime) body.datetime = opts.datetime;
  if (opts.timezone) body.timezone = opts.timezone;

  const methodKey = String(normalizedMethod || 'manual').toLowerCase();
  if (['numbers', 'number', 'num'].includes(methodKey)) {
    const raw = opts.numbers ?? values;
    body.casting.numbers = parseNumberList(raw, 3, 'numbers casting requires exactly 3 numbers');
  } else if (['character', 'char', 'hanzi', 'text'].includes(methodKey)) {
    body.casting.character = opts.char ?? values[0];
    if (!body.casting.character) throw new Error('character casting requires --char <汉字> or one positional value');
  } else if (['manual', 'input', 'direct'].includes(methodKey)) {
    if (opts.yao) body.casting.yaoValues = parseSixYao(values);
    else body.casting.bits = parseSixBits(values);
  } else if (['coins', 'coin', 'auto', 'random', 'time', 'datetime', 'date'].includes(methodKey)) {
    // No extra CLI input is required for random coins or time casting.
  } else {
    throw new Error(`unknown casting method "${normalizedMethod}"`);
  }
  return body;
}

function inferCastingMethod(values: string[], opts: any): string {
  if (opts.numbers) return 'numbers';
  if (opts.char) return 'character';
  if (values.length > 0) return 'manual';
  return 'coins';
}

function parseNumberList(values: unknown, expected: number, errorMessage: string): number[] {
  const raw = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(/[,\s]+/).filter(Boolean)
      : [];
  if (raw.length !== expected) throw new Error(errorMessage);
  const ns = raw.map((v) => Number(v));
  if (ns.some((n) => !Number.isFinite(n))) throw new Error('numbers must be finite');
  return ns.map((n) => Math.trunc(n));
}

function renderCastingSummary(data: any): void {
  const casting = data.cast ? data : data.casting ?? data;
  console.log(chalk.green('✓ Casting normalized.'));
  console.log(`  method:     ${chalk.cyan(casting.method)}`);
  console.log(`  yaoValues:  ${chalk.cyan((casting.yaoValues || []).join(' '))}`);
  console.log(`  moving:     ${chalk.cyan((casting.movingLines || []).length ? casting.movingLines.join(',') : 'none')}`);
  if (casting.meta) {
    const meta = casting.meta;
    if (meta.rule) console.log(`  rule:       ${chalk.gray(meta.rule)}`);
    if (meta.upperTrigram || meta.lowerTrigram) {
      console.log(`  trigrams:   ${chalk.cyan(`${meta.upperTrigram}上 / ${meta.lowerTrigram}下`)}  ${chalk.gray(`动爻=${meta.movingLine}`)}`);
    }
    if (Array.isArray(meta.throws)) {
      console.log(`  throws:     ${meta.throws.map((t: string[]) => t.join('')).join(' / ')}`);
    }
    if (meta.character) {
      console.log(`  character:  ${chalk.cyan(meta.character)}  ${chalk.gray(`basis=${meta.basis} (${meta.basisSource})`)}`);
    }
  }
}

function formatCastingOneLine(casting: any): string {
  const parts = [
    casting.method,
    Array.isArray(casting.yaoValues) ? casting.yaoValues.join(' ') : '',
  ].filter(Boolean);
  if (casting.meta?.upperTrigram || casting.meta?.lowerTrigram) {
    parts.push(`${casting.meta.upperTrigram}上/${casting.meta.lowerTrigram}下`);
  }
  return parts.join(' · ');
}

export function renderDivinationReading(data: any): void {
  const chart = data.chart || data || {};
  console.log(chalk.green('✓ Full divination flow completed.'));
  console.log(`  sessionId: ${chalk.cyan(data.sessionId ?? chart.sessionId ?? '?')}`);
  if (data.chartKey) console.log(`  chartKey:   ${chalk.cyan(data.chartKey)}`);
  if (data.message) console.log(`  prompt:     ${chalk.gray(data.message)}`);
  if (data.casting) {
    console.log(`  casting:    ${chalk.cyan(formatCastingOneLine(data.casting))}`);
  }
  if (data.thinking) {
    console.log(`  thinking:   ${chalk.cyan(`on (${data.angles || 3} angles)`)}`);
  }
  if (chart.time?.yearStem) {
    console.log(`  ${chalk.gray('time:')}      ${chalk.cyan(`${chart.time.yearStem}${chart.time.yearBranch}年 / ${chart.time.monthStem}${chart.time.monthBranch}月 / ${chart.time.dayStem}${chart.time.dayBranch}日 / ${chart.time.hourStem}${chart.time.hourBranch}时`)}`);
  }
  console.log(`  palace:    ${chalk.cyan(`${chart.originalHexagram?.palace ?? '?'}宫 · ${chart.originalHexagram?.palaceType ?? '?'} · ${chart.originalHexagram?.element ?? '?'}`)}`);
  console.log(`  moving:    ${chalk.cyan((chart.movingLines || []).length ? chart.movingLines.join(',') : 'none')}`);
  console.log();
  console.log(`  ${chalk.bold('本卦')} ${chart.originalHexagram?.fullName ?? chart.originalHexagram?.name ?? '?'}` +
              `     ${chalk.bold('变卦')} ${chalk.cyan(chart.changedHexagram?.fullName ?? chart.changedHexagram?.name ?? '?')}`);
  renderHexagramPair(chart);
  renderLineDetails(chart);
}

export function renderLineDetails(data: any): void {
  if (!Array.isArray(data?.lines)) return;
  const hasMoving = Array.isArray(data.movingLines) && data.movingLines.length > 0;
  console.log();
  console.log(chalk.gray(hasMoving
    ? '  Lines (初爻→上爻: 纳甲/五行 六亲 六神 | 变爻纳甲/六亲):'
    : '  Lines (初爻→上爻: 纳甲/五行 六亲 六神):'));
  for (const l of data.lines) {
    const voidMark = l.void ? ' [旬空]' : '';
    const movingMark = l.moving ? chalk.yellow(' 动') : '';
    const shiYing = [
      l.isShi ? chalk.red.bold('世') : '',
      l.isYing ? chalk.magenta.bold('应') : '',
    ].filter(Boolean).join('/');
    const marker = shiYing ? ` ${shiYing}` : '';
    const original = `${formatStemBranchElement(l.stem, l.branch, l.element)} ${l.sixRelative} 临${l.sixGod}${voidMark}${movingMark}${marker}`;
    if (hasMoving) {
      const changed = l.changedSixRelative
        ? `${formatStemBranchElement(l.changedStem, l.changedBranch, l.changedElement)} ${l.changedSixRelative}`
        : chalk.gray('—');
      console.log(chalk.gray(`    ${l.position}: ${original}`) + chalk.reset(`  |  变: ${changed}`));
    } else {
      console.log(chalk.gray(`    ${l.position}: ${original}`));
    }
  }
}

function formatStemBranchElement(stem: unknown, branch: unknown, element: unknown): string {
  const sb = `${stem ?? ''}${branch ?? ''}`.trim() || '?';
  return element ? `${sb}(${element})` : sb;
}

/** Render the 6 lines of a hexagram (top-to-bottom, traditional order).
 *  Yin = `----  ----` (broken line), yang = `----------` (solid line).
 *  Moving lines are highlighted in yellow. 世/应 lines get a
 *  distinctive bold treatment so they stand out from regular lines
 *  and from each other. */
function renderLine(
  yinYang: '阴' | '阳',
  moving: boolean,
  isChangedMoving: boolean,
  isShi: boolean,
  isYing: boolean,
  position: number,
): string {
  // Use a fixed-width line so the two hexagrams align side-by-side.
  // Yang: ━━━━━━━━  Yin: ━━━━ ━━━━
  const line = yinYang === '阳' ? '━━━━━━━━━━' : '━━━━  ━━━━';
  // Priority order:
  //   1. 世爻 → bold red (most important line in the chart)
  //   2. 应爻 → bold magenta (secondary marker)
  //   3. 动爻 (本卦) → yellow (overrides 世/应 if both apply — but in
  //      practice 世/应 are rarely also moving, so this is rare)
  //   4. 动爻 (变卦翻转) → cyan
  //   5. 普通 → gray
  if (isShi && isYing) {
    // 世=应 happens for very few cases; fall back to red.
    return chalk.red.bold(line);
  }
  if (isShi) {
    return chalk.red.bold(line);
  }
  if (isYing) {
    return chalk.magenta.bold(line);
  }
  if (moving) {
    return chalk.yellow(line);
  }
  if (isChangedMoving) {
    return chalk.cyan(line);
  }
  return chalk.gray(line);
}

/** Render the 本卦 and 变卦 side-by-side. Top line is 上爻, bottom is 初爻.
 *
 *  世爻 = bold red    应爻 = bold magenta    动爻 = yellow
 *
 *  Each line label shows the position + (optional)【世】/【应】/动 tag.
 */
function renderHexagramPair(data: any): void {
  const lines = data.lines as any[];
  if (!Array.isArray(lines) || lines.length !== 6) return;

  const movingSet = new Set((data.movingLines as number[]) || []);

  for (let i = 5; i >= 0; i--) {
    const l = lines[i]!;
    const isMoving = movingSet.has(l.position);
    const leftLine = renderLine(l.yinYang, isMoving, false, l.isShi, l.isYing, l.position);
    const rightLine = renderLine(l.changedYinYang, false, isMoving, l.isShi, l.isYing, l.position);
    // Label: position + tag(s). Build them in priority order so the
    // most important marker is leftmost.
    const tags: string[] = [];
    if (l.isShi) tags.push(chalk.red.bold('【世】'));
    if (l.isYing) tags.push(chalk.magenta.bold('【应】'));
    if (isMoving) tags.push(chalk.yellow('动'));
    const tagsStr = tags.length ? '  ' + tags.join('') : '';
    const labelPrefix = isMoving || l.isShi || l.isYing
      ? chalk.bold(`第 ${l.position} 爻`)
      : chalk.gray(`第 ${l.position} 爻`);
    console.log(`  ${leftLine}    ${rightLine}   ${labelPrefix}${tagsStr}`);
  }

  // Legend so the color codes are unambiguous.
  const shiLine = data.lines.find((l: any) => l.isShi);
  const yingLine = data.lines.find((l: any) => l.isYing);
  if (shiLine || yingLine) {
    const parts: string[] = [];
    if (shiLine) parts.push(`${chalk.red.bold('━━━')} ${chalk.red.bold('世爻')} = 第 ${shiLine.position} 爻 (${shiLine.branch} ${shiLine.sixRelative})`);
    if (yingLine) parts.push(`${chalk.magenta.bold('━━━')} ${chalk.magenta.bold('应爻')} = 第 ${yingLine.position} 爻 (${yingLine.branch} ${yingLine.sixRelative})`);
    console.log(chalk.gray(`  ${parts.join('   ')}`));
  }
}
