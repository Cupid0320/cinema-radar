# 服务器部署说明（给研发）

这套系统分两层，**可部署性完全不同**，请先看这张表再决定部署范围。

| 层 | 是什么 | 服务器上能跑吗 |
|---|---|---|
| 抓取层 `fetch.mjs` | 纯 Node，无依赖。抓 App Store / YouTube，比对出变化，写 `data/inbox.json` | ✅ 可以 |
| 渲染层 `report.mjs` | 纯 Node。把数据和周报渲染成单文件 `site/index.html` | ✅ 可以 |
| 推送层 `notify.mjs` | 纯 Node。POST 到飞书群机器人 webhook | ✅ 可以 |
| **解读层**（写周报） | 由 Claude 按 `task/SKILL.md` 解读变化、查新闻、写中文周报 | ⚠️ 需要 Claude Code headless + 密钥，见下 |
| 小红书 | 需要登录态，只能在人的浏览器里跑 | ❌ 服务器上做不了 |

## 环境要求

- **Node 20+**（用了 `??=`、顶层 await、原生 fetch）
- **必须能直连 itunes.apple.com、apps.apple.com、www.youtube.com**。
  国内机房访问 YouTube 会失败，`fetch.mjs` 会在 `errors` 里报错但不会崩。
  **建议用海外轻量服务器**（1C1G 足够，整个流程峰值内存 < 200MB）。
- 磁盘：仓库每周增长约 1–2MB（主要是 `data/apps/*.json` 的历史记录）。
- 一次完整抓取约 2 分钟，约 150 个 HTTP 请求，脚本内已有节流（每个 YouTube 请求间隔 800ms）。

## 方案 A：服务器只跑脚本层（推荐先这样）

服务器每周抓数据、渲染看板、推飞书；**周报正文仍由 Nam 本机的 Claude 定时任务生成**。
好处是零密钥、零 AI 成本，风险最低。

```bash
git clone git@github.com:Cupid0320/cinema-radar.git /opt/cinema-radar
cd /opt/cinema-radar && cat > .env <<'EOF'
FEISHU_WEBHOOK=<飞书群机器人 webhook，找 Nam 要>
CINEMA_RADAR_URL=<如果把 site/ 挂到 nginx，填这个地址>
EOF
```

crontab（每周一 09:30，按服务器时区调整）：

```cron
30 9 * * 1 cd /opt/cinema-radar && git pull -q && /usr/bin/node fetch.mjs >> logs/fetch.log 2>&1 && /usr/bin/node report.mjs && git add -A && git commit -qm "server fetch $(date +\%F)" && git push -q
```

⚠️ **同一份仓库不要两处同时写**。如果服务器开始跑 `fetch.mjs`，就把 Nam 本机那边的抓取关掉，本机只负责 `git pull` 后写周报再 push，否则 `data/state.json` 会冲突。

## 方案 B：服务器跑全流程（含写周报）

需要在服务器上装 Claude Code 并以无界面模式执行任务说明：

```bash
npm i -g @anthropic-ai/claude-code
export ANTHROPIC_API_KEY=<公司申请的 key>
cd /opt/cinema-radar && claude -p "$(cat task/SKILL.md)" --permission-mode acceptEdits
```

注意事项：

1. **要公司出一个 Anthropic API key**，按量计费。单次运行主要成本在读取抓取结果和写周报，量不大，但需要有预算归属。
2. `task/SKILL.md` 里有一步是用 Claude in Chrome 刷小红书，**服务器上必然失败**。要么在服务器版的任务说明里删掉第 4 步，要么让它检测不到浏览器就跳过。
3. 质量会比本机交互式略不稳定，建议前两周人工抽查周报内容。

## 数据与密钥

- `.env` **不在仓库里**（`.gitignore` 已排除），webhook 要单独给研发。
- 仓库里没有任何密钥，全部是公开数据和分析文本。
- `data/state.json` 是去重基线（已见过的视频和候选 app），**删了会导致下一期误报一大堆"新发现"**，不要清。

## 排错

- `fetch.mjs` 的输出会打印 `errors=N` 并逐条列出。常见：
  - `youtube ... parsed 0 / HTTP 429`：IP 被限流或网络不通，不影响其他部分。
  - `chart ...`：Apple 榜单接口偶发 5xx，下一期会自动补上。
  - `reviews ...`：App Store 网页改版，需要更新 `fetch.mjs` 里 `reviews()` 的正则。
- 各数据源的已知坑见 `README.md` 的「已知的坑」。
