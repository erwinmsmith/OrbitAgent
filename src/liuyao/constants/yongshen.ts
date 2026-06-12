/**
 * Yongshen (用神) rules. The table is deterministic so the charting
 * pipeline can choose a focus before the LLM starts interpreting.
 */
import type { QuestionType, SixRelative } from '../types/basic';

export type YongshenFocus = SixRelative | '世爻' | '应爻';

export interface YongshenRule {
  type: QuestionType;
  keywords: string[];
  primary: YongshenFocus[];
  auxiliary: YongshenFocus[];
  description: string;
}

export const YONGSHEN_CORE_RULES: Record<YongshenFocus, string> = {
  '父母': '文书、合同、证件、房屋、车辆、学习、长辈、保护、规则',
  '兄弟': '朋友、同辈、竞争者、合伙人、破财者',
  '子孙': '宠物、孩子、下属、快乐、作品、解忧、药物、技术产出',
  '妻财': '钱财、收入、资源、客户、货物、女方、现实利益',
  '官鬼': '工作、职位、压力、疾病、风险、男方、规则、灾祸、官司',
  '世爻': '自己',
  '应爻': '对方、目标、环境、外部回应',
};

export const YONGSHEN_RULES: YongshenRule[] = [
  {
    type: '求财收入',
    keywords: ['钱', '收入', '赚钱', '财运', '回款', '到账', '工资', '副业', '利润'],
    primary: ['妻财'],
    auxiliary: ['世爻', '兄弟', '子孙'],
    description: '妻财为钱；兄弟常为破财/竞争；子孙可生财',
  },
  {
    type: '投资交易',
    keywords: ['股票', '基金', '币', '投资', '买卖', '涨跌', '收益'],
    primary: ['妻财'],
    auxiliary: ['兄弟', '官鬼', '子孙'],
    description: '妻财看收益；兄弟看损耗；官鬼看风险',
  },
  {
    type: '生意订单',
    keywords: ['客户', '订单', '成交', '合作', '销售', '签单'],
    primary: ['妻财'],
    auxiliary: ['应爻', '父母', '官鬼'],
    description: '妻财看利润/客户资源；父母看合同；应爻看对方',
  },
  {
    type: '工作事业',
    keywords: ['工作', '事业', '岗位', 'offer', '职场', '跳槽'],
    primary: ['官鬼'],
    auxiliary: ['父母', '世爻', '应爻'],
    description: '官鬼为职位/事业压力；父母看合同文书',
  },
  {
    type: '升职考公',
    keywords: ['升职', '晋升', '编制', '公务员', '职称', '领导'],
    primary: ['官鬼'],
    auxiliary: ['父母', '世爻'],
    description: '官鬼为官职；父母为资格、文书、考试材料',
  },
  {
    type: '考试学习',
    keywords: ['考试', '考研', '论文', '成绩', '录取', '申请', '夏令营'],
    primary: ['父母'],
    auxiliary: ['官鬼', '世爻', '子孙'],
    description: '父母为文书学业；官鬼为名次/录取压力；子孙为发挥',
  },
  {
    type: '文书合同',
    keywords: ['合同', '协议', '证明', '材料', '签证', '申请表'],
    primary: ['父母'],
    auxiliary: ['官鬼', '应爻'],
    description: '父母主文书；官鬼看审查压力',
  },
  {
    type: '房屋住所',
    keywords: ['房子', '租房', '买房', '搬家', '宿舍', '办公室'],
    primary: ['父母'],
    auxiliary: ['世爻', '应爻', '妻财'],
    description: '父母为房屋；妻财看价格成本',
  },
  {
    type: '车辆交通',
    keywords: ['车', '买车', '车祸', '驾驶', '交通', '出行工具'],
    primary: ['父母'],
    auxiliary: ['官鬼', '世爻'],
    description: '父母可主车；官鬼看事故风险',
  },
  {
    type: '感情男问女',
    keywords: ['女朋友', '女生', '暧昧', '追女生', '老婆'],
    primary: ['妻财'],
    auxiliary: ['应爻', '世爻', '官鬼'],
    description: '男问女，妻财为女方',
  },
  {
    type: '感情女问男',
    keywords: ['男朋友', '男生', '老公', '追男生'],
    primary: ['官鬼'],
    auxiliary: ['应爻', '世爻', '妻财'],
    description: '女问男，官鬼为男方',
  },
  {
    type: '泛问关系',
    keywords: ['我和某人关系', '对方怎么看我', '会不会和好', '关系', '和好'],
    primary: ['应爻'],
    auxiliary: ['世爻'],
    description: '不明确身份时，应爻代表对方',
  },
  {
    type: '朋友同学',
    keywords: ['朋友', '同学', '室友', '同辈', '兄弟姐妹'],
    primary: ['兄弟'],
    auxiliary: ['应爻', '世爻'],
    description: '朋友/室友/同辈一般取兄弟',
  },
  {
    type: '合伙合作',
    keywords: ['合伙人', '合作伙伴', '团队', '一起做项目'],
    primary: ['兄弟'],
    auxiliary: ['妻财', '父母', '官鬼'],
    description: '兄弟看合伙人；妻财看利益；父母看协议',
  },
  {
    type: '竞争对手',
    keywords: ['竞争', '对手', '同行', '抢客户', '抢资源'],
    primary: ['兄弟'],
    auxiliary: ['妻财', '官鬼'],
    description: '兄弟常为竞争和分财之神',
  },
  {
    type: '宠物',
    keywords: ['猫', '狗', '宠物', '动物', '毛孩子'],
    primary: ['子孙'],
    auxiliary: ['世爻', '应爻', '父母'],
    description: '宠物一般取子孙；环境照顾看父母',
  },
  {
    type: '子女',
    keywords: ['孩子', '儿子', '女儿', '怀孕', '备孕', '生育'],
    primary: ['子孙'],
    auxiliary: ['父母', '官鬼', '世爻'],
    description: '子孙主子女；怀孕也要看子孙是否有气',
  },
  {
    type: '下属学生',
    keywords: ['下属', '学生', '徒弟', '员工表现'],
    primary: ['子孙'],
    auxiliary: ['官鬼', '父母'],
    description: '子孙可代表晚辈、下属、产出',
  },
  {
    type: '健康疾病',
    keywords: ['身体', '病', '疾病', '手术', '疼痛', '健康'],
    primary: ['官鬼'],
    auxiliary: ['子孙', '世爻', '父母'],
    description: '官鬼为病；子孙为药/解忧；世爻为自身',
  },
  {
    type: '医药治疗',
    keywords: ['药', '治疗', '医生', '手术', '康复'],
    primary: ['子孙'],
    auxiliary: ['官鬼', '父母'],
    description: '子孙为药和治疗效果；官鬼为病症',
  },
  {
    type: '官司纠纷',
    keywords: ['官司', '诉讼', '报警', '纠纷', '投诉', '仲裁'],
    primary: ['官鬼'],
    auxiliary: ['父母', '兄弟', '应爻'],
    description: '官鬼为官非；父母为证据文书',
  },
  {
    type: '风险灾祸',
    keywords: ['危险', '出事', '灾', '麻烦', '事故', '会不会有事'],
    primary: ['官鬼'],
    auxiliary: ['子孙', '世爻'],
    description: '官鬼为风险；子孙为化解',
  },
  {
    type: '失物寻找',
    keywords: ['东西丢了', '手机', '钥匙', '钱包', '找不到'],
    primary: ['妻财'],
    auxiliary: ['父母', '世爻', '应爻'],
    description: '一般物品取妻财；证件文书类取父母',
  },
  {
    type: '证件丢失',
    keywords: ['身份证', '护照', '毕业证', '合同', '文件丢了'],
    primary: ['父母'],
    auxiliary: ['妻财', '应爻'],
    description: '文书证件取父母',
  },
  {
    type: '出行旅行',
    keywords: ['出门', '旅行', '远行', '搬迁', '行程'],
    primary: ['父母'],
    auxiliary: ['世爻', '官鬼', '应爻'],
    description: '父母可看车票路线文书；官鬼看风险',
  },
  {
    type: '消息回复',
    keywords: ['消息', '微信', '邮件', '回复', '联系', '通知'],
    primary: ['父母'],
    auxiliary: ['应爻', '世爻'],
    description: '父母主信息文书；朱雀辅助看沟通',
  },
  {
    type: '项目产品',
    keywords: ['项目', '产品', '系统', '软件', '代码', '论文成果'],
    primary: ['子孙'],
    auxiliary: ['父母', '官鬼', '妻财'],
    description: '子孙主产出；父母看文档/代码结构；财看商业化',
  },
  {
    type: 'AI Agent/软件上线',
    keywords: ['agent', '系统', '上线', '部署', '产品发布'],
    primary: ['子孙'],
    auxiliary: ['父母', '官鬼', '妻财'],
    description: '子孙为作品产出；官鬼看 bug/压力；财看收益',
  },
  {
    type: '面试录用',
    keywords: ['面试', 'offer', '录用', '入职'],
    primary: ['官鬼'],
    auxiliary: ['父母', '应爻', '世爻'],
    description: '官鬼为职位；父母为 offer/文书',
  },
  {
    type: '领导老师',
    keywords: ['老师', '导师', '领导', '上级', '评审'],
    primary: ['父母', '官鬼'],
    auxiliary: ['应爻', '世爻'],
    description: '老师偏父母，领导/权力偏官鬼',
  },
  {
    type: '父母长辈',
    keywords: ['父亲', '母亲', '长辈', '家里老人'],
    primary: ['父母'],
    auxiliary: ['世爻', '官鬼'],
    description: '长辈取父母；健康另看官鬼',
  },
  {
    type: '兄弟姐妹',
    keywords: ['兄弟', '姐妹', '同辈亲戚'],
    primary: ['兄弟'],
    auxiliary: ['应爻'],
    description: '同辈亲属取兄弟',
  },
  {
    type: '名声口舌',
    keywords: ['名声', '舆论', '吵架', '口舌', '被骂'],
    primary: ['官鬼'],
    auxiliary: ['兄弟', '应爻'],
    description: '官鬼看是非压力；朱雀看口舌传播',
  },
  {
    type: '玄学问事泛问',
    keywords: ['这件事成不成', '结果如何', '对我好吗'],
    primary: ['世爻', '应爻'],
    auxiliary: [],
    description: '先看世应，再按事情类型补用神',
  },
];

const LEGACY_TYPE_MAP: Partial<Record<QuestionType, QuestionType>> = {
  '求财': '求财收入',
  '求事业': '工作事业',
  '求感情': '泛问关系',
  '求考试': '考试学习',
  '求合同': '文书合同',
  '求健康': '健康疾病',
  '求失物': '失物寻找',
  '求出行': '出行旅行',
  '求合作': '合伙合作',
  '求官司': '官司纠纷',
  '求宠物': '宠物',
  '其他': '玄学问事泛问',
};

export function normalizeQuestionType(questionType?: string): QuestionType {
  if (!questionType) return '玄学问事泛问';
  const trimmed = questionType.trim() as QuestionType;
  return LEGACY_TYPE_MAP[trimmed] ?? (
    YONGSHEN_RULES.some((rule) => rule.type === trimmed) ? trimmed : '玄学问事泛问'
  );
}

export function yongshenRuleFor(questionType?: string): YongshenRule {
  const normalized = normalizeQuestionType(questionType);
  return YONGSHEN_RULES.find((rule) => rule.type === normalized) ?? YONGSHEN_RULES[YONGSHEN_RULES.length - 1]!;
}

export const YONGSHEN_PRIMARY: Record<QuestionType, YongshenFocus> = Object.fromEntries(
  [
    ...YONGSHEN_RULES.map((rule) => [rule.type, rule.primary[0] ?? '应爻']),
    ...Object.entries(LEGACY_TYPE_MAP).map(([legacy, normalized]) => [legacy, yongshenRuleFor(normalized).primary[0] ?? '应爻']),
  ],
) as Record<QuestionType, YongshenFocus>;

export const YONGSHEN_AUXILIARY: Partial<Record<QuestionType, YongshenFocus>> = Object.fromEntries(
  [
    ...YONGSHEN_RULES.map((rule) => [rule.type, rule.auxiliary[0]]).filter(([, focus]) => focus),
    ...Object.entries(LEGACY_TYPE_MAP)
      .map(([legacy, normalized]) => [legacy, yongshenRuleFor(normalized).auxiliary[0]])
      .filter(([, focus]) => focus),
  ],
) as Partial<Record<QuestionType, YongshenFocus>>;

export function yongshenFor(question: QuestionType, _chart: unknown): YongshenFocus {
  return yongshenRuleFor(question).primary[0] ?? '应爻';
}
