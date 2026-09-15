/* kaji-quest — GitHub Pages 上で動く 1 画面アプリ（フレームワーク無し）
 *
 * 読み: data/routines.json, data/config.json（デプロイ時に routines/*.yml と config.yml から生成）
 *       logs/YYYY/MM.jsonl（GitHub Contents API。公開リポジトリなのでトークン無しでも読める）
 * 書き: logs/YYYY/MM.jsonl に 1 行追記（GitHub Contents API）。Contents: Read and write の
 *       fine-grained token を ⚙ から保存する。トークンはこの端末の localStorage にだけ置く。
 */
'use strict';

const API = 'https://api.github.com';
const TOKEN_KEY = 'kq_token';
const TZ = 'Asia/Tokyo';
const LOAD = { physical: { 1: 0, 2: 0.1, 3: 0.2 }, mental: { 1: 0, 2: 0.15, 3: 0.3 }, time_bound: { 0: 0, 1: 0.1, 2: 0.2 } };
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
const DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const AREA_JA = { dishes: '洗い物', cooking: '料理', cleaning: '掃除', childcare: '育児', nameless: '名もなき家事' };
const MOODS = ['😩', '😕', '😐', '🙂', '😄'];
const COUNTED = new Set(['done', 'partial', 'passed']);   // ストリークに数える status
const EARNED = new Set(['done', 'partial']);              // 換算時間に数える status

const PLACES = ['キッチン', '風呂・洗面・トイレ', 'リビング・寝室', '玄関・ベランダ', '家電', '子ども用品', 'その他'];
const BIG_DAYS = 30;                                      // 目安がこれ以上の項目は「大物」枠に 1 件出す
const TIP_INTERVALS = [1, 3, 7, 30, 90];                  // コツの間隔反復（§9.2）。実践するたび次の段へ、しなければ 1 段戻る

const state = { routines: [], config: {}, token: '', months: new Map(), streak: 0, busy: false, showMenu: false, tips: [], tipOffset: 0, showTips: false };

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');   // 太字と改行だけの最小 Markdown

// ---- 日付（すべて JST の暦日で扱う。端末のタイムゾーンに依存しない） ----
function nowParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, iso: `${date}T${p.hour}:${p.minute}:${p.second}+09:00` };
}
const toUTC = ds => new Date(ds + 'T00:00:00Z');
const fmtDate = d => d.toISOString().slice(0, 10);
const addDays = (ds, n) => fmtDate(new Date(toUTC(ds).getTime() + n * 86400000));
const dowOf = ds => toUTC(ds).getUTCDay();
const mondayOf = ds => addDays(ds, -((dowOf(ds) + 6) % 7));
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const ymOf = ds => ds.slice(0, 4) + '/' + ds.slice(5, 7);
const monthStart = ym => ym.slice(0, 4) + '-' + ym.slice(5, 7) + '-01';
const jaDate = ds => `${+ds.slice(5, 7)}/${+ds.slice(8, 10)}（${DOW_JA[dowOf(ds)]}）`;
function monthsBetween(a, b) {
  const out = []; let y = +a.slice(0, 4), m = +a.slice(5, 7); const y2 = +b.slice(0, 4), m2 = +b.slice(5, 7);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}/${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

// ---- 負荷係数とスケジュール（docs/SPEC.md §5.1, §6.1） ----
const weightOf = r => { const l = r.load || {}; return round2(1 + (LOAD.physical[l.physical] ?? 0) + (LOAD.mental[l.mental] ?? 0) + (LOAD.time_bound[l.time_bound] ?? 0)); };
const weighted = (r, minutes) => round1(minutes * weightOf(r));
function cronDow(field, d) {
  if (!field || field === '*' || field === '?') return true;
  const num = t => { const i = DOW_EN.indexOf(String(t).toUpperCase()); return (i >= 0 ? i : Number(t)) % 7; };
  return field.split(',').some(part => {
    const [range, step] = part.split('/');
    let lo = 0, hi = 6;
    if (range !== '*') { const [a, b] = range.split('-'); lo = num(a); hi = b === undefined ? lo : num(b); }
    for (let x = lo; x <= hi; x += step ? Number(step) || 1 : 1) if (x === d) return true;
    return false;
  });
}
function dueToday(r, ds) {
  const s = r.schedule || {}; const d = dowOf(ds);
  if (s.type === 'daily') return true;
  if (s.type === 'cron') return cronDow((s.expr || '').trim().split(/\s+/)[4], d);
  if (s.type === 'weekly') return DOW_EN.indexOf(String(s.day || '').toUpperCase().slice(0, 3)) === d;
  return false;
}
function timeLabel(r) {
  const s = r.schedule || {};
  if (s.type === 'cron' && s.expr) { const [mi, h] = s.expr.trim().split(/\s+/); if (/^\d+$/.test(h) && /^\d+$/.test(mi)) return `${h.padStart(2, '0')}:${mi.padStart(2, '0')}`; }
  return s.time || '';
}

// ---- GitHub API（logs/YYYY/MM.jsonl の読み書き） ----
const repo = () => state.config.repo || {};
const branch = () => repo().branch || 'main';
function ghHeaders(json) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (state.token) h.Authorization = 'Bearer ' + state.token;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
const contentsUrl = ym => `${API}/repos/${repo().owner}/${repo().name}/contents/logs/${ym}.jsonl`;
const b64decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const b64encode = s => btoa(Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join(''));
const parseLine = l => { try { const e = JSON.parse(l); return e && typeof e === 'object' ? e : null; } catch { return null; } };

async function fetchMonth(ym) {
  const res = await fetch(`${contentsUrl(ym)}?ref=${encodeURIComponent(branch())}`, { headers: ghHeaders(false), cache: 'no-store' });
  if (res.status === 404) return { sha: null, lines: [] };
  if (res.status === 403 && !state.token) throw new Error('GitHub API の回数制限。⚙ でトークンを保存すると上限が上がる');
  if (!res.ok) throw new Error(`ログの取得に失敗（${res.status}）`);
  const j = await res.json();
  const text = j.content ? b64decode(j.content) : '';
  return { sha: j.sha, lines: text.split('\n').filter(l => l.trim()) };
}
async function ensureMonths(from, to) {
  const missing = monthsBetween(from, to).filter(ym => !state.months.has(ym));
  await Promise.all(missing.map(async ym => { state.months.set(ym, await fetchMonth(ym)); }));
}
function allEntries() {
  return [...state.months.keys()].sort().flatMap(ym => state.months.get(ym).lines.map(parseLine).filter(Boolean));
}
// 月ファイルを読み→変換→書き戻す。sha 競合（409/422）なら読み直して 1 回だけやり直す
async function mutateMonth(ym, fn, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = state.months.get(ym) || { sha: null, lines: [] };
    const lines = fn(cur.lines);
    const body = { message, content: b64encode(lines.length ? lines.join('\n') + '\n' : ''), branch: branch() };
    if (cur.sha) body.sha = cur.sha;
    const res = await fetch(contentsUrl(ym), { method: 'PUT', headers: ghHeaders(true), body: JSON.stringify(body) });
    if ((res.status === 409 || res.status === 422) && attempt === 0) { state.months.set(ym, await fetchMonth(ym)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error('トークンが無効か権限不足。Contents: Read and write が必要');
    if (res.status === 404) throw new Error('書き込めない。トークンの Repository access に kaji-quest が入っているか確認');
    if (!res.ok) throw new Error(`書き込みに失敗（${res.status}）`);
    const j = await res.json();
    state.months.set(ym, { sha: (j.content && j.content.sha) || null, lines });
    return;
  }
  throw new Error('競合が解消できなかった。↻ で更新してもう一度');
}

// ---- 集計（週次目標・ランプ・ストリーク） ----
const sumWeighted = (entries, a, b) => entries.reduce((s, e) => (e.date >= a && e.date <= b && EARNED.has(e.status)) ? s + (+e.weighted_minutes || 0) : s, 0);
function parseWeeks(s) {
  const m = String(s).trim().match(/^(\d+)(?:-(\d*))?$/);
  if (!m) return [1, Infinity];
  const a = +m[1]; return [a, m[2] === undefined ? a : (m[2] === '' ? Infinity : +m[2])];
}
function ramp() { const r = state.config.target && state.config.target.ramp; return Array.isArray(r) && r.length ? r : [{ weeks: '1-', ratio: 1 }]; }
function stageIndex(weekNo) { let idx = ramp().length - 1; ramp().forEach((st, i) => { const [a, b] = parseWeeks(st.weeks); if (weekNo >= a && weekNo <= b) idx = i; }); return idx; }
const ratioFor = (weekNo, penalty) => +ramp()[Math.max(0, stageIndex(weekNo) - penalty)].ratio || 1;
const startMonday = () => mondayOf(state.config.start_date || nowParts().date);
const weekNoOf = ds => Math.max(1, Math.floor(daysBetween(startMonday(), mondayOf(ds)) / 7) + 1);
const weekStartOf = n => addDays(startMonday(), (n - 1) * 7);
function targetInfo(today, entries) {
  const t = state.config.target || {}; const final = +t.final_weighted_minutes || 0; const after = +t.auto_downshift_after_miss || 0;
  const wn = weekNoOf(today); let penalty = 0, misses = 0;
  for (let w = 1; w < wn; w++) {                       // 過去の週を順に見て、連続未達なら 1 段階下げる（§6.3）
    const a = weekStartOf(w); const got = sumWeighted(entries, a, addDays(a, 6));
    if (got < final * ratioFor(w, penalty)) { misses++; if (after && misses >= after) { penalty++; misses = 0; } } else misses = 0;
  }
  const ratio = ratioFor(wn, penalty);
  return { weekNo: wn, ratio, target: Math.round(final * ratio), penalty };
}
// 「1日1つ以上の記録」が続いた日数。今日まだ無くても昨日までで数える。読込範囲の先頭まで続いていたら 1 か月さかのぼる
async function computeStreak(today) {
  let n = 0;
  for (let guard = 0; guard < 24; guard++) {
    const days = new Set(allEntries().filter(e => COUNTED.has(e.status)).map(e => e.date));
    let d = days.has(today) ? today : addDays(today, -1); n = 0;
    while (days.has(d)) { n++; d = addDays(d, -1); }
    const earliest = monthStart([...state.months.keys()].sort()[0]);
    if (d >= earliest) return n;
    const prev = addDays(earliest, -1);
    await ensureMonths(prev, prev);
    if (!state.months.get(ymOf(prev)).lines.length) return n;
  }
  return n;
}

// ---- 描画 ----
function render() {
  const today = nowParts().date; const entries = allEntries(); const todays = entries.filter(e => e.date === today);
  $('#today').textContent = jaDate(today);
  $('#streak').textContent = `🔥 ${state.streak}日`;
  $('#progress').innerHTML = progressHTML(today, entries);
  $('#tasks').innerHTML = tasksHTML(today, todays, entries);
  $('#menu').innerHTML = menuHTML(today, entries);
  $('#tip').innerHTML = tipHTML(today, entries);
  $('#quick').innerHTML = quickHTML(todays);
  $('#week').innerHTML = weekHTML(today, entries);
  $('#today-log').innerHTML = logHTML(todays);
  document.body.classList.toggle('busy', state.busy);
}
function progressHTML(today, entries) {
  const t = targetInfo(today, entries); const ws = mondayOf(today), we = addDays(ws, 6);
  const got = Math.round(sumWeighted(entries, ws, we)); const last = Math.round(sumWeighted(entries, addDays(ws, -7), addDays(ws, -1)));
  const pct = t.target ? Math.round(got / t.target * 100) : 0; const left = daysBetween(today, we) + 1;
  return `<div class="row"><span class="label">今週</span><strong class="big">${got}<span class="unit"> / ${t.target} 分</span></strong><span class="pct${pct >= 100 ? ' ok' : ''}">${pct}%</span></div>
    <div class="bar"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div>
    <div class="sub">Week ${t.weekNo} ・ 目標比率 ${Math.round(t.ratio * 100)}%${t.penalty ? `（未達が続いたので ${t.penalty} 段階下げ）` : ''} ・ 今日を入れて残り ${left} 日 ・ 先週 ${last} 分</div>`;
}
function tasksHTML(today, todays, entries) {
  const due = state.routines.filter(r => dueToday(r, today));
  const doneOf = r => todays.find(e => e.task_id === r.id && EARNED.has(e.status));
  const remaining = due.filter(r => !doneOf(r));
  const est = remaining.reduce((s, r) => s + Math.round(weighted(r, r.est_minutes)), 0);
  const perWeek = +(state.config.pass && state.config.pass.per_week) || 0;
  const ws = mondayOf(today); const passUsed = entries.filter(e => e.status === 'passed' && e.date >= ws && e.date <= addDays(ws, 6)).length;
  const passedToday = todays.some(e => e.status === 'passed');
  const items = due.map(r => {
    const d = doneOf(r); const tl = timeLabel(r);
    const meta = d
      ? `✓ ${d.actual_minutes}分 → 換算 ${Math.round(d.weighted_minutes)}分${d.status === 'partial' ? '（70点）' : ''}${d.mood ? ' ' + MOODS[d.mood - 1] : ''}`
      : `${r.est_minutes}分 → 換算 ${Math.round(weighted(r, r.est_minutes))}分${tl ? ' ・ ' + tl : ''}`;
    const btns = d
      ? `<button class="ghost small" data-act="undo" data-entry="${esc(d.id || '')}">取り消し</button>`
      : `<button class="ghost small" data-act="detail">詳細</button><button class="primary" data-act="done">完了</button>`;
    return `<li class="task${d ? ' is-done' : ''}" data-id="${esc(r.id)}"><div class="main"><div class="title">${esc(r.title)}${r.core ? ' <span class="badge core">core</span>' : ''}</div><div class="meta">${meta}</div></div><div class="btns">${btns}</div></li>`;
  }).join('');
  const head = remaining.length ? `残り ${remaining.length} 件 ・ 見込み ${est} 換算分` : (due.length ? '全部完了 🎉' : '');
  const pass = passedToday
    ? '<span class="sub">今日はパス済み。ストリークは続く</span>'
    : `<button class="ghost small" data-act="pass"${perWeek && passUsed >= perWeek ? ' disabled' : ''}>今日はパス${perWeek ? `（今週 残り ${Math.max(0, perWeek - passUsed)}）` : ''}</button>`;
  return `<h2>今日のタスク <span class="sub">${head}</span></h2>${due.length ? `<ul class="tasks">${items}</ul>` : '<p class="empty">今日の定期タスクはない</p>'}<div class="pass-row">${pass}</div>`;
}
// 掃除メニュー（schedule.type: interval）。前回からの経過日数 ÷ 目安日数 が大きい順。未実施は 1.5 扱い
const isMenu = r => r.schedule && r.schedule.type === 'interval';
function menuItems(today, entries) {
  const last = {};
  entries.forEach(e => { if (EARNED.has(e.status) && (!last[e.task_id] || e.date > last[e.task_id])) last[e.task_id] = e.date; });
  return state.routines.filter(isMenu).map(r => {
    const days = Math.max(1, +r.schedule.days || 7); const ld = last[r.id]; const since = ld ? daysBetween(ld, today) : null;
    return { r, days, since, score: since === null ? 1.5 : since / days };
  }).sort((a, b) => b.score - a.score || a.days - b.days || a.r.est_minutes - b.r.est_minutes);
}
function menuRowHTML(i, big) {
  const { r, days, since, score } = i; const done = since === 0;
  const when = since === null ? '前回 まだ' : done ? '今日やった' : `前回 ${since}日前`;
  const badge = done ? '' : big ? '<span class="badge big">大物</span>' : score >= 1 ? '<span class="badge due">そろそろ</span>' : '';
  const later = !done && score < 1 && since !== null ? ` ・ あと ${Math.max(1, Math.ceil(days - since))} 日` : '';
  const meta = `${r.est_minutes}分 → 換算 ${Math.round(weighted(r, r.est_minutes))}分 ・ 目安 ${days}日ごと ・ ${when}${later}`;
  const btns = done ? '<span class="check">✓</span>' : '<button class="ghost small" data-act="detail">詳細</button><button class="primary" data-act="done">完了</button>';
  return `<li class="task${done ? ' is-done' : ''}${!done && score < 1 ? ' is-later' : ''}" data-id="${esc(r.id)}"><div class="main"><div class="title">${esc(r.title)} ${badge}</div><div class="meta">${meta}</div></div><div class="btns">${btns}</div></li>`;
}
function menuHTML(today, entries) {
  const items = menuItems(today, entries); if (!items.length) return '';
  const open = items.filter(i => i.since !== 0);
  const top = open.slice(0, 2);                                                       // 上位 2 件
  const big = open.find(i => i.days >= BIG_DAYS && i.score >= 1 && !top.includes(i)) || open.find(i => !top.includes(i));   // + 大物 1 件
  const picks = big ? [...top, big] : top;
  const doneToday = items.filter(i => i.since === 0).length;
  let full = '';
  if (state.showMenu) {
    const groups = new Map();
    items.forEach(i => { const p = i.r.place || 'その他'; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(i); });
    const order = [...PLACES.filter(p => groups.has(p)), ...[...groups.keys()].filter(p => !PLACES.includes(p))];
    full = order.map(p => `<h3 class="group">${esc(p)}</h3><ul class="tasks">${groups.get(p).map(i => menuRowHTML(i, false)).join('')}</ul>`).join('');
  }
  return `<h2>掃除メニュー <span class="sub">${doneToday ? `今日 ${doneToday} 件 ・ ` : ''}悩んだら上から。過ぎても責めない</span></h2>
    <ul class="tasks">${picks.map(i => menuRowHTML(i, i === big && i.days >= BIG_DAYS)).join('')}</ul>
    <button class="ghost small wide" data-act="menu-toggle">${state.showMenu ? '閉じる' : `全部見る（${items.length} 件）`}</button>${full}`;
}
// コツ（knowledge/*.md → data/knowledge.json）。間隔反復: 実践の記録が増えるほど次に出るまでが長くなる
function tipStats(entries) {
  const s = {};
  entries.forEach(e => {
    if (!e.tip_id) return;
    const t = s[e.tip_id] || (s[e.tip_id] = { stage: 0, practiced: 0, last: null, next: '0000-00-00' });
    if (e.tip_practiced) { t.stage = Math.min(t.stage + 1, TIP_INTERVALS.length - 1); t.practiced++; } else t.stage = Math.max(0, t.stage - 1);
    t.last = e.date; t.next = addDays(e.date, TIP_INTERVALS[t.stage]);
  });
  return s;
}
const tipNext = (stats, t) => (stats[t.id] ? stats[t.id].next : '0000-00-00');
const orderTips = (tips, stats) => tips.slice().sort((a, b) => tipNext(stats, a).localeCompare(tipNext(stats, b)) || a.id.localeCompare(b.id));
function tipForRoutine(r, stats) {
  const ids = Array.isArray(r.tips) ? r.tips : []; if (!ids.length) return null;
  const cands = state.tips.filter(t => ids.includes(t.id)); return cands.length ? orderTips(cands, stats)[0] : null;
}
function todaysTip(today, stats) {
  const ordered = orderTips(state.tips, stats); if (!ordered.length) return null;
  const due = ordered.filter(t => tipNext(stats, t) <= today); const pool = due.length ? due : ordered;
  const n = pool.length; const idx = (((daysBetween(startMonday(), today) + state.tipOffset) % n) + n) % n;   // 日替わり
  return pool[idx];
}
const LEVEL_JA = { 1: '初級', 2: '中級', 3: '上級' };
const tipBoxHTML = t => `<div class="title">${esc(t.title)}</div><div class="body">${md(t.body || '')}</div>${t.caution ? `<div class="caution">⚠ ${esc(t.caution)}</div>` : ''}${t.action ? `<div class="action">今日やること: ${esc(t.action)}</div>` : ''}`;
function tipHTML(today, entries) {
  if (!state.tips.length) return '';
  const stats = tipStats(entries);
  // 今日すでに実践したコツがあれば、その日はそれを ✓ 付きで出したまま（「別のコツ」で他も見られる）
  const practicedIds = entries.filter(e => e.date === today && e.tip_id && e.tip_practiced).map(e => e.tip_id);
  const kept = state.tipOffset === 0 && practicedIds.length ? state.tips.find(t => t.id === practicedIds[practicedIds.length - 1]) : null;
  const tip = kept || todaysTip(today, stats); if (!tip) return '';
  const s = stats[tip.id]; const practicedToday = practicedIds.includes(tip.id);
  let list = '';
  if (state.showTips) {
    const groups = new Map();
    state.tips.forEach(t => { const k = t.topic || 'その他'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    list = [...groups].map(([k, arr]) => `<h3 class="group">${esc(k)}（${arr.length}）</h3>` + arr.map(t => {
      const st = stats[t.id]; const lv = LEVEL_JA[t.level] ? `<span class="badge">${LEVEL_JA[t.level]}</span>` : '';
      return `<div class="tip-item"><div class="title">${esc(t.title)} ${lv}${st && st.practiced ? ` <span class="badge">実践 ${st.practiced}回</span>` : ''}</div><div class="body">${md(t.body || '')}</div>${t.caution ? `<div class="caution">⚠ ${esc(t.caution)}</div>` : ''}${t.action ? `<div class="action">今日やること: ${esc(t.action)}</div>` : ''}</div>`;
    }).join('')).join('');
  }
  const done = practicedToday ? '<span class="sub">✓ 今日実践した</span>' : `<button class="primary" data-act="tip-practiced" data-tip="${esc(tip.id)}">実践した</button>`;
  return `<h2>💡 今日のコツ <span class="sub">${esc(tip.topic || '')}${LEVEL_JA[tip.level] ? ` ・ ${LEVEL_JA[tip.level]}` : ''}${s && s.practiced ? ` ・ これまで ${s.practiced}回` : ''}</span></h2>
    <div class="tip">${tipBoxHTML(tip)}</div>
    <div class="actions left">${done}<button class="ghost small" data-act="tip-next">別のコツ</button><button class="ghost small" data-act="tips-toggle">${state.showTips ? '閉じる' : `コツ一覧（${state.tips.length}）`}</button></div>${list}`;
}
function quickHTML(todays) {
  const manual = state.routines.filter(r => r.schedule && r.schedule.type === 'manual');
  if (!manual.length) return '';
  const rows = manual.map(r => {
    const done = todays.filter(e => e.task_id === r.id && EARNED.has(e.status));
    const sum = Math.round(done.reduce((s, e) => s + (+e.weighted_minutes || 0), 0));
    const mins = Array.isArray(r.quick_minutes) && r.quick_minutes.length ? r.quick_minutes : [r.est_minutes];
    const chips = mins.map(m => `<button class="chip" data-act="quick" data-id="${esc(r.id)}" data-min="${+m}">${+m}分</button>`).join('');
    return `<div class="quick-row"><div class="title">${esc(r.title)}${done.length ? ` <span class="badge">今日 ${done.length}回 ・ 換算 ${sum}分</span>` : ''}</div><div class="chips">${chips}<button class="chip ghost" data-act="detail" data-id="${esc(r.id)}">詳細</button></div></div>`;
  }).join('');
  return `<h2>後から記録 <span class="sub">終わってから 1 タップ。世話中はスマホを見ない</span></h2>${rows}`;
}
function weekHTML(today, entries) {
  const ws = mondayOf(today); const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const totals = days.map(d => Math.round(sumWeighted(entries, d, d))); const max = Math.max(60, ...totals);
  const cols = days.map((d, i) => `<div class="day${d === today ? ' is-today' : ''}${d > today ? ' is-future' : ''}"><div class="v">${totals[i] || ''}</div><div class="bar-v"><div style="height:${Math.round(totals[i] / max * 100)}%"></div></div><div class="l">${DOW_JA[dowOf(d)]}</div></div>`).join('');
  const byArea = {};
  entries.forEach(e => { if (e.date >= ws && e.date <= addDays(ws, 6) && EARNED.has(e.status)) byArea[e.area] = (byArea[e.area] || 0) + (+e.weighted_minutes || 0); });
  const areas = Object.entries(byArea).sort((a, b) => b[1] - a[1]).map(([a, v]) => `${AREA_JA[a] || a} ${Math.round(v)}`).join(' ・ ');
  return `<h2>今週 <span class="sub">換算分／日</span></h2><div class="days">${cols}</div>${areas ? `<div class="sub" style="margin-top:8px">${esc(areas)}</div>` : ''}`;
}
function logHTML(todays) {
  if (!todays.length) return '<h2>今日の記録</h2><p class="empty">まだ何もない。最初の 1 件が一番えらい</p>';
  const rows = [...todays].reverse().map(e => {
    const time = e.ts ? String(e.ts).slice(11, 16) : ''; const st = e.status === 'partial' ? '70点' : e.status === 'tip' ? 'コツ' : '';
    return `<li><span class="t">${esc(time)}</span><span class="n">${esc(e.title || e.task_id)}${st ? ` <span class="badge">${st}</span>` : ''}${e.mood ? ' ' + MOODS[e.mood - 1] : ''}${e.learned ? `<div class="note">💡 ${esc(e.learned)}</div>` : ''}</span><span class="m">${EARNED.has(e.status) ? `${e.actual_minutes}分 → ${Math.round(e.weighted_minutes)}` : ''}</span>${e.id ? `<button class="ghost tiny" data-act="undo" data-entry="${esc(e.id)}" aria-label="取り消し">×</button>` : ''}</li>`;
  }).join('');
  return `<h2>今日の記録</h2><ul class="log">${rows}</ul>`;
}

// ---- 操作 ----
let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2500);
}
async function run(fn, okMsg) {
  if (state.busy) return; state.busy = true; render();
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { console.error(e); toast(e.message || String(e), true); }
  finally { state.busy = false; render(); }
}
function requireToken() { if (state.token) return true; toast('先に ⚙ でトークンを保存する', true); openSettings(); return false; }
function baseEntry() {
  const now = nowParts(); const e = { date: now.date };
  if (!(state.config.privacy && state.config.privacy.log_time === false)) e.ts = now.iso;
  return e;
}
async function append(e, message, okMsg) {
  await run(async () => {
    await ensureMonths(e.date, e.date);
    await mutateMonth(ymOf(e.date), lines => [...lines, JSON.stringify(e)], message);
    state.streak = await computeStreak(e.date);
  }, okMsg);
}
async function record(r, { minutes, mood, learned, status = 'done', tip_id, tip_practiced }) {
  if (!requireToken()) return;
  const e = baseEntry();
  Object.assign(e, { task_id: r.id, title: r.title, area: r.area, status, mode: 'full', actual_minutes: minutes, weight: weightOf(r), weighted_minutes: weighted(r, minutes), xp: Math.round(weighted(r, minutes)) });
  if (tip_id) { e.tip_id = tip_id; e.tip_practiced = !!tip_practiced; }
  if (mood) e.mood = mood;
  if (learned) e.learned = learned;
  e.id = uid();
  await append(e, `log: ${r.id} ${e.date} ${minutes}m [skip ci]`, `${r.title} ${minutes}分 → 換算 ${Math.round(e.weighted_minutes)}分`);
}
async function recordPass() {
  if (!requireToken()) return;
  const e = baseEntry();
  Object.assign(e, { task_id: '_pass', title: 'パス（ストリーク維持）', status: 'passed', mode: 'full', actual_minutes: 0, weight: 1, weighted_minutes: 0, xp: 0, id: uid() });
  await append(e, `log: pass ${e.date} [skip ci]`, '今日はパス。ストリークは続く');
}
async function recordTip(tipId) {
  if (!requireToken()) return;
  const tip = state.tips.find(t => t.id === tipId); if (!tip) return;
  const e = baseEntry();
  Object.assign(e, { task_id: '_tip', title: tip.title, area: tip.area || 'cleaning', status: 'tip', tip_id: tip.id, tip_practiced: true, id: uid() });
  await append(e, `log: tip ${tip.id} ${e.date} [skip ci]`, '実践した。次は間を空けて出る');
}
async function undo(id) {
  if (!id || !requireToken()) return;
  if (!confirm('この記録を取り消す？')) return;
  const ym = [...state.months.keys()].find(k => state.months.get(k).lines.some(l => (parseLine(l) || {}).id === id));
  if (!ym) return;
  await run(async () => {
    await mutateMonth(ym, lines => lines.filter(l => (parseLine(l) || {}).id !== id), `log: undo ${id} [skip ci]`);
    state.streak = await computeStreak(nowParts().date);
  }, '取り消した');
}

$('#app').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-act]'); if (!b || b.disabled || state.busy) return;
  const host = b.closest('[data-id]'); const id = b.dataset.id || (host ? host.dataset.id : '');
  const r = state.routines.find(x => x.id === id);
  switch (b.dataset.act) {
    case 'done': if (r) record(r, { minutes: +r.est_minutes }); break;
    case 'quick': if (r) record(r, { minutes: +b.dataset.min }); break;
    case 'detail': if (r) openDetail(r); break;
    case 'undo': undo(b.dataset.entry); break;
    case 'pass': recordPass(); break;
    case 'menu-toggle': state.showMenu = !state.showMenu; render(); break;
    case 'tip-practiced': recordTip(b.dataset.tip); break;
    case 'tip-next': state.tipOffset++; render(); break;
    case 'tips-toggle': state.showTips = !state.showTips; render(); break;
  }
});

// 詳細ダイアログ（時間・気分・気づき・70点完了）
let detailRoutine = null, detailMood = 0, detailMin = 0, detailTip = null;
function openDetail(r) {
  detailRoutine = r; detailMood = 0; detailMin = +r.est_minutes || 0;
  detailTip = tipForRoutine(r, tipStats(allEntries()));
  $('#detail-tip-wrap').hidden = !detailTip;
  if (detailTip) { $('#detail-tip').innerHTML = tipBoxHTML(detailTip); $('#detail-tip-practiced').checked = false; }
  $('#detail-title').textContent = r.title; $('#detail-w').textContent = `W=${weightOf(r).toFixed(2)}`;
  const opts = [...new Set([+r.est_minutes, ...(r.quick_minutes || []).map(Number), 5, 10, 15, 20, 30, 45, 60, 90, 120].filter(n => n > 0))].sort((a, b) => a - b);
  $('#detail-minutes').innerHTML = opts.map(m => `<button type="button" class="chip${m === detailMin ? ' is-on' : ''}" data-min="${m}">${m}分</button>`).join('');
  $('#detail-mood').innerHTML = MOODS.map((m, i) => `<button type="button" class="chip" data-mood="${i + 1}">${m}</button>`).join('');
  const check = Array.isArray(r.checklist) ? r.checklist : [];
  $('#detail-check').innerHTML = check.map(c => `<li>${esc(c)}</li>`).join('');
  $('#detail-check-wrap').hidden = !check.length;
  $('#detail-custom').value = ''; $('#detail-note').value = '';
  $('#dlg-detail').showModal();
}
$('#dlg-detail').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.min) { detailMin = +b.dataset.min; $('#detail-custom').value = ''; [...$('#detail-minutes').children].forEach(c => c.classList.toggle('is-on', c === b)); }
  if (b.dataset.mood) { const v = +b.dataset.mood; detailMood = detailMood === v ? 0 : v; [...$('#detail-mood').children].forEach(c => c.classList.toggle('is-on', +c.dataset.mood === detailMood)); }
  if (b.id === 'detail-cancel') $('#dlg-detail').close();
  if (b.id === 'detail-done' || b.id === 'detail-partial') {
    const custom = parseInt($('#detail-custom').value, 10); const minutes = custom > 0 ? custom : detailMin;
    if (!(minutes > 0)) { toast('時間を選ぶ', true); return; }
    const learned = $('#detail-note').value.trim().slice(0, 140);
    $('#dlg-detail').close();
    record(detailRoutine, { minutes, mood: detailMood || undefined, learned: learned || undefined, status: b.id === 'detail-partial' ? 'partial' : 'done',
      tip_id: detailTip ? detailTip.id : undefined, tip_practiced: detailTip ? $('#detail-tip-practiced').checked : undefined });
  }
});

// 設定（トークン）
function openSettings() {
  $('#token').value = state.token; $('#settings-status').textContent = state.token ? '保存済み（この端末のみ）' : '未設定';
  $('#dlg-settings').showModal();
}
$('#btn-settings').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', () => $('#dlg-settings').close());
$('#settings-save').addEventListener('click', () => {
  state.token = $('#token').value.trim();
  try { if (state.token) localStorage.setItem(TOKEN_KEY, state.token); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode など */ }
  $('#dlg-settings').close(); toast(state.token ? 'トークンを保存した' : 'トークンを消した'); reload();
});
$('#settings-test').addEventListener('click', async () => {
  const tok = $('#token').value.trim(); const st = $('#settings-status');
  if (!tok) { st.textContent = 'トークンが空'; return; }
  st.textContent = '確認中…';
  try {
    const res = await fetch(`${API}/repos/${repo().owner}/${repo().name}`, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + tok }, cache: 'no-store' });
    const j = await res.json();
    st.textContent = res.ok ? `OK: ${j.full_name} ・ 書き込み ${j.permissions && j.permissions.push ? '可' : '不可（Contents: Read and write を確認）'}` : `NG（${res.status}）`;
  } catch (e) { st.textContent = 'NG: ' + e.message; }
});

// ---- 起動 ----
async function reload() {
  await run(async () => {
    state.months.clear();
    const today = nowParts().date; const a = addDays(startMonday(), -7), b = addDays(today, -366);
    await ensureMonths(a > b ? a : b, today);
    state.streak = await computeStreak(today);
  });
}
async function init() {
  try { state.token = localStorage.getItem(TOKEN_KEY) || ''; } catch { state.token = ''; }
  try {
    const get = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); });
    const [routines, config, tips] = await Promise.all([get('data/routines.json'), get('data/config.json'), get('data/knowledge.json').catch(() => [])]);
    state.routines = Array.isArray(routines) ? routines : []; state.config = config || {}; state.tips = Array.isArray(tips) ? tips : [];
  } catch (e) { $('#tasks').innerHTML = `<p class="empty">設定の読み込みに失敗: ${esc(e.message)}</p>`; return; }
  const rp = repo();
  $('#repo-link').href = `https://github.com/${rp.owner}/${rp.name}`;
  $('#spec-link').href = `https://github.com/${rp.owner}/${rp.name}/blob/${branch()}/docs/SPEC.md`;
  await reload();
}
$('#btn-reload').addEventListener('click', reload);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !state.busy && state.routines.length) reload(); });
init();
