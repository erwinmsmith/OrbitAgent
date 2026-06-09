export const UNINTELLIGIBLE_INPUT_GUARD = [
  '【输入可理解性规则】',
  '如果用户当前输入是乱码、随机字符、明显不成句、缺少可理解语义，或无法判断用户真正想问什么，',
  '无论当前卦象、历史对话、工具结果或知识库内容显示什么，都不要解卦、不要分析卦象、不要猜测用户意图。',
  '你必须直接要求用户重新输入一个正常、清楚、可理解的问题。',
  '推荐回复：请重新输入一个正常、清楚、可理解的问题，我再继续为你起卦或分析。',
  '这条规则适用于第一次起卦提问，也适用于后续多轮追问。',
].join('\n');

export function withUnintelligibleInputGuard(prompt: string): string {
  return `${prompt.trim()}\n\n${UNINTELLIGIBLE_INPUT_GUARD}`;
}
