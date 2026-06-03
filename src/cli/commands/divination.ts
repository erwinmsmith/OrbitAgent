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
 */
import { Command } from 'commander';
import fs from 'fs';
import chalk from 'chalk';
import { apiPost, apiGet } from '../http';

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
    .description('Run the full chart assembler. Optional --question / --question-type / --day-stem / --day-branch / --month-branch.')
    .option('-q, --question <q>', 'Question text (used for 用神 + analysis)')
    .option('--question-type <t>', 'Override question type (e.g. 求财, 求事业)')
    .option('--day-stem <s>', '日干 (e.g. 甲) — needed for 六神 + 旬空')
    .option('--day-branch <b>', '日支 (e.g. 子) — needed for 旬空 + 冲合')
    .option('--month-branch <b>', '月支 (e.g. 寅) — needed for 月破 + 旺衰')
    .action(async (bits: string[], opts) => {
      const arr = parseSixBits(bits);
      const body: any = { bits: arr };
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
        console.log(JSON.stringify(data, null, 2));
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
    out[i] = v as any;
  }
  return out;
}
