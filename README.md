# Cinema Radar · 互动影院竞品雷达

每周追踪 Tipsy 互动影院的竞品：**出了什么新功能 / 新剧、榜单怎么变、用户怎么说、有没有新竞品冒出来**，产出中文周报 + 看板。

## 设计原则

**检测用脚本，解读用 agent**（沿用 ~/ai-radar）。脚本负责确定性地抓取和比对，保证不漏不编；
agent 只负责看变化、判断意义、写日报。

## 文件

| 文件 | 作用 |
|---|---|
| `competitors.json` | 追踪名单（core 直接竞品 / adjacent 相邻），App Store id、YouTube 频道、小红书搜索词 |
| `discovery.json` | 新竞品发现：App Store 关键词、分类榜、小红书通用词、ignore 名单 |
| `fetch.mjs` | 抓取 + 比对 → `data/inbox.json`（事件列表 + 快照） |
| `report.mjs` | `data/` + `digests/` → `site/index.html` 单文件看板 |
| `data/apps/<key>.json` | 每个竞品的版本史、每日评分/排名、截图、评论指纹 |
| `data/insights.json` | agent 策展：一句话定位、候选新竞品、小红书笔记 |
| `data/state.json` | 已见过的视频/候选 app（去重），上次运行时间 |
| `digests/` | 每期周报 Markdown |
| `notify.mjs` | 把最新一期摘要推到飞书群机器人 |
| `task/SKILL.md` | 每期 agent 任务说明（定时任务读这个） |

## 数据源与检测方式

| 维度 | 来源 | 方式 |
|---|---|---|
| 版本 / 功能 | iTunes Lookup API（版本、更新说明、**商店截图**、描述） | 脚本比对，截图变化=卖点变化 |
| 市场 | iTunes 分类榜 RSS（美区/国区，免费+畅销 Top100） | 脚本，每日记录排名 |
| 口碑 | App Store 网页内嵌评论；Reddit（WebSearch） | 脚本抓指纹 + agent 概括 |
| 视频 | YouTube 频道页 / 搜索页（解析 ytInitialData） | 脚本 + agent 过滤 |
| 新竞品 | App Store 关键词搜索 + 分类榜名字匹配；网页搜索；小红书 | 脚本 + agent 甄别 |
| 小红书 | Claude in Chrome（用用户的登录态） | agent |

## 命令

```bash
node ~/cinema-radar/fetch.mjs     # 抓取，约 2 分钟
node ~/cinema-radar/report.mjs    # 渲染看板
open ~/cinema-radar/site/index.html
```

## 已知的坑

- **iTunes 评论 RSS 已失效**（返回空 feed），改为解析 `apps.apple.com` 网页里的内嵌 JSON，只能拿到页面展示的约 8 条。
- **YouTube 频道 RSS 返回 404**，改为解析频道页/搜索页的 `ytInitialData`。YouTube 改版时 `ytItems()` 可能返回空。
- **Reddit 对脚本返回 403**，交给 agent 用 WebSearch。
- **小红书必须登录**才能看搜索结果；只能走 Claude in Chrome，且登录（扫码）必须用户本人做。
- 名字撞车：InPlay（足球交易/电视）、Yoroll（综艺）。YouTube 提及搜索要求标题同时含品类词，且只看近几周。
- 分类榜发现会带进大量纯短剧平台（ReelShort、DramaBox…），agent 应标记 ignore。
- 大陆很多产品是网页/小程序/抖音内（腾讯探梦、番茄互动剧、芒果），没有 App Store 页，只能靠网页搜索和小红书。

## 部署（后续）

- 公开链接：暂不部署（2026-10-17 决定）。需要时：`npx surge ~/cinema-radar/site cinema-radar-nam.surge.sh`
- 飞书：`node notify.mjs`。在飞书群里添加「自定义机器人」拿到 webhook，写进 `.env`：
  ```
  FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxxx
  CINEMA_RADAR_URL=https://cinema-radar-nam.surge.sh
  ```
  `node notify.mjs --dry` 可先看卡片 JSON 不发送。
- 服务器：见 [DEPLOY.md](DEPLOY.md)（给研发的部署说明，含环境要求、cron、两种方案和排错）
