---
name: cinema-radar-weekly
description: 互动影院竞品周报：跑抓取脚本 → 解读变化 → 刷小红书 → 写中文周报 → 重渲染看板 → 推飞书
---

你在维护 `~/cinema-radar`：追踪 Tipsy「互动影院」（面向海外、AI 分支剧情 + Director 按需生成图/视频/BGM）的竞品。
分工原则：**检测用脚本，解读用 agent**。不要自己编数据；所有数字、版本、日期必须来自 inbox 或你实际打开的网页。

**关注重心：多模态。** 本周报优先关注会**生成或播放视频、图像、语音、音乐**的竞品（competitors.json 里 `modality` 含 video/voice/music/image 且 tier=core）。
纯文字的互动小说、AI 陪伴聊天（modality=["text"]，tier=adjacent）只在有重大动作时提一句：融资、换赛道、榜单异动、或开始上多模态能力。
判定新候选同理：**不生成画面或声音的，一律 ignore 或 watch，不要 promote**。看到纯文字产品开始加图像/视频/配音，这本身就是值得报的信号。

## 步骤

1. `node ~/cinema-radar/fetch.mjs`，读 `data/inbox.json`。`errors` 非空时在日报末尾「运行状况」里列出。
2. **逐条处理 events**（按 priority：high → medium → low）：
   - `version`：读更新说明；说明太空（"bug fixes"）且是 core 竞品时，对比 `screenshots`/描述看有没有实质变化，没有就一句话带过。
   - `screenshots`：用 Read 看新增截图（先 curl 到 scratchpad），说明商店页主推卖点变成了什么。截图直接嵌进日报。
   - `description`：对比 before/after，只报新增的卖点。
   - `rank`：只报进入/跌出榜单、或变动 ≥15 名的。
   - `reviews`：挑有信息量的（具体功能抱怨/夸奖），1-2 句概括，不整段搬。
   - `yt_official` / `yt_mention`：看标题判断是否真相关（同名撞车直接丢），相关的附缩略图 `https://i.ytimg.com/vi/<id>/hqdefault.jpg` + 链接。
   - `discovery`：条目里 `rich=true` 的（描述含视频/画面/配音等信号）优先看。判定 promote（多模态直接竞品，加进 competitors.json，**必须写 `modality` 字段**）/ watch（有点关系但不是多模态）/ ignore（纯短剧平台、纯文字陪伴聊天、工具类）。写进 `data/insights.json.candidates`。
   - `discovery_old`：老 app 新出现在搜索里，一般 ignore，除非明显同类。
3. **网页搜索补充**（每天必做，控制在 6 次以内）：
   - `AI interactive drama app` / `interactive film AI` 近一周新闻；`AI互动剧` / `AI互动影游` 近一周新闻
   - 对 core 竞品中本周有事件的，搜一次其名字 + news/融资
   - Reddit 被脚本拦截，用 WebSearch `site:reddit.com <竞品名>` 看口碑
4. **小红书**（用 Claude in Chrome，用户已登录）：
   - 打开 `https://www.xiaohongshu.com/search_result?keyword=<词>&sort=time_descending`，词来自 inbox.xhs（general + 各竞品）。
   - 用 `javascript_tool` 读 `section.note-item`（标题、作者、点赞、链接、封面图）。
   - 未登录（出现扫码弹窗）→ 不要尝试登录，周报里注明「小红书未登录」，并发通知提醒用户扫码。
   - 只收录上期之后、与 AI 互动剧/影游相关的笔记，挑 3-8 条写进 `insights.json.xhs`（date/title/author/likes/url/image/note），周报里配封面图。
   - 从笔记里看到的新产品名 → 当作候选新竞品处理。
5. 更新 `data/insights.json` 里受影响竞品的 `oneLiner`（定位变了才改）。
6. 写 `digests/YYYY-MM-DD.md`（格式见下），然后 `node ~/cinema-radar/report.mjs`。
7. `cd ~/cinema-radar && git add -A && git commit -qm "weekly $(date +%F)" && git push`（remote 是私有仓库 Cupid0320/cinema-radar）。
8. `node ~/cinema-radar/notify.mjs` 推飞书（.env 里有 FEISHU_WEBHOOK 才会发；没配就跳过）。
9. 若有 high 优先级事件，发一条桌面通知：一句话说最重要的事。

## 日报格式（中文，短）

```
# 互动影院竞品周报 · YYYY-MM-DD

> 覆盖 <上期日期> – <本期日期>

> **本周三件事**（1-3 条，一句话一条；没事就写「本周无重要动态」）

## 一、竞品动态
### <竞品>：<一句话标题>
![截图](url)
- **发生了什么**：…
- **对我们**：…（结合 Tipsy 互动影院：Director 生成决策、封控/生成失败体验、9:16、海外付费）
来源：[..](..)

## 二、新发现
（promote 的用表格：产品 | 市场 | 一句话 | 为什么值得追；watch 的一行带过）

## 三、口碑 & 小红书
## 运行状况（仅有 errors 时）
```

规则：没有变化的竞品不写；同一件事不跨期重复报（查上一期 digest）；每条「对我们」必须具体，不写空话。
跨期较长（如休假）时不用缩短窗口——所有变化都是与上次快照比对得出的，不会漏。
