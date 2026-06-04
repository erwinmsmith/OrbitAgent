/**
 * `orbit divination ...` — client for /api/v1/divination/*.
 *
 * Subcommands:
 *   cast <b1>..<b6>           — six raw bits (0|1) → CastResult
 *   chart <b1>..<b6> [--question Q] [--day-stem 甲] [--day-branch 子] ...
 *                                — full ChartResult
 *   analyze <chart.json>       — run the analysis agent on a chart
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

  cmd.command('chart <bits...>')
    .description('Run the full chart assembler AND persist it to the session store. --session is REQUIRED so the agent can read it back later. By default the positional args are 6 × 0/1 (static yin/yang). Pass --yao to switch to 6 × 6/7/8/9 (supports moving lines 6 and 9).')
    .option('-q, --question <q>', 'Question text (used for 用神 + analysis)')
    .option('--question-type <t>', 'Override question type (e.g. 求财, 求事业)')
    .option('--day-stem <s>', '日干 (e.g. 甲) — needed for 六神 + 旬空')
    .option('--day-branch <b>', '日支 (e.g. 子) — needed for 旬空 + 冲合')
    .option('--month-branch <b>', '月支 (e.g. 寅) — needed for 月破 + 旺衰')
    .option('-s, --session <id>', 'Session id under which to store the chart (auto-generated if omitted; pass the same value to `orbit chat` later)')
    .option('--chart-key <k>', 'Logical name for this chart within the session (default: "default")', 'default')
    .option('--yao', 'Interpret the 6 positional args as 6/7/8/9 爻值 (with moving lines) instead of 0/1 bits.', false)
    .action(async (bits: string[], opts) => {
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
      try {
        const data = await apiPost<any>('/divination/chart', body);
        // Print the warnings prominently if present.
        if (data.warnings?.length) {
          console.log(chalk.yellow(`⚠ warnings:`));
          for (const w of data.warnings) console.log(chalk.yellow(`  - ${w}`));
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
        // Line decorations (branch, sixRelative, sixGod).
        if (Array.isArray(data.lines)) {
          console.log();
          console.log(chalk.gray('  Lines (pos: branch sixRelative sixGod):'));
          for (const l of data.lines) {
            console.log(chalk.gray(`    ${l.position}: ${l.branch} ${l.sixRelative} 临${l.sixGod}${l.void ? ' [旬空]' : ''}`));
          }
        }
        console.log();
        console.log(chalk.gray(`Next: orbit chat --session ${sessionId} "帮我分析"`));
        console.log(chalk.gray(`Or:   orbit divination analyze <chart.json>  (for a stand-alone report)`));
      } catch (err: any) { console.error(chalk.red(`✗ ${err.message}`)); process.exit(1); }
    });

  cmd.command('analyze <file>')
    .description('Run the analysis agent on a chart read from a JSON file (e.g. one produced by `chart`)')
    .action(async (file: string) => {
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
        const report = await apiPost<any>('/divination/analyze', { chart });
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
      } catch (err: any) { console.error(chalk.red(`✗ ${err.message}`)); process.exit(1); }
    });

  // ─── RAG ────────────────────────────────────────────────────────────
  const rag = new Command('rag').description('RAG knowledge-base commands');
  rag.command('stats')
    .description('Show RAG index stats')
    .action(async () => {
      const data = await apiGet<any>('/divination/rag/stats');
      console.log(`chunks: ${data.chunkCount}`);
      console.log(`sources: ${data.sourceCount}`);
      for (const s of data.sources) console.log(`  - ${s}`);
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
        console.log(`${chalk.cyan(r.source)} — ${chalk.bold(r.title)} (${r.score.toFixed(3)})`);
        const snippet = r.text.length > 200 ? r.text.slice(0, 200) + '…' : r.text;
        console.log(chalk.gray(`  ${snippet}`));
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
      const { chunkCount, sourceCount, sources, byScope } = data;
      console.log(`chunks: ${chalk.cyan(chunkCount)}   sources: ${chalk.cyan(sourceCount)}`);
      if (byScope) {
        console.log(`  system: ${byScope.system ?? 0}    user: ${byScope.user ?? 0}`);
      }
      console.log();
      for (const s of sources) console.log(`  - ${s}`);
    });

  rag.command('delete <source>')
    .description('Delete a document from the RAG index. You can delete your own user-scope uploads; admins can delete any source.')
    .action(async (source: string) => {
      try {
        await apiDelete(`/divination/rag/${encodeURIComponent(source)}`);
        console.log(chalk.green(`✓ deleted ${source}`));
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`));
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
 *  Moving lines are highlighted + marked with `→ 变爻` in the changed
 *  hex on the right. */
function renderLine(yinYang: '阴' | '阳', moving: boolean, isChangedMoving: boolean): string {
  // Use a fixed-width line so the two hexagrams align side-by-side.
  // Yang: ━━━━━━━━  Yin: ━━━━ ━━━━
  const line = yinYang === '阳' ? '━━━━━━━━━━' : '━━━━  ━━━━';
  if (moving && isChangedMoving) {
    return chalk.yellow.bold(line);
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
 *  Format (each line is 1 row, two hexagrams separated by `│`):
 *      本卦 (left, with moving marks)               │  变卦 (right, with changed-line marks)
 *      ━━━━━━━━━━                                    │  ━━━━━━━━━━
 *      ━━━━━━━━━━                                    │  ━━━━  ━━━━     ← 动爻翻转
 *      ...
 */
function renderHexagramPair(data: any): void {
  const lines = data.lines as any[];
  if (!Array.isArray(lines) || lines.length !== 6) return;

  // 本卦 = data.lines[i].yinYang (the original cast)
  // 变卦 = data.lines[i].changedYinYang (after flipping moving lines)
  // Display top-to-bottom: position 6 first.
  const movingSet = new Set((data.movingLines as number[]) || []);

  for (let i = 5; i >= 0; i--) {
    const l = lines[i]!;
    const isMoving = movingSet.has(l.position);
    const leftLine = renderLine(l.yinYang, isMoving, false);
    const rightLine = renderLine(l.changedYinYang, false, isMoving);
    const label = isMoving ? chalk.yellow(`第 ${l.position} 爻 ${chalk.reset('动')}`) : chalk.gray(`第 ${l.position} 爻`);
    // Two hexagrams side-by-side, 11-char wide each + a 3-char gap.
    console.log(`  ${leftLine}    ${rightLine}   ${label}`);
  }
}
