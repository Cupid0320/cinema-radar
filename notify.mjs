#!/usr/bin/env node
// 把最新一期日报的摘要推到飞书群机器人。
// 用法：FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx node notify.mjs [--dry]
// 也可把 FEISHU_WEBHOOK 写进 .env（不进 git）。看板地址放 CINEMA_RADAR_URL。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ||= m[2].replace(/^["']|["']$/g, '');
  }
}
const hook = process.env.FEISHU_WEBHOOK;
const siteUrl = process.env.CINEMA_RADAR_URL || '';
const DRY = process.argv.includes('--dry');
if (!hook && !DRY) { console.error('缺少 FEISHU_WEBHOOK（写进 .env 或用环境变量）'); process.exit(1); }

const file = readdirSync(join(ROOT, 'digests')).filter(f => f.endsWith('.md')).sort().pop();
const md = readFileSync(join(ROOT, 'digests', file), 'utf8');
const date = file.replace('.md', '');

// 取开头引用块里的要点（> 开头的行），再数一下各板块条数
const lead = md.split('\n').filter(l => l.startsWith('>')).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
const bullets = lead.filter(l => /^\d\./.test(l)).map(l => l.replace(/^\d\.\s*/, '').replace(/\*\*/g, ''));
const scope = lead.find(l => l.startsWith('覆盖')) || '';
const sections = (md.match(/^### .*/gm) || []).map(h => h.replace(/^###\s*/, '').split('：')[0]);

const text = [
  `**互动影院竞品${md.includes('周报') ? '周报' : '日报'} · ${date}**`,
  scope && `_${scope}_`,
  '',
  ...bullets.map((b, i) => `**${i + 1}.** ${b}`),
  '',
  sections.length ? `本期涉及：${[...new Set(sections)].slice(0, 8).join('、')}` : '',
  siteUrl ? `\n[打开完整看板](${siteUrl})` : '\n完整日报：`~/cinema-radar/site/index.html`',
].filter(Boolean).join('\n');

const card = {
  msg_type: 'interactive',
  card: {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `互动影院竞品雷达 · ${date}` }, template: 'red' },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }],
  },
};

if (DRY) { console.log(JSON.stringify(card, null, 2)); process.exit(0); }
const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(card) });
const body = await r.text();
console.log(r.ok && !body.includes('"code":1') ? `已推送 ${date} 到飞书` : `推送失败：${body}`);
