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
import { postDivinationAsk } from './divination';

const DEFAULT_PROMPT = '请结合卦象分析、解答问题';

export function registerLiuyaoApp(program: Command): void {
  program
    .command('liuyao')
    .description('Start the interactive 六爻 CLI app (complete cast → chart → RAG analysis flow)')
    .option('--thinking', 'Enable thinking mode for every reading in this app session', false)
    .option('--angles <n>', 'Number of thinking angles, clamped by the server to 1–5', (v) => parseInt(v, 10))
    .option('--timezone <tz>', 'Timezone passed to the calendar skill', 'Asia/Shanghai')
    .action(async (opts) => {
      printLogo();
      console.log(chalk.gray('输入问题和 6 个爻值，即可完成：起卦 → 排盘 → RAG 解卦 → 可继续追问的 session。'));
      console.log(chalk.gray('爻值顺序：初爻到上爻，自下而上。支持 6/7/8/9；也支持 0/1 静卦。输入 /exit 退出。'));
      console.log();

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

      try {
        while (true) {
          const question = (await ask(chalk.cyan('问题 > '))).trim();
          if (isExit(question)) break;
          if (!question) continue;

          const rawValues = (await ask(chalk.cyan('六爻 > '))).trim();
          if (isExit(rawValues)) break;
          const parsed = parseLineValues(rawValues);
          if (!parsed) {
            console.log(chalk.red('请输入 6 个数字，例如：7 8 7 9 7 8 或 1 1 1 1 1 1'));
            continue;
          }

          const sessionId = `sess_cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const body: any = {
            sessionId,
            question,
            message: DEFAULT_PROMPT,
            timezone: opts.timezone,
            datetime: new Date().toISOString(),
            debug: false,
          };
          if (parsed.kind === 'bits') body.bits = parsed.values;
          else body.yaoValues = parsed.values;
          if (opts.thinking) body.thinking = true;
          if (Number.isFinite(opts.angles)) body.angles = opts.angles;

          console.log(chalk.gray('\n正在排盘并调用六爻 Agent...\n'));
          try {
            const data = await postDivinationAsk(body);
            if (data._fallback) {
              console.log(chalk.yellow('⚠ 当前后端还没有 /divination/ask，已自动使用 chart → chat 兼容流程。重启 npm run dev 后会走新 API。'));
              console.log();
            }
            printReadingSummary(data);
            console.log(data.content || '(no analysis content)');
            console.log(chalk.gray(`\n继续追问：orbit chat --session ${data.sessionId} "你的追问"`));
            console.log(chalk.gray('本应用内可继续输入新的问题重新起卦。\n'));
          } catch (err: any) {
            console.log(chalk.red(`✗ ${err.message}`));
          }
        }
      } finally {
        rl.close();
      }
    });
}

function printLogo(): void {
  const coin = chalk.yellow.bold('◯');
  const hole = chalk.gray('□');
  console.log(chalk.bold(`
 ${coin} ${coin} ${coin}
${chalk.yellow('╭─────╮ ╭─────╮ ╭─────╮')}
${chalk.yellow('│')}  ${hole}  ${chalk.yellow('│ │')}  ${hole}  ${chalk.yellow('│ │')}  ${hole}  ${chalk.yellow('│')}
${chalk.yellow('╰─────╯ ╰─────╯ ╰─────╯')}
 Orbit Liuyao
`));
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
  const chart = data.chart || {};
  console.log(chalk.green('✓ 解卦完成'));
  console.log(`sessionId: ${chalk.cyan(data.sessionId)}`);
  console.log(`本卦: ${chalk.cyan(chart.originalHexagram?.fullName ?? chart.originalHexagram?.name ?? '?')}`);
  console.log(`变卦: ${chalk.cyan(chart.changedHexagram?.fullName ?? chart.changedHexagram?.name ?? '?')}`);
  console.log(`动爻: ${chalk.cyan((chart.movingLines || []).length ? chart.movingLines.join('、') : '无')}`);
  if (data.thinking) console.log(`thinking: ${chalk.cyan(`on (${data.angles || 3} angles)`)}`);
  console.log();
}
