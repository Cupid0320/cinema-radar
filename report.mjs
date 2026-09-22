#!/usr/bin/env node
// 把 data/ 和 digests/ 渲染成单文件看板 site/index.html（无外部依赖，可直接 Surge 部署）。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const readJSON = (p, d) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const { competitors } = readJSON(join(ROOT, 'competitors.json'));
const insights = readJSON(join(ROOT, 'data', 'insights.json'), { competitors: {}, candidates: [], xhs: [] });
const apps = Object.fromEntries(competitors.map(c => [c.key, readJSON(join(ROOT, 'data', 'apps', `${c.key}.json`), null)]));
const digests = existsSync(join(ROOT, 'digests')) ? readdirSync(join(ROOT, 'digests')).filter(f => f.endsWith('.md')).sort().reverse() : [];

// 极简 Markdown：标题/列表/引用/图片/链接/粗体/分隔线/段落，够日报用
function md(src) {
  const inline = s => esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null, para = [];
  const flush = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of src.split('\n')) {
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if (/^---+$/.test(line.trim())) { flush(); out.push('<hr>'); continue; }
    if ((m = line.match(/^>\s?(.*)/))) { // 连续引用行合并成一个块
      flush();
      const last = out.at(-1);
      if (last?.startsWith('<blockquote>')) out[out.length - 1] = last.replace('</blockquote>', `<br>${inline(m[1])}</blockquote>`);
      else out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      continue;
    }
    if ((m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/))) {
      if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; }
      const tag = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      if (list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if (/^\s*\|/.test(line)) { // 表格
      flush();
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) continue;
      const last = out.at(-1);
      const row = `<tr>${cells.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`;
      if (last?.endsWith('</table>')) out[out.length - 1] = last.replace('</table>', row + '</table>');
      else out.push(`<table>${row}</table>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    para.push(line);
  }
  flush();
  return out.join('\n');
}

function spark(values) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v), w = 120, h = 28;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (max === min ? h / 2 : (x - min) / (max - min) * (h - 4))).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

const chartName = k => k.replace('us/', '美区 ').replace('cn/', '国区 ').replace('/free', ' 免费榜').replace('/grossing', ' 畅销榜')
  .replace('Entertainment', '娱乐').replace('Book', '图书').replace('Games', '游戏').replace('Social', '社交').replace('Lifestyle', '生活');

function card(c) {
  const a = apps[c.key], ins = insights.competitors[c.key] || {};
  const last = a?.history.at(-1);
  const ranks = Object.entries(last?.ranks || {}).sort((x, y) => x[1] - y[1]).map(([k, r]) => `<span class="rank">${chartName(k)} <b>#${r}</b></span>`).join('');
  const shots = (a?.screenshots || []).slice(0, 6).map(s => `<a href="${esc(s)}" target="_blank"><img src="${esc(s)}" loading="lazy" alt=""></a>`).join('');
  const vers = (a?.versions || []).slice(0, 3).map(v => `<li><b>${esc(v.version)}</b> <span class="muted">${esc(v.date)}</span><div class="notes">${esc(v.notes).slice(0, 280) || '<span class="muted">（无更新说明）</span>'}</div></li>`).join('');
  const vids = (ins.videos || []).slice(0, 3).map(v => `<a class="vid" href="${esc(v.url)}" target="_blank"><img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" loading="lazy" alt=""><span>${esc(v.title)}</span></a>`).join('');
  return `<article class="card ${c.tier}" data-market="${c.market.startsWith('大陆') ? 'cn' : 'global'}" data-tier="${c.tier}">
  <header>
    ${a?.meta?.icon ? `<img class="icon" src="${esc(a.meta.icon)}" alt="">` : `<div class="icon ph">${esc(c.name[0])}</div>`}
    <div><h3>${a?.meta?.url ? `<a href="${esc(a.meta.url)}" target="_blank">${esc(c.name)}</a>` : c.site ? `<a href="${esc(c.site)}" target="_blank">${esc(c.name)}</a>` : esc(c.name)}</h3>
    <div class="tags"><span class="tag t-${c.tier}">${c.tier === 'core' ? '直接竞品' : '相邻'}</span><span class="tag">${esc(c.market)}</span>${a?.meta?.released ? `<span class="tag">上架 ${esc(a.meta.released)}</span>` : ''}</div></div>
  </header>
  ${ins.oneLiner ? `<p class="one">${esc(ins.oneLiner)}</p>` : ''}
  ${last ? `<div class="stats"><div><small>版本</small><b>${esc(last.version)}</b></div><div><small>评分</small><b>${last.rating ?? '—'}</b></div><div><small>评分数</small><b>${last.ratingCount.toLocaleString()}</b>${spark(a.history.map(h => h.ratingCount))}</div></div>` : '<p class="muted small">无 App Store 页面：靠小红书与网页追踪</p>'}
  ${ranks ? `<div class="ranks">${ranks}</div>` : ''}
  ${shots ? `<div class="shots">${shots}</div>` : ''}
  ${vers ? `<details><summary>最近版本</summary><ul class="vers">${vers}</ul></details>` : ''}
  ${vids ? `<div class="vids">${vids}</div>` : ''}
</article>`;
}

const candRows = (insights.candidates || []).filter(x => x.verdict === 'watch' || x.verdict === 'promote').map(x => `<li class="cand">
  ${x.icon ? `<img src="${esc(x.icon)}" alt="">` : ''}<div><a href="${esc(x.url)}" target="_blank"><b>${esc(x.name)}</b></a> <span class="tag">${x.country === 'cn' ? '国区' : '美区'}</span>${x.verdict === 'promote' ? '<span class="tag t-core">建议纳入追踪</span>' : ''} <span class="muted small">发现于 ${esc(x.date)}</span><div class="small">${esc(x.note)}</div></div></li>`).join('');

const xhsRows = (insights.xhs || []).slice(0, 30).map(x => `<a class="xhs" href="${esc(x.url)}" target="_blank">${x.image ? `<img src="${esc(x.image)}" loading="lazy" alt="">` : ''}<div><b>${esc(x.title)}</b><div class="small muted">${esc(x.author || '')} · ${esc(x.likes || '')} · ${esc(x.date)}</div><div class="small">${esc(x.note || '')}</div></div></a>`).join('');

const digestTabs = digests.map((f, i) => `<button class="dtab${i ? '' : ' on'}" data-d="${i}">${f.replace('.md', '')}</button>`).join('');
const digestBodies = digests.map((f, i) => `<div class="digest${i ? '' : ' on'}" data-d="${i}">${md(readFileSync(join(ROOT, 'digests', f), 'utf8'))}</div>`).join('');
const ordered = [...competitors].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'core' ? -1 : 1));

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>互动影院竞品雷达</title>
<style>
:root{--bg:#f6f5f2;--panel:#fff;--ink:#1c1b19;--muted:#77736b;--line:#e6e2da;--accent:#b4452f;--accent-soft:#f6e3dd;--chip:#efece6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121110;--panel:#1c1b19;--ink:#ecebe7;--muted:#9a958c;--line:#2e2c29;--accent:#e2765d;--accent-soft:#3a231d;--chip:#282623}}
:root[data-theme="dark"]{--bg:#121110;--panel:#1c1b19;--ink:#ecebe7;--muted:#9a958c;--line:#2e2c29;--accent:#e2765d;--accent-soft:#3a231d;--chip:#282623}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang SC","Helvetica Neue",sans-serif}
a{color:inherit}main{max-width:1180px;margin:0 auto;padding:28px 16px 80px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}.sub{color:var(--muted);margin:0 0 28px}
h2.sec{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:40px 0 14px;border-top:1px solid var(--line);padding-top:18px}
.muted{color:var(--muted)}.small{font-size:13px}
.dtabs{display:flex;gap:6px;overflow-x:auto;margin-bottom:10px}.dtab{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:4px 12px;font-size:13px;cursor:pointer;white-space:nowrap}.dtab.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.digest{display:none;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:8px 26px 20px}.digest.on{display:block}
.digest h2{font-size:21px;margin:22px 0 8px}.digest h3{font-size:19px;margin:30px 0 6px;color:var(--accent)}.digest h4{font-size:17px;margin:26px 0 8px}
.digest img{max-height:340px;max-width:100%;border-radius:10px;margin:6px 6px 0 0;border:1px solid var(--line);vertical-align:top}
.digest blockquote{margin:8px 0;padding:6px 14px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 8px 8px 0}
.digest table{border-collapse:collapse;font-size:13px;margin:10px 0;display:block;overflow-x:auto}.digest td{border:1px solid var(--line);padding:5px 9px;vertical-align:top}.digest tr:first-child td{font-weight:600;background:var(--chip)}
.filters{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}.card.core{border-top:3px solid var(--accent)}
.card header{display:flex;gap:12px;align-items:center}.card h3{margin:0;font-size:16px}.card h3 a{text-decoration:none}
.icon{width:48px;height:48px;border-radius:12px;flex:none;border:1px solid var(--line)}.icon.ph{display:grid;place-items:center;background:var(--chip);font-weight:700}
.tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}.tag{font-size:11px;background:var(--chip);border-radius:5px;padding:1px 6px;color:var(--muted);margin-left:4px}.tags .tag{margin:0}.t-core{background:var(--accent-soft);color:var(--accent)}
.one{margin:10px 0 0;font-size:13.5px}
.stats{display:flex;gap:18px;margin-top:12px}.stats small{display:block;color:var(--muted);font-size:11px}.stats b{font-size:15px}.spark{display:block;color:var(--accent);margin-top:2px}
.ranks{margin-top:10px;display:flex;flex-wrap:wrap;gap:4px}.rank{font-size:12px;background:var(--chip);border-radius:6px;padding:2px 7px}
.shots{display:flex;gap:6px;overflow-x:auto;margin-top:12px;padding-bottom:4px}.shots img{height:150px;border-radius:8px;border:1px solid var(--line)}
details{margin-top:10px;font-size:13px}summary{cursor:pointer;color:var(--muted)}.vers{padding-left:16px;margin:6px 0}.notes{white-space:pre-wrap;color:var(--muted);font-size:12.5px}
.vids{display:grid;gap:6px;margin-top:10px}.vid{display:flex;gap:8px;text-decoration:none;font-size:12.5px;align-items:center}.vid img{width:96px;border-radius:6px;flex:none}
.cands{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}.cand{display:flex;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}.cand img{width:40px;height:40px;border-radius:10px;flex:none}
.xhsg{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.xhs{display:flex;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;text-decoration:none}.xhs img{width:72px;height:96px;object-fit:cover;border-radius:8px;flex:none}
@media (max-width:420px){.grid{grid-template-columns:1fr}.digest{padding:4px 14px 14px}}
</style></head><body><main>
<h1>互动影院竞品雷达</h1>
<p class="sub">追踪 ${competitors.length} 个竞品（${competitors.filter(c => c.tier === 'core').length} 个直接竞品）· 更新于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>

<h2 class="sec">日报</h2>
${digests.length ? `<div class="dtabs">${digestTabs}</div>${digestBodies}` : '<p class="muted">还没有日报。</p>'}

<h2 class="sec">竞品一览</h2>
<div class="filters"><button class="dtab on" data-f="all">全部</button><button class="dtab" data-f="core">直接竞品</button><button class="dtab" data-f="global">海外</button><button class="dtab" data-f="cn">大陆</button></div>
<div class="grid">${ordered.map(card).join('\n')}</div>

${xhsRows ? `<h2 class="sec">小红书动态</h2><div class="xhsg">${xhsRows}</div>` : ''}
${candRows ? `<h2 class="sec">新竞品候选</h2><ul class="cands">${candRows}</ul>` : ''}
</main>
<script>
document.querySelectorAll('.dtabs .dtab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.dtabs .dtab,.digest').forEach(e=>e.classList.toggle('on',e.dataset.d===b.dataset.d))});
document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-f]').forEach(x=>x.classList.toggle('on',x===b));const f=b.dataset.f;
document.querySelectorAll('.card').forEach(c=>c.style.display=(f==='all'||c.dataset.tier===f||c.dataset.market===f)?'':'none')});
</script></body></html>`;

writeFileSync(join(ROOT, 'site', 'index.html'), html);
console.log(`site/index.html  (${(html.length / 1024).toFixed(0)} KB, ${digests.length} 份日报)`);
