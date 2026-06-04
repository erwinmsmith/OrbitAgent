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
    .option('--yao', 'Interpret the 6 positional args as 6/7/8/9 爻值 (with moving lines) instead of 0/1 bits.', false)
    .action(async (bits: string[] | undefined, opts) => {
      bits = bits ?? [];
      if (bits.length === 0) {
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
      if (opts.yao) {
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
        // Line decorations (branch, sixRelative, sixGod). Show both
        // 本卦 and 变卦 columns for clarity when a chart has moving
        // lines. The 变卦's sixGod is intentionally the same as the
        // 本卦's (六神 only depends on day stem), so we only print
        // it once per line.
        if (Array.isArray(data.lines)) {
          const hasMoving = Array.isArray(data.movingLines) && data.movingLines.length > 0;
          if (hasMoving) {
            console.log();
            console.log(chalk.gray('  Lines (pos: branch sixRelative sixGod | 变 branch 变 sixRel):'));
            for (const l of data.lines) {
              const voidMark = l.void ? ' [旬空]' : '';
              const movingMark = l.moving ? chalk.yellow(' 动') : '';
              const changedRel = l.changedSixRelative
                ? `${l.changedBranch} ${l.changedSixRelative}`
                : chalk.gray('—');
              console.log(chalk.gray(
                `    ${l.position}: ${l.branch} ${l.sixRelative} 临${l.sixGod}${voidMark}${movingMark}` +
                chalk.reset(`  |  变: ${changedRel}`),
              ));
            }
          } else {
            console.log();
            console.log(chalk.gray('  Lines (pos: branch sixRelative sixGod):'));
            for (const l of data.lines) {
              console.log(chalk.gray(`    ${l.position}: ${l.branch} ${l.sixRelative} 临${l.sixGod}${l.void ? ' [旬空]' : ''}`));
            }
          }
        }
        console.log();
        console.log(chalk.gray(`Next: orbit chat --session ${sessionId} "帮我分析"`));
        console.log(chalk.gray(`Or:   orbit divination analyze <chart.json>  (for a stand-alone report)`));
      } catch (err: any) { console.error(chalk.red(`✗ ${err.message}`)); process.exit(1); }
    });

  cmd.command('analyze <file>')
    .description('Run the analysis agent on a chart read from a JSON file (e.g. one produced by `chart`). Pass --debug to see the full multi-stage pipeline timeline.')
    .option('--debug', 'Show the full pipeline timeline: build brief → LLM #1 understand → RAG retrieve → LLM #2 synthesize')
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
        const data = await apiPost<any>('/divination/analyze', { chart, debug: !!opts.debug });
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

  console.log(titleSep);
  console.log(chalk.gray(`总耗时: ${debug.totalDurationMs ?? 0}ms`));
}

function stageDisplayName(stage: string): string {
  switch (stage) {
    case 'build-brief':    return '①  构建 ChartBrief';
    case 'understand':     return '②  LLM #1 — 理解';
    case 'rag-retrieve':   return '③  RAG 召回';
    case 'synthesize':     return '④  LLM #2 — 综合分析';
    default:                return stage;
  }
}

function stageDetail(step: { stage: string; meta: Record<string, unknown> }): string {
  const m = step.meta || {};
  switch (step.stage) {
    case 'build-brief':
      return `lines=${m.lineCount ?? '?'}`;
    case 'understand': {
      const u = m.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const tokens = u ? `in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0}` : '';
      const model = m.model ? `${m.model}` : '';
      return `${model} ${tokens}`.trim();
    }
    case 'rag-retrieve':
      return `queries=${m.queryCount ?? 0} hits=${m.totalHitCount ?? 0} deduped=${m.dedupedCount ?? 0}`;
    case 'synthesize': {
      const u = m.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const tokens = u ? `in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0}` : '';
      const len = m.contentLength ? `${m.contentLength}chars` : '';
      return `${m.model ?? '?'} ${tokens} ${len}`.trim();
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
