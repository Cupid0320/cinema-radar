#!/usr/bin/env node
// cinema-radar: 确定性抓取 + 变化检测。这一层不用 LLM —— 保证不漏、不编。
// 解读（这次更新意味着什么、对我们有何启发）交给上层 agent。
//
// 输出 data/inbox.json：本次检测到的所有事件 + 各竞品当前快照，供 agent 写日报。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const TODAY = new Date().toISOString().slice(0, 10);
const readJSON = (p, d) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d;
const writeJSON = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { competitors } = readJSON(join(ROOT, 'competitors.json'));
const discovery = readJSON(join(ROOT, 'discovery.json'));
const statePath = join(ROOT, 'data', 'state.json');
const state = readJSON(statePath, { discoverySeen: {}, videosSeen: {} });
const FIRST_RUN = !state.lastRunAt;

const events = [];
const errors = [];
const emit = (e) => events.push({ date: TODAY, ...e });

async function get(url, { json = false, lang = 'en-US' } = {}) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': lang }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return json ? await r.json() : await r.text();
    } catch (e) { if (i) throw e; await sleep(1500); }
  }
}

// ---------- App Store ----------
async function lookup(country, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const d = await get(`https://itunes.apple.com/lookup?id=${ids.slice(i, i + 50).join(',')}&country=${country}`, { json: true });
    for (const r of d.results) out[r.trackId] = r;
  }
  return out;
}

// iTunes 评论 RSS 已失效（返回空），改从 App Store 网页内嵌 JSON 抓展示中的评论。
async function reviews(country, id) {
  const html = await get(`https://apps.apple.com/${country}/app/id${id}`, { lang: country === 'cn' ? 'zh-CN' : 'en-US' });
  const seen = new Set(), out = [];
  for (const m of html.matchAll(/"contents":"((?:[^"\\]|\\.)*)","rating":(\d)/g)) {
    const text = JSON.parse(`"${m[1]}"`);
    const h = hash(text);
    if (!seen.has(h)) { seen.add(h); out.push({ h, text: text.slice(0, 600), rating: +m[2] }); }
  }
  return out;
}

async function charts() {
  const ranks = {}; // trackId -> { "us/Entertainment/free": 12 }
  const listed = []; // 所有上榜 app，给新竞品发现用
  for (const [country, genres] of Object.entries(discovery.charts)) {
    for (const [gname, gid] of Object.entries(genres)) {
      for (const kind of ['free', 'grossing']) {
        const feed = kind === 'free' ? 'topfreeapplications' : 'topgrossingapplications';
        try {
          const d = await get(`https://itunes.apple.com/${country}/rss/${feed}/limit=100/genre=${gid}/json`, { json: true });
          (d.feed.entry || []).forEach((e, i) => {
            const id = +e.id.attributes['im:id'];
            (ranks[id] ||= {})[`${country}/${gname}/${kind}`] = i + 1;
            listed.push({ id, country, name: e['im:name'].label, chart: `${country}/${gname}/${kind}`, rank: i + 1 });
          });
        } catch (e) { errors.push(`chart ${country}/${gname}/${kind}: ${e.message}`); }
      }
    }
  }
  return { ranks, listed };
}

// ---------- YouTube（官方 RSS 目前 404，改解析网页 ytInitialData） ----------
function ytItems(html) {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.videoRenderer?.videoId) {
      const v = o.videoRenderer;
      out.push({ id: v.videoId, title: v.title?.runs?.map(r => r.text).join('') || '', channel: v.ownerText?.runs?.[0]?.text || '', when: v.publishedTimeText?.simpleText || '', views: v.viewCountText?.simpleText || '' });
      return;
    }
    if (o.lockupViewModel?.contentId) {
      const l = o.lockupViewModel, md = l.metadata?.lockupMetadataViewModel;
      const parts = JSON.stringify(md?.metadata || {}).match(/"content":"([^"]*)"/g)?.map(s => s.slice(11, -1)) || [];
      out.push({ id: l.contentId, title: md?.title?.content || '', channel: parts[0] || '', when: parts.find(p => /ago|前/.test(p)) || '', views: parts.find(p => /view|次/.test(p)) || '' });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(m[1]));
  return out.filter(v => v.title);
}

const CATEGORY = /\bapp\b|\bai\b|story|stories|interactive|drama|trailer|review|gameplay|choice|互动|剧/i;
// 本项目关注多模态互动影院：会生成/播放视频、图像、语音、音乐的竞品优先。
const RICH = new Set(['video', 'voice', 'music']);
const isRich = c => (c.modality || []).some(m => RICH.has(m));
const prio = (c, high = 'high') => (c.tier === 'core' && isRich(c) ? high : c.tier === 'core' ? 'medium' : 'low');

// ---------- 主流程 ----------
const snapshots = {};
const { ranks, listed } = await charts();

for (const country of ['us', 'cn']) {
  const list = competitors.filter(c => c.appstore?.country === country);
  if (!list.length) continue;
  let info = {};
  try { info = await lookup(country, list.map(c => c.appstore.id)); } catch (e) { errors.push(`lookup ${country}: ${e.message}`); }

  for (const c of list) {
    const r = info[c.appstore.id];
    const p = join(ROOT, 'data', 'apps', `${c.key}.json`);
    const db = readJSON(p, { key: c.key, versions: [], history: [], reviews: [], screenshots: [], description: '' });
    if (!r) { errors.push(`${c.name}: App Store 查不到 (id ${c.appstore.id}，可能下架)`); snapshots[c.key] = { name: c.name, missing: true }; continue; }

    const shots = r.screenshotUrls || [];
    const appRanks = ranks[c.appstore.id] || {};
    const base = { key: c.key, name: c.name, tier: c.tier, market: c.market, modality: c.modality || [] };

    // 新版本
    if (!db.versions.find(v => v.version === r.version)) {
      const v = { version: r.version, date: (r.currentVersionReleaseDate || '').slice(0, 10), notes: r.releaseNotes || '' };
      db.versions.unshift(v);
      if (db.history.length) emit({ ...base, type: 'version', priority: prio(c), ...v });
    }
    // 截图变化 = 商店页主推卖点变了，常常意味着新功能
    if (db.screenshots.length && hash(shots.join()) !== hash(db.screenshots.join())) {
      emit({ ...base, type: 'screenshots', priority: prio(c), added: shots.filter(s => !db.screenshots.includes(s)), before: db.screenshots });
    }
    // 描述改写
    if (db.description && db.description !== r.description) {
      emit({ ...base, type: 'description', priority: prio(c, 'medium'), before: db.description, after: r.description });
    }
    // 排名变化：新上榜 / 掉榜 / 变动 ≥15 名
    const prev = db.history.at(-1)?.ranks || {};
    for (const k of new Set([...Object.keys(prev), ...Object.keys(appRanks)])) {
      const a = prev[k], b = appRanks[k];
      if (!db.history.length) break;
      if (a && b && Math.abs(a - b) < 15) continue;
      if (a === b) continue;
      emit({ ...base, type: 'rank', priority: b && (!a || b < a) ? 'medium' : 'low', chart: k, from: a || null, to: b || null });
    }
    // 评论
    try {
      const revs = await reviews(country, c.appstore.id);
      const fresh = revs.filter(x => !db.reviews.includes(x.h));
      if (fresh.length && db.history.length) emit({ ...base, type: 'reviews', priority: 'low', items: fresh });
      if (!db.history.length) db.reviewSample = revs; // 首次：留一份样本给首期日报
      db.reviews = [...new Set([...db.reviews, ...revs.map(x => x.h)])];
    } catch (e) { errors.push(`reviews ${c.name}: ${e.message}`); }

    db.screenshots = shots;
    db.description = r.description;
    db.meta = { trackName: r.trackName, seller: r.sellerName, icon: r.artworkUrl512 || r.artworkUrl100, url: r.trackViewUrl, genre: r.primaryGenreName, price: r.formattedPrice, released: (r.releaseDate || '').slice(0, 10), country };
    const row = { date: TODAY, version: r.version, rating: r.averageUserRating ? +r.averageUserRating.toFixed(2) : null, ratingCount: r.userRatingCount || 0, ranks: appRanks };
    db.history = db.history.filter(h => h.date !== TODAY).concat(row);
    writeJSON(p, db);
    snapshots[c.key] = { ...base, ...db.meta, ...row, latestNotes: db.versions[0]?.notes || '', screenshots: shots, reviewSample: db.reviewSample };
  }
}

// YouTube：官方频道新视频 + 全站按名字搜索的新视频（第三方测评/宣传）
for (const c of competitors) {
  if (c.tier !== 'core' && !isRich(c)) continue; // 纯文字的相邻竞品不追 YouTube，噪音太大
  const jobs = [];
  for (const ch of c.youtube || []) jobs.push(['official', `https://www.youtube.com/channel/${ch}/videos`]);
  if (!c.market.startsWith('大陆')) jobs.push(['mention', `https://www.youtube.com/results?search_query=${encodeURIComponent(`"${c.name.split(':')[0]}" app`)}&sp=CAI%253D`]);
  for (const [kind, url] of jobs) {
    try {
      let items = ytItems(await get(url));
      if (kind === 'mention') {
        const n = c.name.split(':')[0].toLowerCase();
        // 同名撞车很多（InPlay 足球交易、Yoroll 综艺），要求标题同时带品类词；且只要近几周的视频
        items = items.filter(v => v.title.toLowerCase().includes(n) && CATEGORY.test(v.title) && !/month|year|月前|年前/.test(v.when));
      }
      const fresh = items.filter(v => !state.videosSeen[v.id]);
      fresh.forEach(v => state.videosSeen[v.id] = TODAY);
      if (fresh.length && !FIRST_RUN) emit({ key: c.key, name: c.name, tier: c.tier, market: c.market, modality: c.modality || [], type: kind === 'official' ? 'yt_official' : 'yt_mention', priority: kind === 'official' ? prio(c) : 'medium', items: fresh.slice(0, 8).map(v => ({ ...v, url: `https://www.youtube.com/watch?v=${v.id}`, thumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` })) });
      if (FIRST_RUN && items.length) (snapshots[c.key] ||= { key: c.key, name: c.name, tier: c.tier, market: c.market }).videos = items.slice(0, 5).map(v => ({ ...v, url: `https://www.youtube.com/watch?v=${v.id}` }));
    } catch (e) { errors.push(`youtube ${c.name} ${kind}: ${e.message}`); }
    await sleep(800);
  }
}
for (const c of competitors) if (!snapshots[c.key]) snapshots[c.key] = { key: c.key, name: c.name, tier: c.tier, market: c.market, noAppStore: true, xhs: c.xhs };

// 新竞品发现：关键词搜索 + 分类榜上名字像同类的 app
const tracked = new Set([...competitors.map(c => c.appstore?.id).filter(Boolean), ...Object.keys(discovery.ignore || {}).map(Number)]);
const OK_GENRES = new Set(['Entertainment', 'Book', 'Games', 'Social Networking', 'Lifestyle', '娱乐', '图书', '游戏', '社交', '生活']);
const LOOKS_LIKE = /interactive|story|stories|drama|playable|roleplay|role-play|saga|tale|互动|剧|故事|影游|穿书/i;
const candidates = new Map();
for (const [country, kws] of Object.entries(discovery.keywords)) {
  for (const kw of kws) {
    try {
      const d = await get(`https://itunes.apple.com/search?term=${encodeURIComponent(kw)}&country=${country}&entity=software&limit=25`, { json: true });
      for (const r of d.results) {
        if (tracked.has(r.trackId) || !OK_GENRES.has(r.primaryGenreName)) continue;
        if (!candidates.has(r.trackId)) candidates.set(r.trackId, { id: r.trackId, country, name: r.trackName, seller: r.sellerName, genre: r.primaryGenreName, ratingCount: r.userRatingCount || 0, released: (r.releaseDate || '').slice(0, 10), updated: (r.currentVersionReleaseDate || '').slice(0, 10), url: r.trackViewUrl, icon: r.artworkUrl100, desc: (r.description || '').slice(0, 300), via: [] });
        candidates.get(r.trackId).via.push(`搜索「${kw}」`);
      }
    } catch (e) { errors.push(`search ${country} ${kw}: ${e.message}`); }
    await sleep(400);
  }
}
for (const l of listed) {
  if (tracked.has(l.id) || !LOOKS_LIKE.test(l.name)) continue;
  const c = candidates.get(l.id) || { id: l.id, country: l.country, name: l.name, via: [] };
  c.via.push(`${l.chart} #${l.rank}`);
  candidates.set(l.id, c);
}
// 近半年上架的才算「新竞品」；老 app 新出现在搜索结果里只做低优先级提示。首次运行全部记为已见，只把近半年的交给 agent 甄别。
const RECENT = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
const newCands = [...candidates.values()].filter(c => !state.discoverySeen[c.id]);
newCands.forEach(c => state.discoverySeen[c.id] = TODAY);
const recent = newCands.filter(c => !c.released || c.released >= RECENT || c.via.some(v => v.includes('#')));
const older = newCands.filter(c => !recent.includes(c));
const RICH_HINT = /video|cinematic|film|movie|voice|animated|scene|配音|语音|影像|视频|影游|实拍|画面/i;
recent.forEach(c => c.rich = RICH_HINT.test(`${c.name} ${c.desc || ''}`));
if (recent.length) emit({ type: 'discovery', priority: 'medium', items: recent.sort((a, b) => (b.rich ? 1 : 0) - (a.rich ? 1 : 0)) });
if (older.length && !FIRST_RUN) emit({ type: 'discovery_old', priority: 'low', items: older });

state.lastRunAt = new Date().toISOString();
writeJSON(statePath, state);
const inbox = { runAt: state.lastRunAt, firstRun: FIRST_RUN, events, snapshots, errors, xhs: { perCompetitor: Object.fromEntries(competitors.filter(c => c.xhs).map(c => [c.key, c.xhs])), general: discovery.xhs_general } };
writeJSON(join(ROOT, 'data', 'inbox.json'), inbox);

const count = t => events.filter(e => e.type === t).length;
console.log(`${FIRST_RUN ? '[首次运行·建立基线] ' : ''}events=${events.length} version=${count('version')} screenshots=${count('screenshots')} rank=${count('rank')} yt=${count('yt_official') + count('yt_mention')} discovery=${newCands.length} errors=${errors.length}`);
errors.forEach(e => console.log('  ! ' + e));
