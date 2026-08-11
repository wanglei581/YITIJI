#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
跨页一致性检查 —— 找「两个地方互相打架」的地方。

为什么要有这个工具
------------------
回归台查的是**结构**：链接通不通、有没有溢出、按钮点不点得动。
它查不了**说法互相矛盾** —— 而这一类最伤信任：
用户在「我的记录」里看到一个招聘会，点进去发现是另一场，
他会开始怀疑这台机器上**所有**的数字，包括金额。

实测已经踩到的（本工具就是照着这些造的）：
  · 招聘会一件事有四套编号：17 用 RC-/XZ-，43 用 FA-，首页用 IR-/GZFAIR-
  · 线下岗位 13/16/43 写 OA-3312，只有 44 写 OA-3312-07
  · 43 收藏的政策「穗人社规〔2026〕3 号」在 21 的政策库里根本不存在
  · 43 通知写「13 页已出纸」，而 42 对应订单是 2 页 × 2 份

检查什么
--------
1. **同一个 ID 配了不同的名字** —— 同一个外部 ID / 单号，在 A 页叫甲、在 B 页叫乙
2. **同一个名字配了不同的 ID** —— 同一个招聘会/岗位/企业名，两页给的编号不一样
3. **孤儿引用** —— 某页引用的 ID，在「主页面」里根本不存在
4. **同一实体的数字打架** —— 同一个单号在两页写了不同的页数或金额

「主页面」口径（谁是某类数据的唯一真源）
----------------------------------------
这条规则本身写在这里，是为了让下一个人能直接照着判，而不是重新吵一遍：
  招聘会 → 17-fair-desk（场次库）
  线下岗位 → 13-jobs-desk / 16-offline-agencies（岗位列表）
  政策 → 21-policy（政策库）
  订单 → 42-my-assets（订单栏）
  企业 → 15-companies
记录页与详情页一律引用主页面里**真实存在**的条目，不许自己造一条。

用法
----
    python3 tools/consistency.py            # 在设计稿目录下跑
    python3 tools/consistency.py --json     # 机器可读

已知边界（写在这里，不写在报告的漂亮话里）
------------------------------------------
· 只查**静态 HTML 文本**里的字面值；脚本运行时生成的内容查不到。
· 名字靠正则从 ID 附近的文本里取，长名字或跨标签的名字可能取不全 —— 报出来仍需人核。
· 它只能指出「两处不一样」，**不能判断哪一处是对的** —— 那要按上面的主页面口径定。
"""

import re, io, glob, json, sys, os
from collections import defaultdict

# ── 主页面口径 ───────────────────────────────────────────────────────
OWNER = {
    '招聘会': ['17-fair-desk.html'],
    '线下岗位': ['13-jobs-desk.html', '16-offline-agencies.html'],
    '政策': ['21-policy.html'],
    '订单': ['42-my-assets.html'],
    '企业': ['15-companies.html'],
}

# ── 各类 ID 的形态 ───────────────────────────────────────────────────
# 分组命名要能读出来是哪一类，报告里直接用
ID_PATTERNS = [
    ('招聘会', r'\b(?:RC|XZ|FA|IR|GZFAIR)-2026-[0-9A-Za-z-]+\b'),
    ('岗位',   r'\b(?:JX|OA|TH|GZ)-\d[0-9A-Za-z-]*\b'),
    ('企业',   r'\bCO-\d+\b'),
    ('订单',   r'\bO-\d{8}-\d+\b'),
    ('产物',   r'\bart-[a-z0-9-]+\b'),
    ('工单',   r'#F-\d+\b'),
    ('政策文号', r'[穗]?人社[规]?[〔（(]\s*2026\s*[〕）)]\s*\d+\s*号'),
]

def strip_tags(s):
    s = re.sub(r'<script\b.*?</script>', ' ', s, flags=re.S | re.I)
    s = re.sub(r'<style\b.*?</style>', ' ', s, flags=re.S | re.I)
    s = re.sub(r'<!--.*?-->', ' ', s, flags=re.S)      # 注释里的举例不算页面内容
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', s)

# 一看就不是名字的片段：薪资、学历、经验、数字、日期、单位
NOT_A_NAME = re.compile(
    r'^\d+$|^\d+[–\-~]\d+K?$|^\d+K$|本科|大专|硕士|学历|不限|经验|年$|应届|'
    r'^\d{1,2}月|^\d{4}-|^\d+\s*(条|家|场|页|面|张|份|元|人|次|分|秒|步)$|'
    r'^(来源|外部|编号|单号|文号|同步|时间|岗位|职位|要看的岗位|对应订单|办理单|本次办理单|形如)$')

def nearby_name(text, m, width=70):
    """取 ID 前面那一小段文字当作它的名字。
       取「前面」而不是后面，因为版式几乎都是『名称 …… 外部 ID XXX』。

       ⚠ 这一步是本工具最不可靠的地方：第一版把「6–9K」「本科」「20」
       这种旁边的字当成了名字，于是「同一个 ID 配了不同名字」刷了一屏假的。
       噪声等同于失明 —— 报告一多，人就开始不信，真矛盾跟着被忽略。
       所以这里宁可少认几个名字，也不要认错。"""
    left = text[max(0, m.start() - width):m.start()]
    left = re.sub(r'(来源|外部\s*ID|编号|单号|文号|同步|ID)\s*[:：]?\s*$', '', left).strip()
    parts = re.split(r'[·|/、,，。;；:：\s]+', left)
    for p in reversed(parts):
        p = p.strip()
        if len(p) < 3:                       # 太短的判不了，跳过
            continue
        if NOT_A_NAME.search(p):
            continue
        if not re.search(r'[\u4e00-\u9fa5]', p):   # 名字里总该有中文
            continue
        return p
    return ''

def scan():
    files = sorted(glob.glob('[0-9]*.html'))
    # kind -> id -> {page -> set(names)}
    seen = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))
    for f in files:
        raw = io.open(f, encoding='utf-8').read()
        text = strip_tags(raw)
        for kind, pat in ID_PATTERNS:
            for m in re.finditer(pat, text):
                tok = re.sub(r'\s+', '', m.group(0))
                seen[kind][tok][f].add(nearby_name(text, m))
    return seen

def report(seen, as_json=False):
    issues = []

    for kind, ids in seen.items():
        owners = OWNER.get(kind if kind in OWNER else
                           {'岗位': '线下岗位', '政策文号': '政策'}.get(kind, ''), [])

        # ① 同一个 ID，在不同页配了不同名字
        for tok, pages in ids.items():
            names = {}
            for pg, ns in pages.items():
                for n in ns:
                    if n:
                        names.setdefault(n, []).append(pg)
            if len(names) > 1:
                issues.append({
                    'type': '同一个 ID 在不同页上下文不一致（需人核，本项不可靠）', 'kind': kind, 'id': tok,
                    'note': ('名字是从 ID 前面的文字里猜的，分不清「岗位名」和「来源机构名」'
                             '（都是中文）。**这一项只给候选，判不了对错** —— '
                             '真要确认，去两页各看一眼那一条。'),
                    'detail': {n: sorted(pgs) for n, pgs in names.items()},
                })

        # ② 孤儿引用：主页面里没有这个 ID，别的页却在用
        if owners:
            for tok, pages in ids.items():
                in_owner = any(o in pages for o in owners)
                if not in_owner and pages:
                    issues.append({
                        'type': '主页面里没有这个 ID', 'kind': kind, 'id': tok,
                        'detail': {'出现在': sorted(pages.keys()),
                                   '主页面': owners},
                    })

    # ③ 同一类 ID 出现多套前缀 —— 编号体系不统一
    for kind, ids in seen.items():
        prefixes = defaultdict(set)
        for tok in ids:
            p = re.match(r'^[A-Za-z#]+', tok)
            if p:
                prefixes[p.group(0)] |= set(ids[tok].keys())
        if len(prefixes) > 1:
            issues.append({
                'type': '同一类东西有多套编号体系', 'kind': kind, 'id': '',
                'note': ('岗位来自不同的第三方来源，前缀不同是**正常**的 —— '
                         '本机只是信息入口，不该把来源方的编号改写成自己的一套。'
                         '真正要看的是：同一场/同一岗在两页给了不同编号。'),
                'detail': {p: sorted(pgs) for p, pgs in prefixes.items()},
            })

    if as_json:
        print(json.dumps(issues, ensure_ascii=False, indent=1))
        return len(issues)

    if not issues:
        print('跨页一致性：没有发现矛盾。')
        return 0

    # 排序 = 可靠度：能自证的排前面，靠猜的排最后
    order = {'主页面里没有这个 ID': 0, '同一类东西有多套编号体系': 1,
             '同一个 ID 在不同页上下文不一致（需人核，本项不可靠）': 2}
    issues.sort(key=lambda x: (order.get(x['type'], 9), x['kind'], x['id']))
    cur = None
    for it in issues:
        if it['type'] != cur:
            cur = it['type']
            print(f'\n══ {cur} ══')
        head = f"[{it['kind']}] {it['id']}".rstrip()
        print(f'  {head}')
        if it.get('note'):
            print(f'      注：{it["note"]}')
        for k, v in it['detail'].items():
            print(f'      {k} → {", ".join(v) if isinstance(v, list) else v}')
    print(f'\n共 {len(issues)} 条。')
    print('注意：本工具只能指出「两处不一样」，**判不了哪一处是对的** ——')
    print('     按文件头部的「主页面口径」定：记录页与详情页服从主页面。')
    return len(issues)

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(os.path.dirname(here))          # 切到设计稿目录
    sys.exit(0 if report(scan(), '--json' in sys.argv) == 0 else 1)
