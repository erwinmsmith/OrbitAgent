/**
 * Basic enums for the six-yang (六爻) domain. These come straight out of
 * `docs/base_knowledge/装卦方法.md` and are the only types the engine
 * needs to know about.
 *
 * The actual *data* (full 64-gua table, palace→world-line positions, etc.)
 * lives in src/liuyao/constants/*.ts and may be incomplete — see
 * docs/liuyao/KNOWLEDGE_NEEDED.md for what still needs to be sourced.
 */

/** Heavenly Stems (天干), 10. */
export type HeavenlyStem = '甲' | '乙' | '丙' | '丁' | '戊' | '己' | '庚' | '辛' | '壬' | '癸';

/** Earthly Branches (地支), 12. */
export type EarthlyBranch =
  | '子' | '丑' | '寅' | '卯' | '辰' | '巳'
  | '午' | '未' | '申' | '酉' | '戌' | '亥';

/** Five elements (五行). */
export type WuXing = '金' | '水' | '木' | '火' | '土';

/** The eight trigrams (八卦). */
export type Trigram = '乾' | '坤' | '震' | '巽' | '坎' | '离' | '艮' | '兑';

/** Six gods (六神) — placement depends on the day stem. */
export type SixGod = '青龙' | '朱雀' | '勾陈' | '螣蛇' | '白虎' | '玄武';

/** Six relatives (六亲) — depends on the palace element vs line element. */
export type SixRelative = '父母' | '子孙' | '官鬼' | '妻财' | '兄弟';

/** Eight palaces (八宫), one per trigram. */
export type Palace = '乾宫' | '坎宫' | '艮宫' | '震宫' | '巽宫' | '离宫' | '坤宫' | '兑宫';

/** Palace position type (本宫, 一世, 二世, ..., 游魂, 归魂). */
export type PalaceType = '本宫' | '一世' | '二世' | '三世' | '四世' | '五世' | '游魂' | '归魂';

/** Yin/Yang. */
export type YinYang = '阴' | '阳';

/** Line position 1 (初爻, bottom) through 6 (上爻, top). */
export type LinePosition = 1 | 2 | 3 | 4 | 5 | 6;

/** Raw coin value after three coins have been summed. */
export type YaoValue = 6 | 7 | 8 | 9;

/** Binary yin/yang marker (0 = 阴, 1 = 阳). */
export type YinYangBit = 0 | 1;

/** Question type used for yongshen (用神) selection. */
export type QuestionType =
  | '求财收入' | '投资交易' | '生意订单'
  | '工作事业' | '升职考公' | '考试学习'
  | '文书合同' | '房屋住所' | '车辆交通'
  | '感情男问女' | '感情女问男' | '泛问关系'
  | '朋友同学' | '合伙合作' | '竞争对手'
  | '宠物' | '子女' | '下属学生'
  | '健康疾病' | '医药治疗'
  | '官司纠纷' | '风险灾祸'
  | '失物寻找' | '证件丢失' | '出行旅行' | '消息回复'
  | '项目产品' | 'AI Agent/软件上线'
  | '面试录用' | '领导老师' | '父母长辈' | '兄弟姐妹' | '名声口舌'
  | '玄学问事泛问'
  // Legacy aliases kept for CLI/API compatibility.
  | '求财' | '求事业' | '求感情' | '求考试' | '求合同'
  | '求健康' | '求失物' | '求出行' | '求合作' | '求官司'
  | '求宠物' | '其他';

/** Branch relation types. */
export type BranchRelationType = '冲' | '合' | '刑' | '害' | '破' | '三合' | '半三合';
