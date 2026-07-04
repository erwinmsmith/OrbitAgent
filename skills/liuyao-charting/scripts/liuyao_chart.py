#!/usr/bin/env python3
"""
Standalone Liuyao chart builder.

This script is bundled with the liuyao-charting skill and intentionally does
not import OrbitAgent or any third-party package. It ports the deterministic
charting rules used by OrbitAgent: casting, hexagram lookup, palace/shi-ying,
NaJia, six relatives, six gods, xunkong, branch relations, strength tags,
transformations, twelve stages, fushen, and basic yongshen selection.
"""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
HEXAGRAM_DATA = ROOT / "data" / "64gua.json"

LINE_POSITIONS = [1, 2, 3, 4, 5, 6]
STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]

TRIGRAM_ELEMENT = {
    "乾": "金", "兑": "金", "坎": "水", "震": "木",
    "巽": "木", "离": "火", "艮": "土", "坤": "土",
}

TRIGRAM_BITS = {
    "乾": [1, 1, 1],
    "兑": [1, 1, 0],
    "离": [1, 0, 1],
    "震": [1, 0, 0],
    "巽": [0, 1, 1],
    "坎": [0, 1, 0],
    "艮": [0, 0, 1],
    "坤": [0, 0, 0],
}
BITS_TO_TRIGRAM = {"".join(map(str, v)): k for k, v in TRIGRAM_BITS.items()}

XIANTIAN_TRIGRAM_BY_NUMBER = {
    1: "乾", 2: "兑", 3: "离", 4: "震",
    5: "巽", 6: "坎", 7: "艮", 8: "坤",
}

PALACE_OF_TRIGRAM = {
    "乾": "乾宫", "坎": "坎宫", "艮": "艮宫", "震": "震宫",
    "巽": "巽宫", "离": "离宫", "坤": "坤宫", "兑": "兑宫",
}
PALACE_TYPE_BY_INDEX = ["本宫", "一世", "二世", "三世", "四世", "五世", "游魂", "归魂"]
SHI_BY_TYPE = {"本宫": 6, "一世": 1, "二世": 2, "三世": 3, "四世": 4, "五世": 5, "游魂": 4, "归魂": 3}

BRANCH_ELEMENT = {
    "子": "水", "亥": "水",
    "寅": "木", "卯": "木",
    "巳": "火", "午": "火",
    "申": "金", "酉": "金",
    "辰": "土", "戌": "土", "丑": "土", "未": "土",
}

BRANCH_CLASH = {
    "子": "午", "午": "子", "丑": "未", "未": "丑",
    "寅": "申", "申": "寅", "卯": "酉", "酉": "卯",
    "辰": "戌", "戌": "辰", "巳": "亥", "亥": "巳",
}
BRANCH_COMBINE = {
    "子": "丑", "丑": "子", "寅": "亥", "亥": "寅",
    "卯": "戌", "戌": "卯", "辰": "酉", "酉": "辰",
    "巳": "申", "申": "巳", "午": "未", "未": "午",
}
BRANCH_SAN_HE_GROUPS = [
    {"branches": ["寅", "午", "戌"], "element": "火"},
    {"branches": ["亥", "卯", "未"], "element": "木"},
    {"branches": ["申", "子", "辰"], "element": "水"},
    {"branches": ["巳", "酉", "丑"], "element": "金"},
]

WUXING_SHENG = {"金": "水", "水": "木", "木": "火", "火": "土", "土": "金"}
WUXING_KE = {"金": "木", "木": "土", "土": "水", "水": "火", "火": "金"}

INNER_BRANCHES = {
    "乾": ["子", "寅", "辰"], "坎": ["寅", "辰", "午"],
    "艮": ["辰", "午", "申"], "震": ["子", "寅", "辰"],
    "巽": ["丑", "亥", "酉"], "离": ["卯", "丑", "亥"],
    "兑": ["巳", "卯", "丑"], "坤": ["未", "巳", "卯"],
}
OUTER_BRANCHES = {
    "乾": ["午", "申", "戌"], "坎": ["申", "戌", "子"],
    "艮": ["戌", "子", "寅"], "震": ["午", "申", "戌"],
    "巽": ["未", "巳", "卯"], "离": ["酉", "未", "巳"],
    "兑": ["亥", "酉", "未"], "坤": ["丑", "亥", "酉"],
}
INNER_STEM = {"乾": "甲", "坎": "戊", "艮": "丙", "震": "庚", "巽": "辛", "离": "己", "兑": "丁", "坤": "乙"}
OUTER_STEM = {"乾": "壬", "坎": "戊", "艮": "丙", "震": "庚", "巽": "辛", "离": "己", "兑": "丁", "坤": "癸"}

SIX_GOD_SEQUENCE = ["青龙", "朱雀", "勾陈", "螣蛇", "白虎", "玄武"]
DAY_STEM_START_GOD = {
    "甲": "青龙", "乙": "青龙", "丙": "朱雀", "丁": "朱雀",
    "戊": "勾陈", "己": "螣蛇", "庚": "白虎", "辛": "白虎",
    "壬": "玄武", "癸": "玄武",
}
XUNKONG_BY_DAY_STEM = {
    "甲": ["戌", "亥"], "己": ["戌", "亥"],
    "乙": ["申", "酉"], "庚": ["申", "酉"],
    "丙": ["午", "未"], "辛": ["午", "未"],
    "丁": ["辰", "巳"], "壬": ["辰", "巳"],
    "戊": ["寅", "卯"], "癸": ["寅", "卯"],
}

MONTH_STRENGTH_SCORE = {"旺": 3, "相": 2, "休": 0, "囚": -1, "死": -2}
RELATION_STRENGTH_SCORE = {
    "得月生": 2, "得月扶": 2, "被月克": -2,
    "得日生": 1, "得日扶": 1, "被日克": -1,
    "月破": -3, "日破": -2, "旬空": -1,
}

TWELVE_STAGE_BY_GROUP = {
    "金": {
        "子": "死", "丑": "墓", "寅": "绝", "卯": "胎", "辰": "养", "巳": "长生",
        "午": "沐浴", "未": "冠带", "申": "临官", "酉": "帝旺", "戌": "衰", "亥": "病",
    },
    "木": {
        "子": "沐浴", "丑": "冠带", "寅": "临官", "卯": "帝旺", "辰": "衰", "巳": "病",
        "午": "死", "未": "墓", "申": "绝", "酉": "胎", "戌": "养", "亥": "长生",
    },
    "水土": {
        "子": "帝旺", "丑": "衰", "寅": "病", "卯": "死", "辰": "墓", "巳": "绝",
        "午": "胎", "未": "养", "申": "长生", "酉": "沐浴", "戌": "冠带", "亥": "临官",
    },
    "火": {
        "子": "胎", "丑": "养", "寅": "长生", "卯": "沐浴", "辰": "冠带", "巳": "临官",
        "午": "帝旺", "未": "衰", "申": "病", "酉": "死", "戌": "墓", "亥": "绝",
    },
}
TWELVE_STAGE_CORE = {"长生", "帝旺", "墓", "绝"}

COMMON_MODERN_STROKES = {
    "财": 7, "財": 10, "易": 8, "卦": 8, "问": 6, "問": 11, "事": 8,
    "官": 8, "讼": 6, "訟": 11, "婚": 11, "姻": 9, "感": 13, "情": 11,
    "业": 5, "業": 13, "合": 6, "同": 6, "病": 10, "钱": 10, "錢": 16,
    "人": 2, "我": 7, "他": 5, "她": 6, "家": 10, "子": 3, "父": 4,
    "母": 5, "兄": 5, "弟": 7, "夫": 4, "妻": 8, "求": 7, "成": 6,
    "去": 5, "来": 7, "來": 8, "行": 6, "出": 5, "失": 5, "物": 8,
}

FUSHEN_RULES = [
    {"bits": "011111", "relative": "妻财", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "001111", "relative": "妻财", "position": 2, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "001111", "relative": "子孙", "position": 1, "classicalName": "伏神入墓于飞爻"},
    {"bits": "000111", "relative": "子孙", "position": 1, "classicalName": "飞来克伏"},
    {"bits": "000011", "relative": "兄弟", "position": 5, "classicalName": "伏下长生遇引即出"},
    {"bits": "000011", "relative": "子孙", "position": 1, "classicalName": "飞来克伏"},
    {"bits": "000001", "relative": "兄弟", "position": 5, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "000101", "relative": "子孙", "position": 1, "classicalName": "飞来克伏"},
    {"bits": "001110", "relative": "妻财", "position": 2, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "001010", "relative": "妻财", "position": 2, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "001000", "relative": "妻财", "position": 2, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "001100", "relative": "妻财", "position": 2, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "001100", "relative": "子孙", "position": 4, "classicalName": "伏克飞神为出暴"},
    {"bits": "110100", "relative": "子孙", "position": 4, "classicalName": "伏克飞神为出暴"},
    {"bits": "001101", "relative": "父母", "position": 1, "classicalName": "伏克飞神为出暴"},
    {"bits": "001101", "relative": "官鬼", "position": 3, "classicalName": "飞来生伏"},
    {"bits": "011101", "relative": "父母", "position": 1, "classicalName": "伏克飞神为出暴"},
    {"bits": "010101", "relative": "官鬼", "position": 3, "classicalName": "伏克飞神为出暴"},
    {"bits": "010001", "relative": "妻财", "position": 4, "classicalName": "飞来生伏"},
    {"bits": "010011", "relative": "官鬼", "position": 3, "classicalName": "伏克飞神为出暴"},
    {"bits": "010011", "relative": "妻财", "position": 4, "classicalName": "飞来生伏"},
    {"bits": "010111", "relative": "官鬼", "position": 3, "classicalName": "伏克飞神为出暴"},
    {"bits": "000100", "relative": "父母", "position": 1, "classicalName": "飞来克伏"},
    {"bits": "010100", "relative": "父母", "position": 1, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "011100", "relative": "兄弟", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "011000", "relative": "兄弟", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "011000", "relative": "子孙", "position": 4, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "011010", "relative": "兄弟", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "011010", "relative": "子孙", "position": 4, "classicalName": "伏克飞神为出暴"},
    {"bits": "011110", "relative": "兄弟", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "011110", "relative": "子孙", "position": 4, "classicalName": "伏神绝于飞爻"},
    {"bits": "100110", "relative": "子孙", "position": 4, "classicalName": "伏神绝于飞爻"},
    {"bits": "111011", "relative": "官鬼", "position": 3, "classicalName": "飞来生伏"},
    {"bits": "101011", "relative": "官鬼", "position": 3, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "100011", "relative": "官鬼", "position": 3, "classicalName": "飞来生伏"},
    {"bits": "100001", "relative": "官鬼", "position": 3, "classicalName": "飞来生伏"},
    {"bits": "100001", "relative": "子孙", "position": 5, "classicalName": "飞来克伏"},
    {"bits": "011001", "relative": "子孙", "position": 5, "classicalName": "飞来克伏"},
    {"bits": "100010", "relative": "妻财", "position": 3, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "101010", "relative": "妻财", "position": 3, "classicalName": "伏神绝于飞爻"},
    {"bits": "101110", "relative": "妻财", "position": 3, "classicalName": "伏神绝于飞爻"},
    {"bits": "101000", "relative": "妻财", "position": 3, "classicalName": "伏神绝于飞爻"},
    {"bits": "101001", "relative": "父母", "position": 2, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "101001", "relative": "子孙", "position": 3, "classicalName": "伏去生飞，名为泄气"},
    {"bits": "111001", "relative": "父母", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "111001", "relative": "子孙", "position": 3, "classicalName": "飞来生伏"},
    {"bits": "110001", "relative": "子孙", "position": 3, "classicalName": "伏神入墓于飞爻"},
    {"bits": "110101", "relative": "妻财", "position": 5, "classicalName": "飞来克伏"},
    {"bits": "110111", "relative": "妻财", "position": 5, "classicalName": "飞来生伏得长生"},
    {"bits": "110011", "relative": "妻财", "position": 5, "classicalName": "伏神绝于飞爻"},
    {"bits": "110011", "relative": "子孙", "position": 3, "classicalName": "伏神入墓于飞爻"},
    {"bits": "001011", "relative": "妻财", "position": 5, "classicalName": "伏神绝于飞爻"},
    {"bits": "100000", "relative": "父母", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "111000", "relative": "父母", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "111110", "relative": "父母", "position": 2, "classicalName": "飞来生伏得长生"},
    {"bits": "111010", "relative": "父母", "position": 2, "classicalName": "飞来生伏得长生"},
]

YONGSHEN_RULES = [
    ("求财收入", ["钱", "收入", "赚钱", "财运", "回款", "到账", "工资", "副业", "利润"], ["妻财"], ["世爻", "兄弟", "子孙"], "妻财为钱；兄弟常为破财/竞争；子孙可生财"),
    ("投资交易", ["股票", "基金", "币", "投资", "买卖", "涨跌", "收益"], ["妻财"], ["兄弟", "官鬼", "子孙"], "妻财看收益；兄弟看损耗；官鬼看风险"),
    ("生意订单", ["客户", "订单", "成交", "合作", "销售", "签单"], ["妻财"], ["应爻", "父母", "官鬼"], "妻财看利润/客户资源；父母看合同；应爻看对方"),
    ("工作事业", ["工作", "事业", "岗位", "offer", "职场", "跳槽"], ["官鬼"], ["父母", "世爻", "应爻"], "官鬼为职位/事业压力；父母看合同文书"),
    ("升职考公", ["升职", "晋升", "编制", "公务员", "职称", "领导"], ["官鬼"], ["父母", "世爻"], "官鬼为官职；父母为资格、文书、考试材料"),
    ("考试学习", ["考试", "考研", "论文", "成绩", "录取", "申请", "夏令营"], ["父母"], ["官鬼", "世爻", "子孙"], "父母为文书学业；官鬼为名次/录取压力；子孙为发挥"),
    ("文书合同", ["合同", "协议", "证明", "材料", "签证", "申请表"], ["父母"], ["官鬼", "应爻"], "父母主文书；官鬼看审查压力"),
    ("房屋住所", ["房子", "租房", "买房", "搬家", "宿舍", "办公室"], ["父母"], ["世爻", "应爻", "妻财"], "父母为房屋；妻财看价格成本"),
    ("感情男问女", ["女朋友", "女生", "暧昧", "追女生", "老婆"], ["妻财"], ["应爻", "世爻", "官鬼"], "男问女，妻财为女方"),
    ("感情女问男", ["男朋友", "男生", "老公", "追男生"], ["官鬼"], ["应爻", "世爻", "妻财"], "女问男，官鬼为男方"),
    ("泛问关系", ["我和某人关系", "对方怎么看我", "会不会和好", "关系", "和好"], ["应爻"], ["世爻"], "不明确身份时，应爻代表对方"),
    ("朋友同学", ["朋友", "同学", "室友", "同辈", "兄弟姐妹"], ["兄弟"], ["应爻", "世爻"], "朋友/室友/同辈一般取兄弟"),
    ("合伙合作", ["合伙人", "合作伙伴", "团队", "一起做项目"], ["兄弟"], ["妻财", "父母", "官鬼"], "兄弟看合伙人；妻财看利益；父母看协议"),
    ("竞争对手", ["竞争", "对手", "同行", "抢客户", "抢资源"], ["兄弟"], ["妻财", "官鬼"], "兄弟常为竞争和分财之神"),
    ("宠物", ["猫", "狗", "宠物", "动物", "毛孩子"], ["子孙"], ["世爻", "应爻", "父母"], "宠物一般取子孙；环境照顾看父母"),
    ("子女", ["孩子", "儿子", "女儿", "怀孕", "备孕", "生育"], ["子孙"], ["父母", "官鬼", "世爻"], "子孙主子女；怀孕也要看子孙是否有气"),
    ("健康疾病", ["身体", "病", "疾病", "手术", "疼痛", "健康"], ["官鬼"], ["子孙", "世爻", "父母"], "官鬼为病；子孙为药/解忧；世爻为自身"),
    ("医药治疗", ["药", "治疗", "医生", "手术", "康复"], ["子孙"], ["官鬼", "父母"], "子孙为药和治疗效果；官鬼为病症"),
    ("官司纠纷", ["官司", "诉讼", "报警", "纠纷", "投诉", "仲裁"], ["官鬼"], ["父母", "兄弟", "应爻"], "官鬼为官非；父母为证据文书"),
    ("风险灾祸", ["危险", "出事", "灾", "麻烦", "事故", "会不会有事"], ["官鬼"], ["子孙", "世爻"], "官鬼为风险；子孙为化解"),
    ("失物寻找", ["东西丢了", "手机", "钥匙", "钱包", "找不到"], ["妻财"], ["父母", "世爻", "应爻"], "一般物品取妻财；证件文书类取父母"),
    ("证件丢失", ["身份证", "护照", "毕业证", "合同", "文件丢了"], ["父母"], ["妻财", "应爻"], "文书证件取父母"),
    ("出行旅行", ["出门", "旅行", "远行", "搬迁", "行程"], ["父母"], ["世爻", "官鬼", "应爻"], "父母可看车票路线文书；官鬼看风险"),
    ("消息回复", ["消息", "微信", "邮件", "回复", "联系", "通知"], ["父母"], ["应爻", "世爻"], "父母主信息文书；朱雀辅助看沟通"),
    ("项目产品", ["项目", "产品", "系统", "软件", "代码", "论文成果"], ["子孙"], ["父母", "官鬼", "妻财"], "子孙主产出；父母看文档/代码结构；财看商业化"),
    ("AI Agent/软件上线", ["agent", "系统", "上线", "部署", "产品发布"], ["子孙"], ["父母", "官鬼", "妻财"], "子孙为作品产出；官鬼看 bug/压力；财看收益"),
    ("面试录用", ["面试", "offer", "录用", "入职"], ["官鬼"], ["父母", "应爻", "世爻"], "官鬼为职位；父母为 offer/文书"),
    ("领导老师", ["老师", "导师", "领导", "上级", "评审"], ["父母", "官鬼"], ["应爻", "世爻"], "老师偏父母，领导/权力偏官鬼"),
    ("父母长辈", ["父亲", "母亲", "长辈", "家里老人"], ["父母"], ["世爻", "官鬼"], "长辈取父母；健康另看官鬼"),
    ("兄弟姐妹", ["兄弟", "姐妹", "同辈亲戚"], ["兄弟"], ["应爻"], "同辈亲属取兄弟"),
    ("名声口舌", ["名声", "舆论", "吵架", "口舌", "被骂"], ["官鬼"], ["兄弟", "应爻"], "官鬼看是非压力；朱雀看口舌传播"),
    ("玄学问事泛问", ["这件事成不成", "结果如何", "对我好吗"], ["世爻", "应爻"], [], "先看世应，再按事情类型补用神"),
]
LEGACY_TYPE_MAP = {
    "求财": "求财收入", "求事业": "工作事业", "求感情": "泛问关系", "求考试": "考试学习",
    "求合同": "文书合同", "求健康": "健康疾病", "求失物": "失物寻找", "求出行": "出行旅行",
    "求合作": "合伙合作", "求官司": "官司纠纷", "求宠物": "宠物", "其他": "玄学问事泛问",
}


@dataclass(frozen=True)
class HexagramTables:
    by_id: dict[int, dict[str, Any]]
    by_name: dict[str, dict[str, Any]]
    by_bits: dict[str, dict[str, Any]]
    raw: list[dict[str, Any]]


def bits_from_trigrams(upper: str, lower: str) -> str:
    return "".join(map(str, TRIGRAM_BITS[lower] + TRIGRAM_BITS[upper]))


def load_hexagram_tables(path: Path = HEXAGRAM_DATA) -> HexagramTables:
    raw = json.loads(path.read_text(encoding="utf-8"))
    by_id: dict[int, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    by_bits: dict[str, dict[str, Any]] = {}

    i = 0
    while i < len(raw):
        head = raw[i]
        if head["shangGua"] != head["xiaGua"]:
            raise ValueError(f"64gua data group at index {i} does not start with a pure trigram")
        palace_trigram = head["shangGua"]
        for k in range(8):
            r = raw[i + k]
            hid = i + k + 1
            meta = {
                "id": hid,
                "name": r["name"],
                "fullName": r["fullName"],
                "symbol": r.get("symbol", ""),
                "upper": r["shangGua"],
                "lower": r["xiaGua"],
                "palace": palace_trigram,
                "palaceName": PALACE_OF_TRIGRAM[palace_trigram],
                "palaceType": PALACE_TYPE_BY_INDEX[k],
                "element": TRIGRAM_ELEMENT[palace_trigram],
            }
            by_id[hid] = meta
            by_name[meta["name"]] = meta
            by_bits[bits_from_trigrams(meta["upper"], meta["lower"])] = meta
        i += 8
    return HexagramTables(by_id=by_id, by_name=by_name, by_bits=by_bits, raw=raw)


def validate_stem(value: str | None, name: str) -> str | None:
    if not value:
        return None
    if value not in STEMS:
        raise ValueError(f"{name} must be one of {''.join(STEMS)}, got {value}")
    return value


def validate_branch(value: str | None, name: str) -> str | None:
    if not value:
        return None
    if value not in BRANCHES:
        raise ValueError(f"{name} must be one of {''.join(BRANCHES)}, got {value}")
    return value


def parse_int_list(text: str, expected: int, name: str) -> list[int]:
    raw = [p for p in text.replace("，", ",").replace(" ", ",").split(",") if p]
    if len(raw) != expected:
        raise ValueError(f"{name} expects {expected} values")
    values = [int(x) for x in raw]
    return values


def yao_yinyang(value: int) -> str:
    return "阳" if value in (7, 9) else "阴"


def yao_to_bit(value: int) -> int:
    return 1 if value in (7, 9) else 0


def is_moving(value: int) -> bool:
    return value in (6, 9)


def flip_yao(value: int) -> int:
    if value == 6:
        return 9
    if value == 9:
        return 6
    return value


def moving_lines_of(values: list[int]) -> list[int]:
    return [i + 1 for i, value in enumerate(values) if is_moving(value)]


def modulo(value: int, base: int) -> int:
    remainder = abs(int(value)) % base
    return base if remainder == 0 else remainder


def hour_to_branch_number(hour: int) -> int:
    if hour < 0 or hour > 23:
        raise ValueError(f"hour must be 0-23, got {hour}")
    if hour in (23, 0):
        return 1
    return ((hour + 1) // 2) + 1


def parse_datetime(datetime_text: str | None, timezone: str) -> tuple[datetime, int, int, int, int]:
    if datetime_text:
        text = datetime_text.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
    else:
        dt = datetime.now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(timezone))
    local = dt.astimezone(ZoneInfo(timezone))
    return local, local.year, local.month, local.day, local.hour


def cast_from_trigrams(upper_number: int, lower_number: int, moving_line: int, method: str, meta: dict[str, Any]) -> dict[str, Any]:
    upper = XIANTIAN_TRIGRAM_BY_NUMBER[upper_number]
    lower = XIANTIAN_TRIGRAM_BY_NUMBER[lower_number]
    bits = TRIGRAM_BITS[lower] + TRIGRAM_BITS[upper]
    yao_values = [9 if bit == 1 and i + 1 == moving_line else 6 if bit == 0 and i + 1 == moving_line else 7 if bit == 1 else 8 for i, bit in enumerate(bits)]
    return {
        "method": method,
        "yaoValues": yao_values,
        "movingLines": [moving_line],
        "meta": {**meta, "upperNumber": upper_number, "upperTrigram": upper, "lowerNumber": lower_number, "lowerTrigram": lower, "movingLine": moving_line, "bits": bits},
    }


def resolve_cast(args: argparse.Namespace) -> dict[str, Any]:
    if args.yao:
        values = parse_int_list(args.yao, 6, "--yao")
        bad = [v for v in values if v not in (6, 7, 8, 9)]
        if bad:
            raise ValueError(f"--yao values must be 6/7/8/9, got {bad}")
        return {"method": "manual", "yaoValues": values, "movingLines": moving_lines_of(values), "meta": {"source": "manual-yaoValues"}}

    if args.bits:
        bits = parse_int_list(args.bits, 6, "--bits")
        bad = [v for v in bits if v not in (0, 1)]
        if bad:
            raise ValueError(f"--bits values must be 0/1, got {bad}")
        values = [7 if bit == 1 else 8 for bit in bits]
        return {"method": "manual", "yaoValues": values, "movingLines": [], "meta": {"source": "manual-bits", "bits": bits}}

    if args.coins:
        throws = parse_coin_throws(args.coins)
        values = [coin_throw_to_yao(t) for t in throws]
        return {
            "method": "coins",
            "yaoValues": values,
            "movingLines": moving_lines_of(values),
            "meta": {"rule": "三枚硬币，正=3，反=2；每爻一摇，自初爻到上爻", "throws": throws},
        }

    if args.random_coins:
        throws = [[random.choice(["正", "反"]) for _ in range(3)] for _ in range(6)]
        values = [coin_throw_to_yao(t) for t in throws]
        return {"method": "coins", "yaoValues": values, "movingLines": moving_lines_of(values), "meta": {"throws": throws, "random": True}}

    if args.numbers:
        nums = parse_int_list(args.numbers, 3, "--numbers")
        upper = modulo(nums[0], 8)
        lower = modulo(nums[1], 8)
        moving = modulo(nums[2], 6)
        return cast_from_trigrams(upper, lower, moving, "numbers", {"rule": "三数起卦：上卦/下卦/动爻取余", "numbers": nums})

    if args.time_cast:
        local, year, month, day, hour = parse_datetime(args.datetime, args.timezone)
        hour_branch_number = hour_to_branch_number(hour)
        upper = modulo(year + month + day, 8)
        lower = modulo(year + month + day + hour_branch_number, 8)
        moving = modulo(year + month + day + hour_branch_number, 6)
        return cast_from_trigrams(upper, lower, moving, "time", {
            "rule": "年+月+日取上卦；年+月+日+时辰数取下卦和动爻；先天八卦数",
            "datetime": local.isoformat(),
            "timezone": args.timezone,
            "year": year,
            "month": month,
            "day": day,
            "hour": hour,
            "hourBranchNumber": hour_branch_number,
        })

    if args.character:
        chars = list(args.character.strip())
        if len(chars) != 1:
            raise ValueError("--character expects exactly one character")
        char = chars[0]
        local, _year, _month, day, hour = parse_datetime(args.datetime, args.timezone)
        basis = COMMON_MODERN_STROKES.get(char, ord(char))
        source = "modern-stroke-dictionary" if char in COMMON_MODERN_STROKES else "unicode-code-point-fallback"
        hour_branch_number = hour_to_branch_number(hour)
        upper = modulo(basis, 8)
        lower = modulo(basis + hour_branch_number, 8)
        moving = modulo(basis + day + hour_branch_number, 6)
        return cast_from_trigrams(upper, lower, moving, "character", {
            "rule": "优先用现代笔画数；查不到笔画时用 Unicode 码点兜底",
            "character": char,
            "basis": basis,
            "basisSource": source,
            "datetime": local.isoformat(),
            "timezone": args.timezone,
        })

    raise ValueError("provide one of --yao, --bits, --coins, --random-coins, --numbers, --time-cast, or --character")


def parse_coin_throws(text: str) -> list[list[str]]:
    chunks = [p.strip() for p in text.replace("，", ",").split(",") if p.strip()]
    if len(chunks) != 6:
        raise ValueError("--coins expects 6 throws separated by commas")
    out = []
    for chunk in chunks:
        faces = []
        for c in chunk:
            if c in ("正", "反"):
                faces.append(c)
        if len(faces) != 3:
            raise ValueError(f"coin throw must contain 3 正/反 faces, got {chunk}")
        out.append(faces)
    return out


def coin_throw_to_yao(faces: list[str]) -> int:
    total = sum(3 if f == "正" else 2 for f in faces)
    if total not in (6, 7, 8, 9):
        raise ValueError(f"invalid coin sum {total}")
    return total


def shi_for(palace_type: str) -> int:
    return SHI_BY_TYPE[palace_type]


def ying_for(palace_type: str) -> int:
    return ((shi_for(palace_type) + 2) % 6) + 1


def najia_for(trigram: str, position: int) -> dict[str, str]:
    is_inner = position <= 3
    index = position - 1 if is_inner else position - 4
    stem = INNER_STEM[trigram] if is_inner else OUTER_STEM[trigram]
    branch = INNER_BRANCHES[trigram][index] if is_inner else OUTER_BRANCHES[trigram][index]
    return {"stem": stem, "branch": branch, "element": BRANCH_ELEMENT[branch]}


def najia_lines(lower: str, upper: str) -> list[dict[str, Any]]:
    lines = []
    for position in LINE_POSITIONS:
        trigram = lower if position <= 3 else upper
        lines.append({"position": position, **najia_for(trigram, position)})
    return lines


def relative_of(palace_element: str, line_element: str) -> str:
    if palace_element == line_element:
        return "兄弟"
    if WUXING_SHENG[palace_element] == line_element:
        return "子孙"
    if WUXING_KE[palace_element] == line_element:
        return "妻财"
    if WUXING_SHENG[line_element] == palace_element:
        return "父母"
    if WUXING_KE[line_element] == palace_element:
        return "官鬼"
    raise ValueError(f"unreachable relative relation: {palace_element}/{line_element}")


def six_gods_for_day_stem(day_stem: str) -> list[str]:
    start = DAY_STEM_START_GOD[day_stem]
    start_index = SIX_GOD_SEQUENCE.index(start)
    return [SIX_GOD_SEQUENCE[(start_index + i) % len(SIX_GOD_SEQUENCE)] for i in range(6)]


def producer_of(element: str) -> str:
    for k, v in WUXING_SHENG.items():
        if v == element:
            return k
    raise ValueError(element)


def overcomer_of(element: str) -> str:
    for k, v in WUXING_KE.items():
        if v == element:
            return k
    raise ValueError(element)


def month_strength_for_element(line_element: str, month_branch: str) -> str:
    month_element = BRANCH_ELEMENT[month_branch]
    if line_element == month_element:
        return "旺"
    if line_element == WUXING_SHENG[month_element]:
        return "相"
    if line_element == producer_of(month_element):
        return "休"
    if line_element == overcomer_of(month_element):
        return "囚"
    return "死"


def element_relation_labels(line_element: str, pillar_element: str, kind: str) -> list[str]:
    if line_element == pillar_element:
        return [f"得{kind}扶"]
    if WUXING_SHENG[pillar_element] == line_element:
        return [f"得{kind}生"]
    if WUXING_KE[pillar_element] == line_element:
        return [f"被{kind}克"]
    return []


def strength_labels_for_line(branch: str, month_branch: str | None, day_branch: str | None, is_void: bool) -> dict[str, Any]:
    line_element = BRANCH_ELEMENT[branch]
    labels: list[str] = []
    if month_branch:
        month_element = BRANCH_ELEMENT[month_branch]
        labels.append(month_strength_for_element(line_element, month_branch))
        labels.extend(element_relation_labels(line_element, month_element, "月"))
        if BRANCH_CLASH[branch] == month_branch:
            labels.append("月破")
    if day_branch:
        day_element = BRANCH_ELEMENT[day_branch]
        labels.extend(element_relation_labels(line_element, day_element, "日"))
        if BRANCH_CLASH[branch] == day_branch:
            labels.append("日破")
    if is_void:
        labels.append("旬空")
    deduped = list(dict.fromkeys(labels))
    score = 0
    for label in deduped:
        if label in MONTH_STRENGTH_SCORE:
            score += MONTH_STRENGTH_SCORE[label]
        else:
            score += RELATION_STRENGTH_SCORE.get(label, 0)
    return {"labels": deduped, "score": score}


def twelve_stage_group(element: str) -> str:
    return "水土" if element in ("水", "土") else element


def twelve_stage_for(element: str, branch: str) -> str:
    return TWELVE_STAGE_BY_GROUP[twelve_stage_group(element)][branch]


def twelve_stage_note(stage: str) -> str | None:
    return {
        "长生": "生发有气，仍须结合用神身份与生克制化",
        "帝旺": "气势较足，不能替代月令旺衰总判",
        "墓": "藏滞入库，需看冲开、旺衰与回头生克",
        "绝": "气机难续，需看生扶、长生与原神救助",
    }.get(stage)


def infer_transformation(original: dict[str, Any], changed: dict[str, Any]) -> str:
    oe = original["element"]
    ce = changed["element"]
    if WUXING_SHENG[oe] == ce:
        return "化生"
    if WUXING_KE[oe] == ce:
        return "化克"
    if WUXING_SHENG[ce] == oe:
        return "回头生"
    if WUXING_KE[ce] == oe:
        return "回头克"
    if BRANCH_CLASH[original["branch"]] == changed["branch"]:
        return "化破"
    return "普通变化"


def branch_relations(lines: list[dict[str, Any]], day_branch: str | None) -> list[dict[str, str]]:
    relations = []
    if day_branch:
        for line in lines:
            branch = line["branch"]
            if BRANCH_CLASH[branch] == day_branch:
                relations.append({"source": f"第{line['position']}爻({branch})", "target": "日辰", "type": "冲", "description": f"第{line['position']}爻{branch}与日辰{day_branch}相冲"})
            if BRANCH_COMBINE[branch] == day_branch:
                relations.append({"source": f"第{line['position']}爻({branch})", "target": "日辰", "type": "合", "description": f"第{line['position']}爻{branch}与日辰{day_branch}相合"})
    for group in BRANCH_SAN_HE_GROUPS:
        present = [line["branch"] for line in lines if line["branch"] in group["branches"]]
        if len(set(present)) == 3:
            relations.append({"source": "、".join(present), "target": "", "type": "三合", "description": f"{'、'.join(present)}三合{group['element']}局"})
    return relations


def infer_fushen_relation(feishen: str, fushen: str) -> str:
    if feishen == fushen:
        return "飞伏比和"
    if WUXING_SHENG[feishen] == fushen:
        return "飞生伏"
    if WUXING_KE[feishen] == fushen:
        return "飞克伏"
    if WUXING_SHENG[fushen] == feishen:
        return "伏生飞"
    return "伏克飞"


def fushen_items(hexagram: dict[str, Any], visible_relatives: list[str], tables: HexagramTables) -> list[dict[str, Any]]:
    bits = bits_from_trigrams(hexagram["upper"], hexagram["lower"])
    rules = [rule for rule in FUSHEN_RULES if rule["bits"] == bits]
    if not rules:
        return []
    pure = next((h for h in tables.by_id.values() if h["palace"] == hexagram["palace"] and h["palaceType"] == "本宫"), None)
    if not pure:
        return []
    visible_set = set(visible_relatives)
    original_najia = najia_lines(hexagram["lower"], hexagram["upper"])
    pure_najia = najia_lines(pure["lower"], pure["upper"])
    pure_relatives = [relative_of(hexagram["element"], line["element"]) for line in pure_najia]
    out = []
    for rule in rules:
        if rule["relative"] in visible_set:
            continue
        idx = rule["position"] - 1
        if pure_relatives[idx] != rule["relative"]:
            continue
        fushen = pure_najia[idx]
        feishen = original_najia[idx]
        out.append({
            "relative": rule["relative"],
            "fushenStem": fushen["stem"],
            "fushenBranch": fushen["branch"],
            "fushenElement": fushen["element"],
            "feishenRelative": visible_relatives[idx],
            "feishenStem": feishen["stem"],
            "feishenBranch": feishen["branch"],
            "feishenElement": feishen["element"],
            "position": rule["position"],
            "relation": infer_fushen_relation(feishen["element"], fushen["element"]),
            "classicalName": rule["classicalName"],
        })
    return out


def normalize_question_type(question_type: str | None) -> str:
    if not question_type:
        return "玄学问事泛问"
    value = question_type.strip()
    if value in LEGACY_TYPE_MAP:
        return LEGACY_TYPE_MAP[value]
    known = {rule[0] for rule in YONGSHEN_RULES}
    return value if value in known else "玄学问事泛问"


def detect_question_type(question: str | None, explicit_type: str | None) -> str:
    if explicit_type and explicit_type.strip():
        return normalize_question_type(explicit_type)
    text = (question or "").lower()
    if not text.strip():
        return "玄学问事泛问"
    best: tuple[str, int] | None = None
    for qtype, keywords, *_rest in YONGSHEN_RULES:
        score = sum(max(1, len(keyword.lower())) for keyword in keywords if keyword.lower() in text)
        if score > 0 and (best is None or score > best[1]):
            best = (qtype, score)
    return best[0] if best else "玄学问事泛问"


def yongshen_for(question: str | None, question_type: str | None, lines: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not question and not question_type:
        return None
    resolved = detect_question_type(question, question_type)
    rule = next((r for r in YONGSHEN_RULES if r[0] == resolved), YONGSHEN_RULES[-1])
    _qtype, _keywords, primary, auxiliary, description = rule

    def find_positions(focus: str) -> list[int]:
        if focus == "世爻":
            return [line["position"] for line in lines if line["isShi"]]
        if focus == "应爻":
            return [line["position"] for line in lines if line["isYing"]]
        return [line["position"] for line in lines if line["sixRelative"] == focus]

    candidates = []
    seen = set()
    for focus, is_primary in [(focus, True) for focus in primary] + [(focus, False) for focus in auxiliary]:
        if focus in seen:
            continue
        seen.add(focus)
        positions = find_positions(focus)
        candidates.append({
            "relative": focus,
            "positions": positions,
            "reason": f"{'主要用神' if is_primary else '辅助关注'}：{description}",
            "confidence": "high" if is_primary and positions else "medium" if positions else "low",
        })

    support_map = {"父母": "官鬼", "官鬼": "妻财", "妻财": "子孙", "子孙": "兄弟", "兄弟": "父母"}
    jishen_map = {"父母": "妻财", "官鬼": "子孙", "妻财": "兄弟", "子孙": "父母", "兄弟": "官鬼"}
    choushen_map = {"父母": "子孙", "官鬼": "兄弟", "妻财": "父母", "子孙": "官鬼", "兄弟": "妻财"}
    primary_relatives = [focus for focus in primary if focus not in ("世爻", "应爻")]
    supporting = []
    hostile = []
    for rel in primary_relatives:
        yuanshen = support_map[rel]
        pos = find_positions(yuanshen)
        if pos:
            supporting.append({"relative": yuanshen, "positions": pos, "role": "元神"})
        for label, table in (("忌神", jishen_map), ("仇神", choushen_map)):
            target = table[rel]
            pos = find_positions(target)
            if pos:
                hostile.append({"relative": target, "positions": pos, "role": label})
    return {"questionType": resolved, "candidates": candidates, "supportingGods": supporting, "hostileGods": hostile}


def assemble_chart(args: argparse.Namespace) -> dict[str, Any]:
    warnings: list[str] = []
    day_stem = validate_stem(args.day_stem, "--day-stem")
    day_branch = validate_branch(args.day_branch, "--day-branch")
    month_branch = validate_branch(args.month_branch, "--month-branch")
    if day_branch and not day_stem:
        warnings.append("dayBranch was supplied without dayStem; 六神/旬空 still require --day-stem")
    if not day_stem:
        warnings.append("dayStem not supplied; sixGod and xunkong are omitted")
    if not month_branch:
        warnings.append("monthBranch not supplied; monthly strength labels are omitted")

    tables = load_hexagram_tables()
    cast = resolve_cast(args)
    raw_values = cast["yaoValues"]
    original_bits = [yao_to_bit(v) for v in raw_values]
    changed_bits = [yao_to_bit(flip_yao(v)) for v in raw_values]
    original_key = "".join(map(str, original_bits))
    changed_key = "".join(map(str, changed_bits))
    original_hex = tables.by_bits[original_key]
    changed_hex = tables.by_bits[changed_key]

    palace_element = original_hex["element"]
    shi = shi_for(original_hex["palaceType"])
    ying = ying_for(original_hex["palaceType"])
    original_najia = najia_lines(original_hex["lower"], original_hex["upper"])
    relatives = [relative_of(palace_element, line["element"]) for line in original_najia]
    gods = six_gods_for_day_stem(day_stem) if day_stem else [None] * 6
    xunkong = XUNKONG_BY_DAY_STEM[day_stem] if day_stem else None
    empty_lines = [i + 1 for i, line in enumerate(original_najia) if xunkong and line["branch"] in xunkong]

    changed_upper = BITS_TO_TRIGRAM["".join(map(str, changed_bits[3:]))]
    changed_lower = BITS_TO_TRIGRAM["".join(map(str, changed_bits[:3]))]
    changed_najia_all = najia_lines(changed_lower, changed_upper)

    lines = []
    for i, value in enumerate(raw_values):
        position = i + 1
        najia = original_najia[i]
        changed_najia = changed_najia_all[i]
        moving = is_moving(value)
        changed_yinyang = yao_yinyang(flip_yao(value)) if moving else yao_yinyang(value)
        line = {
            "position": position,
            "rawValue": value,
            "yinYang": yao_yinyang(value),
            "moving": moving,
            "changedYinYang": changed_yinyang,
            "stem": najia["stem"],
            "branch": najia["branch"],
            "element": najia["element"],
            "sixRelative": relatives[i],
            "sixGod": gods[i],
            "isShi": position == shi,
            "isYing": position == ying,
            "void": position in empty_lines,
            "changedStem": changed_najia["stem"],
            "changedBranch": changed_najia["branch"],
            "changedElement": changed_najia["element"],
            "changedSixRelative": relative_of(palace_element, changed_najia["element"]),
        }
        line["strength"] = strength_labels_for_line(line["branch"], month_branch, day_branch, line["void"])
        if day_branch:
            by_day = twelve_stage_for(line["element"], day_branch)
            by_changed = twelve_stage_for(line["changedElement"], line["changedBranch"]) if moving else None
            notes = []
            if by_day in TWELVE_STAGE_CORE:
                notes.append(f"日辰{by_day}：{twelve_stage_note(by_day)}")
            if by_changed in TWELVE_STAGE_CORE:
                notes.append(f"动化{by_changed}：{twelve_stage_note(by_changed)}")
            line["twelveStage"] = {
                "position": position,
                "byDay": by_day,
                "byChangedBranch": by_changed,
                "sourceTable": "易隐_长生定局",
                "interpretationLevel": "辅助状态",
                "notes": [n for n in notes if n],
            }
        lines.append(line)

    hidden = fushen_items(original_hex, relatives, tables)
    for item in hidden:
        lines[item["position"] - 1].setdefault("hiddenGods", []).append(item)

    transformations = []
    for pos in moving_lines_of(raw_values):
        single_changed_bits = original_bits[:]
        single_changed_bits[pos - 1] = 0 if single_changed_bits[pos - 1] == 1 else 1
        upper = BITS_TO_TRIGRAM["".join(map(str, single_changed_bits[3:]))]
        lower = BITS_TO_TRIGRAM["".join(map(str, single_changed_bits[:3]))]
        new_najia = najia_lines(lower, upper)[pos - 1]
        original_line = lines[pos - 1]
        changed_line = {**original_line, **new_najia}
        transformations.append({
            "position": pos,
            "fromBranch": original_line["branch"],
            "toBranch": changed_line["branch"],
            "fromElement": original_line["element"],
            "toElement": changed_line["element"],
            "relation": infer_transformation(original_line, changed_line),
        })

    yongshen = yongshen_for(args.question, args.question_type, lines)
    if yongshen:
        for candidate in yongshen["candidates"]:
            for pos in candidate["positions"]:
                if candidate["confidence"] == "high":
                    lines[pos - 1]["isYongshen"] = True
        for item in yongshen["supportingGods"]:
            for pos in item["positions"]:
                lines[pos - 1]["isYuanshen"] = True
        for item in yongshen["hostileGods"]:
            flag = "isJishen" if item["role"] == "忌神" else "isChoushen"
            for pos in item["positions"]:
                lines[pos - 1][flag] = True

    time_block = {
        "datetime": args.datetime,
        "timezone": args.timezone,
        "dayStem": day_stem,
        "dayBranch": day_branch,
        "monthBranch": month_branch,
        "xunkong": xunkong,
    }
    time_block = {k: v for k, v in time_block.items() if v not in (None, "")}

    return {
        "question": args.question,
        "questionType": yongshen["questionType"] if yongshen else normalize_question_type(args.question_type),
        "input": {"type": cast["method"], "raw": raw_values, "meta": cast["meta"]},
        "time": time_block or None,
        "originalBits": original_bits,
        "changedBits": changed_bits,
        "originalHexagram": original_hex,
        "changedHexagram": changed_hex,
        "movingLines": moving_lines_of(raw_values),
        "lines": lines,
        "relations": {"lineRelations": branch_relations(lines, day_branch)},
        "transformations": transformations,
        "hiddenGods": hidden,
        "yongshen": {k: v for k, v in (yongshen or {}).items() if k != "questionType"} if yongshen else None,
        "warnings": warnings or None,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a standalone Liuyao chart JSON.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--yao", help="Six yao values bottom-to-top, e.g. 7,7,9,7,8,6")
    group.add_argument("--bits", help="Six static yin/yang bits bottom-to-top, 0=yin 1=yang")
    group.add_argument("--coins", help="Six 3-coin throws, e.g. 正反反,正正反,反反反,正正正,正反反,正反反")
    group.add_argument("--random-coins", action="store_true", help="Generate six random 3-coin throws")
    group.add_argument("--numbers", help="Three numbers for upper/lower/moving-line casting")
    group.add_argument("--time-cast", action="store_true", help="Use Gregorian year/month/day/hour-number time casting")
    group.add_argument("--character", help="One Chinese character for character casting")
    parser.add_argument("--datetime", help="ISO datetime for time/character metadata. Naive values use --timezone.")
    parser.add_argument("--timezone", default="Asia/Shanghai", help="IANA timezone, default Asia/Shanghai")
    parser.add_argument("--day-stem", help="Day heavenly stem, e.g. 甲")
    parser.add_argument("--day-branch", help="Day earthly branch, e.g. 子")
    parser.add_argument("--month-branch", help="Month earthly branch for strength tags, e.g. 午")
    parser.add_argument("--question", help="Question text for yongshen selection")
    parser.add_argument("--question-type", help="Explicit question type for yongshen selection")
    parser.add_argument("--compact", action="store_true", help="Print compact JSON")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    chart = assemble_chart(args)
    if args.compact:
        print(json.dumps(chart, ensure_ascii=False, separators=(",", ":")))
    else:
        print(json.dumps(chart, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
