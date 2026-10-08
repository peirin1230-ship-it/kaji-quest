/* kaji-quest — GitHub Pages 上で動く 1 画面アプリ（フレームワーク無し）
 *
 * 読み: data/routines.json, data/config.json, data/knowledge.json（デプロイ時に YAML/Markdown から生成）
 *       logs/YYYY/MM.jsonl（GitHub Contents API。公開リポジトリなのでトークン無しでも読める）
 * 書き: logs/YYYY/MM.jsonl に 1 行追記（GitHub Contents API）。Contents: Read and write の
 *       fine-grained token を ⚙ から保存する。トークンはこの端末の localStorage にだけ置く。
 */
'use strict';

const API = 'https://api.github.com';
const TOKEN_KEY = 'kq_token';
const PREFS_PATH = 'prefs.json';   // 削除（非表示）にしたタスクの一覧。ページが GitHub API で読み書きする
const SHOP_PATH = 'shopping.json';  // 買い物メモ。同じくページが読み書きする
const SHOP_XP = 3;                  // 買った物 1 点の XP（名もなき家事）。買い物は換算時間には入れない
const TZ = 'Asia/Tokyo';
const LOAD = { physical: { 1: 0, 2: 0.1, 3: 0.2 }, mental: { 1: 0, 2: 0.15, 3: 0.3 }, time_bound: { 0: 0, 1: 0.1, 2: 0.2 } };
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
const DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const AREA_JA = { dishes: '洗い物', cooking: '料理', cleaning: '掃除', laundry: '洗濯', childcare: '育児', nameless: '名もなき家事' };
const MOODS = ['😩', '😕', '😐', '🙂', '😄'];
const COUNTED = new Set(['done', 'partial', 'passed']);   // ストリークに数える status
const EARNED = new Set(['done', 'partial']);              // 換算時間に数える status
const PLACES = ['キッチン', '風呂・洗面・トイレ', 'リビング・寝室', '玄関・ベランダ', '家電', '子ども用品', 'その他'];
const BIG_DAYS = 30;                                      // 目安がこれ以上の項目は「大物」枠に 1 件出す
const TIP_INTERVALS = [1, 3, 7, 30, 90];                  // コツの間隔反復（§9.2）。実践するたび次の段へ、しなければ 1 段戻る
const LEVEL_JA = { 1: '初級', 2: '中級', 3: '上級' };
// 時間帯。4〜10 時=朝 / 11〜16 時=昼 / 17 時〜翌 3 時=夜
const SLOTS = [{ id: 'morning', ja: '朝', from: 4, to: 11 }, { id: 'noon', ja: '昼', from: 11, to: 17 }, { id: 'night', ja: '夜', from: 17, to: 28 }];
const SLOT_JA = Object.fromEntries(SLOTS.map(s => [s.id, s.ja]));
const slotOfHour = h => { if (h < 4) h += 24; return (SLOTS.find(s => h >= s.from && h < s.to) || SLOTS[2]).id; };

const state = { routines: [], config: {}, token: '', months: new Map(), streak: 0, busy: false, showMenu: false, tips: [], tipOffset: 0, showTips: false, viewDate: '', q: '', basics: [], openChapter: '', badges: [], earned: {}, showTrophy: false, openSteps: new Map(), showRefill: false, prefsFile: { sha: null, data: { hidden: [] } }, shopFile: { sha: null, data: { items: [], recent: [] } }, shopDraft: '', shopFocus: false, trophyCat: '', areaXp: {}, lvFocus: '', lvUp: [] };

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');   // 太字と改行だけの最小 Markdown
const norm = s => String(s || '').normalize('NFKC').toLowerCase();
// アイコン（index.html の <symbol id="i-…">）と、カードの見出し（アイコン・題・補足）
const ic = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const head = (icon, title, sub = '', after = '') => `<h2><span class="h-ic">${ic(icon)}</span><span class="h-t">${title}</span>${sub ? ` <span class="sub">${sub}</span>` : ''}${after}</h2>`;
const AREA_SVG = { dishes: 'dish', cooking: 'pan', cleaning: 'broom', laundry: 'washer', nameless: 'sparkle' };
const SLOT_ICON = { morning: 'sunrise', noon: 'sun', night: 'moon' };
// 行の左の丸いチェック。押すと完了。終わっていれば塗りつぶし。p は手順の進み（%）
const tickHTML = (done, attrs, label, p = 0) => done ? `<span class="tick-btn is-on" role="img" aria-label="${esc(label)}">${ic('check')}</span>` : `<button class="tick-btn" ${attrs} style="--p:${p}" aria-label="${esc(label)}">${ic('check')}</button>`;
// 行の名前。押すと詳細（::after で行全体に広げる。左の丸と右のボタンはその上）。inner は段の札・名前・札
const ttBtn = (inner, attrs = '', cls = 'tt') => `<button class="${cls}" data-act="detail"${attrs ? ' ' + attrs : ''} aria-haspopup="dialog">${inner}</button>`;
const ttIn = (r, extra = '') => `${gemHTML(r.area)}<span class="tx">${esc(r.title)}</span>${extra}`;

// ---- 日付（すべて JST の暦日で扱う。端末のタイムゾーンに依存しない） ----
function nowParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, hour: +p.hour, minute: +p.minute, iso: `${date}T${p.hour}:${p.minute}:${p.second}+09:00` };
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
const viewDate = () => state.viewDate || nowParts().date;   // 表示・記録の対象日（既定は今日）
const isToday = () => viewDate() === nowParts().date;
const currentSlot = () => slotOfHour(nowParts().hour);
function monthsBetween(a, b) {
  const out = []; let y = +a.slice(0, 4), m = +a.slice(5, 7); const y2 = +b.slice(0, 4), m2 = +b.slice(5, 7);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}/${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

// ---- 負荷係数・スケジュール・時間帯（docs/SPEC.md §5.1, §6.1） ----
const weightOf = r => { const l = r.load || {}; return round2(1 + (LOAD.physical[l.physical] ?? 0) + (LOAD.mental[l.mental] ?? 0) + (LOAD.time_bound[l.time_bound] ?? 0)); };
const weighted = (r, minutes) => round1(minutes * weightOf(r));
const routineById = id => state.routines.find(r => r.id === id);
// 手順（steps）: 親タスクを細かく分けた小さなタスク。負荷 W・領域・コツは親から引き継ぎ、記録には parent が付く
let stepIndexCache = null;
const stepIndex = () => { if (!stepIndexCache) { stepIndexCache = new Map(); state.routines.forEach(r => (r.steps || []).forEach(st => stepIndexCache.set(st.id, { step: st, parent: r }))); } return stepIndexCache; };
const stepById = id => stepIndex().get(id);
// 削除（非表示）: prefs.json の hidden に入れた id は出さない。記録は残る。「id@slot」はその欄だけ、手順の id は手順だけ
const hiddenKeys = () => (state.prefsFile && state.prefsFile.data && Array.isArray(state.prefsFile.data.hidden)) ? state.prefsFile.data.hidden : [];
const isHidden = key => hiddenKeys().includes(key);
const activeRoutines = () => state.routines.filter(r => !isHidden(r.id));
const stepsOf = r => (r && Array.isArray(r.steps)) ? r.steps.filter(st => !isHidden(st.id)) : [];
// 見込み。手順を削除していれば、その分を引く
const estOf = r => { const hid = (r && Array.isArray(r.steps)) ? r.steps.filter(st => isHidden(st.id)) : []; return hid.length ? Math.max(1, Math.round(r.est_minutes - hid.reduce((m, st) => m + (+st.est_minutes || 0), 0))) : +r.est_minutes; };
function stepTask(id) {
  const x = stepById(id); if (!x) return null; const { step, parent } = x;
  return { id: step.id, title: `${parent.title} › ${step.title}`, area: parent.area, load: parent.load, est_minutes: +step.est_minutes || 1, quick_minutes: [], checklist: [], tips: parent.tips, parent: parent.id, core: false, slots: parent.slots, schedule: { type: 'step' } };
}
const taskById = id => routineById(id) || stepTask(id);
const isRefill = r => !!r && r.kind === 'refill';
const REFILL_GROUPS = ['台所', '洗濯', '浴室・洗面', 'トイレ', '掃除用', '消耗品'];
// 記録済みの手順の見込みを引いた「残り」の分
const restMinutes = (r, doneIds) => Math.max(1, Math.round(estOf(r) - stepsOf(r).filter(st => doneIds.has(st.id)).reduce((m, st) => m + (+st.est_minutes || 0), 0)));
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
// ルーチンが出る時間帯。slots: があればそれ、無ければ expr の時刻から
function slotsOf(r) {
  if (Array.isArray(r.slots) && r.slots.length) { const v = r.slots.filter(s => SLOT_JA[s]); if (v.length) return v; }
  if (r.slot && SLOT_JA[r.slot]) return [r.slot];
  const s = r.schedule || {};
  if (s.type === 'cron' && s.expr) { const h = +s.expr.trim().split(/\s+/)[1]; if (!isNaN(h)) return [slotOfHour(h)]; }
  if (s.time) { const h = +String(s.time).split(':')[0]; if (!isNaN(h)) return [slotOfHour(h)]; }
  return ['night'];
}
// 記録の時間帯。slot が無い古い記録は時刻から、それも無ければルーチンの最初の時間帯
function entrySlot(e, r) {
  if (e.slot && SLOT_JA[e.slot]) return e.slot;
  const m = /T(\d\d)/.exec(String(e.ts || '')); if (m) return slotOfHour(+m[1]);
  return r ? slotsOf(r)[0] : 'night';
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
const fileUrl = path => `${API}/repos/${repo().owner}/${repo().name}/contents/${path}`;
const b64decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const b64encode = s => btoa(Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join(''));
// 分割・改名した古い id を今の id に読み替える（過去の記録を今のタスクに結びつけるため）
const ALIASES = { 'dishes-night': 'dishes', 'laundry-wash-hang': 'laundry-wash', 'cooking-next-day': 'cooking-prep' };
const parseLine = l => { try { const e = JSON.parse(l); if (!e || typeof e !== 'object') return null; if (ALIASES[e.task_id]) e.task_id = ALIASES[e.task_id]; return e; } catch { return null; } };

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

// リポジトリ直下の JSON ファイル（prefs.json = 削除したタスク、shopping.json = 買い物メモ）を GitHub API で読み書きする。
// 無ければ既定値。書き込みは sha 競合なら読み直して 1 回だけやり直す
const JSON_FILES = {
  prefsFile: { path: PREFS_PATH, normalize: d => ({ ...d, hidden: Array.isArray(d.hidden) ? d.hidden : [] }) },
  shopFile: { path: SHOP_PATH, normalize: d => ({ ...d, items: Array.isArray(d.items) ? d.items.filter(i => i && i.id && i.text) : [], recent: Array.isArray(d.recent) ? d.recent.filter(t => typeof t === 'string') : [] }) },
};
async function fetchJsonFile(key) {
  const { path, normalize } = JSON_FILES[key];
  const res = await fetch(`${fileUrl(path)}?ref=${encodeURIComponent(branch())}`, { headers: ghHeaders(false), cache: 'no-store' });
  if (res.status === 404) return { sha: null, data: normalize({}) };
  if (!res.ok) throw new Error(`${path} の取得に失敗（${res.status}）`);
  const j = await res.json(); let data = {};
  try { data = JSON.parse(j.content ? b64decode(j.content) : '{}') || {}; } catch { data = {}; }
  return { sha: j.sha, data: normalize(data) };
}
async function saveJsonFile(key, mutate, message) {
  const { path, normalize } = JSON_FILES[key];
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = state[key] || { sha: null, data: normalize({}) };
    const data = normalize(mutate(JSON.parse(JSON.stringify(cur.data))) || cur.data);
    const body = { message, content: b64encode(JSON.stringify(data, null, 1) + '\n'), branch: branch() };
    if (cur.sha) body.sha = cur.sha;
    const res = await fetch(fileUrl(path), { method: 'PUT', headers: ghHeaders(true), body: JSON.stringify(body) });
    if ((res.status === 409 || res.status === 422) && attempt === 0) { state[key] = await fetchJsonFile(key); continue; }
    if (res.status === 401 || res.status === 403) throw new Error('トークンが無効か権限不足。Contents: Read and write が必要');
    if (res.status === 404) throw new Error('書き込めない。トークンの Repository access に kaji-quest が入っているか確認');
    if (!res.ok) throw new Error(`${path} の書き込みに失敗（${res.status}）`);
    const j = await res.json();
    state[key] = { sha: (j.content && j.content.sha) || null, data };
    return;
  }
  throw new Error('競合が解消できなかった。↻ で更新してもう一度');
}
const fetchPrefs = () => fetchJsonFile('prefsFile');
const savePrefs = (mutate, message) => saveJsonFile('prefsFile', mutate, message);
async function hideTask(key) {
  if (!requireToken()) return;
  await run(async () => { await savePrefs(d => { d.hidden = [...new Set([...(d.hidden || []), key])]; return d; }, `prefs: hide ${key} [skip ci]`); }, '削除した。⚙ の「削除したタスク」から戻せる');
}
async function unhideTask(key) {
  if (!requireToken()) return;
  await run(async () => { await savePrefs(d => { d.hidden = (d.hidden || []).filter(k => k !== key); return d; }, `prefs: show ${key} [skip ci]`); }, '戻した');
  renderHiddenList();
}
function hiddenLabel(key) {
  const [id, slot] = key.split('@'); const r = taskById(id); const name = r ? r.title : id;
  return slot ? `${name}（${SLOT_JA[slot] || slot}の欄）` : name;
}
function renderHiddenList() {
  const keys = hiddenKeys(); const box = $('#hidden-list'); if (!box) return;
  box.innerHTML = keys.length ? keys.map(k => `<li><span class="n">${esc(hiddenLabel(k))}</span><button type="button" class="ghost small" data-act="unhide" data-key="${esc(k)}">戻す</button></li>`).join('') : '<li class="empty">なし</li>';
}

// ---- 買い物メモ（shopping.json）。追加順に並び、買ったものは下へ。「よく買う」は足した名前の履歴 ----
const shopItems = () => (state.shopFile && state.shopFile.data && state.shopFile.data.items) || [];
const shopRecent = () => (state.shopFile && state.shopFile.data && state.shopFile.data.recent) || [];
const splitShopText = s => String(s || '').split(/[、,，\n]+/).map(t => t.trim()).filter(Boolean);
// 補充の項目から買う物の名前（buy: があればそれ。無ければ「〜の詰め替え」などを外す）
const shopNameOf = r => r.buy || String(r.title).replace(/（[^）]*）/g, '').replace(/(の詰め替え|の補充|の交換|の替えを補充)$/, '').replace(/を作る$/, '').trim();
async function shopAdd(text) {
  const list = [...new Set(splitShopText(text))].map(t => t.slice(0, 40));
  if (!list.length || !requireToken()) return;
  state.shopDraft = ''; state.shopFocus = true;
  await run(async () => {
    await saveJsonFile('shopFile', d => {
      list.forEach(t => { const dup = d.items.find(i => i.text === t); if (dup) { dup.done = false; delete dup.bought; } else d.items.push({ id: uid(), text: t, added: nowParts().date }); });
      d.recent = [...list, ...d.recent.filter(t => !list.includes(t))].slice(0, 40);
      return d;
    }, `shop: add ${list.join('、')} [skip ci]`);
  });
}
async function shopToggle(id) {
  if (!requireToken()) return;
  const now = nowParts(); const at = state.config.privacy && state.config.privacy.log_time === false ? now.date : now.iso;   // 買った日（時刻は記録の設定に合わせる）
  await run(async () => { await saveJsonFile('shopFile', d => { const it = d.items.find(i => i.id === id); if (it) { it.done = !it.done; if (it.done) it.bought = at; else delete it.bought; } return d; }, `shop: toggle ${id} [skip ci]`); });
}
async function shopRemove(id) {
  if (!requireToken()) return;
  await run(async () => { await saveJsonFile('shopFile', d => { d.items = d.items.filter(i => i.id !== id); return d; }, `shop: remove ${id} [skip ci]`); });
}
// 「買い物を記録」: 買った物を買った日ごとに 1 行ずつ logs へ書き（実績・バッジに数える）、それからメモから消す。
// すでに記録した物（item_ids にある）は二重に書かない（途中で失敗して残った場合）
const shopEntries = entries => entries.filter(e => e.mode === 'shop' && EARNED.has(e.status));
async function shopRecord() {
  if (!requireToken()) return;
  const done = shopItems().filter(i => i.done); if (!done.length) return;
  const left = shopItems().length - done.length; const n = done.length;
  await run(async () => {
    const logged = new Set(shopEntries(allEntries()).flatMap(e => e.item_ids || []));
    const byDay = new Map();
    done.filter(i => !logged.has(i.id)).forEach(i => { const at = i.bought || nowParts().iso; const day = at.slice(0, 10); (byDay.get(day) || byDay.set(day, []).get(day)).push({ i, at }); });
    const days = [...byDay.keys()].sort();
    for (const day of days) {
      const list = byDay.get(day); const last = list.map(x => x.at).sort().pop(); const e = { date: day };
      if (last.length > 10) e.ts = last;
      Object.assign(e, { task_id: 'shopping', title: '買い物', area: 'nameless', slot: slotOfHour(last.length > 10 ? +last.slice(11, 13) : nowParts().hour), status: 'done', mode: 'shop',
        actual_minutes: 0, weight: 1, weighted_minutes: 0, xp: SHOP_XP * list.length, items: list.map(x => x.i.text), item_ids: list.map(x => x.i.id), id: uid() });
      if (day === days[days.length - 1]) e.left = left;   // メモに残った数は今回の買い物（いちばん新しい日）の行にだけ
      await ensureMonths(day, day);
      await mutateMonth(ymOf(day), lines => [...lines, JSON.stringify(e)], `log: shopping ${day} ${list.length} items [skip ci]`);
    }
    const ids = new Set(done.map(i => i.id));
    await saveJsonFile('shopFile', d => { d.items = d.items.filter(i => !ids.has(i.id)); return d; }, 'shop: record bought [skip ci]');
    state.streak = await computeStreak(nowParts().date);
  }, `買い物を記録した：${n} 点 ・ 名もなき家事 +${n * SHOP_XP} XP`);
}
async function shopShare() {
  const open = shopItems().filter(i => !i.done); if (!open.length) { toast('メモは空', true); return; }
  const text = `買い物メモ ${jaDate(nowParts().date)}\n${open.map(i => '・' + i.text).join('\n')}`;
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('コピーした'); } catch { window.prompt('コピーして使う', text); }
}
function shoppingHTML(all) {
  const items = shopItems(); const open = items.filter(i => !i.done), done = items.filter(i => i.done);
  const past = shopEntries(all); const pastItems = past.reduce((a, e) => a + (e.items || []).length, 0); const pastDays = new Set(past.map(e => e.date)).size;
  const inList = new Set(items.map(i => i.text));
  const chips = shopRecent().filter(t => !inList.has(t)).slice(0, 12).map(t => `<button class="chip" data-act="shop-add" data-text="${esc(t)}">${esc(t)}</button>`).join('');
  const row = i => `<li class="shop-item${i.done ? ' is-done' : ''}" data-sid="${esc(i.id)}"><button class="tick" data-act="shop-toggle" aria-label="${i.done ? `${esc(i.text)} を戻す` : `${esc(i.text)} を買った`}">${ic('check')}</button><button class="shop-name" data-act="shop-toggle">${esc(i.text)}</button><button class="ghost icon-only sm" data-act="shop-remove" aria-label="${esc(i.text)} を消す" title="消す">${ic('x')}</button></li>`;
  return `${head('cart', '買い物メモ', `${open.length ? `${open.length} 件` : '空'} ・ タップで買った`)}
    <div class="shop-add"><input type="text" id="shop-input" placeholder="牛乳、卵（「、」で区切ると複数）" aria-label="買う物" value="${esc(state.shopDraft)}" maxlength="120" autocomplete="off" enterkeyhint="done"><button class="primary" data-act="shop-add-input">${ic('plus')}<span>追加</span></button></div>
    ${chips ? `<div class="chips shop-chips">${chips}</div>` : ''}
    ${open.length ? `<ul class="shop">${open.map(row).join('')}</ul>` : `<p class="empty">まだ何もない。補充のカートのボタンからも足せる</p>`}
    ${done.length ? `<h3 class="group">買った <span class="sub">${done.length} 点 ・ まだ記録していない</span></h3><ul class="shop">${done.map(row).join('')}</ul>
      <button class="primary wide shop-record" data-act="shop-record">${ic('check')}<span>買い物を記録 <small>${done.length} 点 ・ +${done.length * SHOP_XP} XP</small></span></button>` : ''}
    <div class="actions left"><button class="ghost small" data-act="shop-share">${ic('share')}共有・コピー</button></div>
    ${pastItems ? `<p class="shop-total">${ic('trophy')}<span>これまで <b class="num">${pastDays}</b> 日 ・ <b class="num">${pastItems}</b> 点の買い物。実績とバッジに数えている</span></p>` : ''}`;
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
function targetInfo(date, entries) {
  const t = state.config.target || {}; const final = +t.final_weighted_minutes || 0; const after = +t.auto_downshift_after_miss || 0;
  const wn = weekNoOf(date); let penalty = 0, misses = 0;
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
  const today = nowParts().date; const date = viewDate();
  const all = allEntries(); const entries = all.filter(e => e.date <= date);   // 表示日時点の状態を出す
  const todays = entries.filter(e => e.date === date);
  state.areaXp = areaXpOf(entries);
  renderHeader(today, date);
  const oldDash = ($('#progress .ring-fill') || { getAttribute: () => '' }).getAttribute('stroke-dasharray');
  $('#progress').innerHTML = progressHTML(today, date, entries);
  growRing(oldDash);
  $('#tasks').innerHTML = tasksHTML(date, todays, entries);
  $('#menu').innerHTML = menuHTML(date, entries);
  $('#tip').innerHTML = tipHTML(date, entries);
  $('#basics').innerHTML = basicsHTML();
  $('#quick').innerHTML = quickHTML(todays);
  $('#refill').innerHTML = refillHTML(date, entries);
  $('#shopping').innerHTML = shoppingHTML(all);
  $('#week').innerHTML = weekHTML(today, date, entries);
  $('#achievements').innerHTML = achievementsHTML(today, date, entries, all);
  $('#today-log').innerHTML = logHTML(date, todays);
  renderSearch(date, todays, entries);
  document.body.classList.toggle('busy', state.busy);
  decorateCards(); requestAnimationFrame(updateNav);
  if (pendingGo && state.loaded && !state.busy) { const g = pendingGo; pendingGo = null; requestAnimationFrame(() => goTo(g.id, g.fallback)); }
  if (state.shopFocus && !state.busy) { state.shopFocus = false; const inp = $('#shop-input'); if (inp) inp.focus({ preventScroll: true }); }
}
// 週の輪: 書き換えた後、前の長さから新しい長さへ CSS の transition で伸ばす（最初の表示はゼロから）
function growRing(oldDash) {
  const rf = $('#progress .ring-fill'); if (!rf) return; const nd = rf.getAttribute('stroke-dasharray');
  const from = oldDash || `0 ${nd.split(' ')[1]}`; if (from === nd) return;
  rf.style.strokeDasharray = from; rf.getBoundingClientRect(); requestAnimationFrame(() => { rf.style.strokeDasharray = nd; });
}
function renderHeader(today, date) {
  $('#date-input').value = date; $('#date-input').max = today;
  $('#btn-today').hidden = date === today;
  $('#btn-date-next').disabled = date >= today;
  $('#streak').innerHTML = `${ic('flame')}<b>${state.streak}</b><span>日<span class="sl">連続</span></span>`;
  const nd = $('#nav-date'); nd.innerHTML = `${ic('calendar')}${jaDate(date)}`; nd.classList.toggle('is-past', date !== today);
  renderSky(today, date);
}
// 空（今の時刻で変わる: 朝・昼・夕焼け・夜）とあいさつ。日付と時刻だけで描けるので、データを待たずに最初にも出す
function renderSky(today, date) {
  const now = nowParts(); const slot = currentSlot(); const hero = $('#hero');
  hero.dataset.slot = slot; hero.classList.toggle('is-past', date !== today);
  const h = now.hour + now.minute / 60;
  // 16〜19 時は空だけ夕焼け（窓に灯りがつき始める）。ブラウザの上の帯も空の色に合わせる
  const sky = h >= 16 && h < 19 ? 'dusk' : slot; hero.dataset.sky = sky;
  const TOP = { morning: ['#ffc9a3', '#4a2e3a'], noon: ['#8ecbff', '#1b3f70'], dusk: ['#f59a78', '#3b2350'], night: ['#161b4a', '#060920'] };
  document.querySelectorAll('meta[name="theme-color"]').forEach((el, i) => el.setAttribute('content', (TOP[sky] || TOP.noon)[i] || TOP.noon[0]));
  // 太陽・月の位置: fx は出てから沈むまでの進み（0〜1）、fy は高さ（0 地平線〜1 天頂）。画面のどこを動くかは CSS が決める
  const day = h >= 5 && h < 19; const f = day ? (h - 5) / 14 : (((h - 19) % 24) + 24) % 24 / 10;
  hero.style.setProperty('--fx', f.toFixed(3)); hero.style.setProperty('--fy', Math.sin(Math.PI * f).toFixed(3));
  const G = { morning: ['おはよう', '小さく始めれば、それで十分。'], noon: ['こんにちは', 'ひと息ついたら、一つだけ。'], night: ['おつかれさま', '今日の分は、ここまででも大丈夫。'] };
  const m = +date.slice(5, 7), d = +date.slice(8, 10);
  // 文字は変わったときだけ書き換える（最初の描画で出した文字を作り直さない）
  const put = (sel, t) => { const el = $(sel); if (el.textContent !== t) el.textContent = t; };
  if (date === today) { put('#greet', G[slot][0]); put('#greet-sub', G[slot][1]); }
  else { put('#greet', `${m}月${d}日のページ`); put('#greet-sub', 'この日の分を、あとから足せる。'); }
  put('#date-big', `${m}.${d}`); put('#date-dow', DOW_JA[dowOf(date)]);
}
// ---- ページ内ナビ（上に固定のチップ）と、カードの折りたたみ（この端末に記憶） ----
const NAV_IDS = ['slot-morning', 'slot-noon', 'slot-night', 'menu', 'tip', 'basics', 'quick', 'refill', 'shopping', 'week', 'achievements', 'today-log'];
const COLLAPSE_KEY = 'kq_collapsed';
let collapsed = new Set(); try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { collapsed = new Set(); }
const visible = el => !!el && el.offsetParent !== null;
function setCollapsed(id, on) {
  if (on) collapsed.add(id); else collapsed.delete(id);
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* 保存できなくても動く */ }
  const sec = document.getElementById(id); if (!sec) return;
  sec.classList.toggle('is-collapsed', on);
  const b = sec.querySelector(':scope > h2 > .collapse'); if (b) { b.setAttribute('aria-expanded', on ? 'false' : 'true'); b.setAttribute('aria-label', on ? '開く' : 'たたむ'); }
  updateNav();
}
// 各カードの見出しに折りたたみボタンを付け、記憶した状態を当てる（描画のたびに呼ぶ）
function decorateCards() {
  document.querySelectorAll('#app .card').forEach(sec => {
    const h = sec.querySelector(':scope > h2'); if (!h) return;
    const on = collapsed.has(sec.id);
    if (!h.querySelector('.collapse')) h.insertAdjacentHTML('beforeend', `<button class="collapse" data-act="collapse-toggle" data-card="${esc(sec.id)}">${ic('chev-d')}</button>`);
    const b = h.querySelector('.collapse'); b.setAttribute('aria-expanded', on ? 'false' : 'true'); b.setAttribute('aria-label', on ? '開く' : 'たたむ');
    sec.classList.toggle('is-collapsed', on);
  });
}
// ---- ページ内ナビ: 押すと見出しへ飛ぶ。スクロールすると、今見ている見出しのチップが光り、帯の真ん中に来る ----
// 帯（横スクロール）は帯だけを動かす。チップに scrollIntoView を使うと、iPhone ではページのなめらかなスクロールが打ち消されて飛ばないことがある
const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
let navActive = null;
function showChip(chip, smooth) {
  const strip = chip && chip.parentElement; if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
  const sr = strip.getBoundingClientRect(), cr = chip.getBoundingClientRect();
  const to = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, Math.round(strip.scrollLeft + (cr.left - sr.left) - (sr.width - cr.width) / 2)));
  if (Math.abs(to - strip.scrollLeft) >= 2) strip.scrollTo({ left: to, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
}
function setNavActive(id, smooth) {
  if (id === navActive) return; navActive = id;   // 変わったときだけ（スクロール中は毎フレーム呼ばれる）
  document.querySelectorAll('#nav .nav-chip').forEach(c => { const on = !!id && c.dataset.go === id; c.classList.toggle('is-active', on); if (on) c.setAttribute('aria-current', 'location'); else c.removeAttribute('aria-current'); });
  showChip(document.querySelector(id ? `#nav .nav-chip[data-go="${id}"]` : '#nav .nav-chip'), smooth);   // 見出しより上（いちばん上）では帯も先頭へ
}
// 見出しへ飛ぶ。飛び先が無い（その日にその欄が無い）ときは fallback のカードへ。たたんであれば開いてから飛ぶ。
// 読み込み中に押されたら、描き終わってから飛ぶ。飛び終わって位置がずれていたら（途中で打ち消された）1 回だけすぐ飛び直す
let navJump = null, navSettleTimer = 0, pendingGo = null;
function goTo(id, fallback) {
  if (id === 'top') { navJump = null; setNavActive('', true); window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
  if (!state.loaded) { pendingGo = { id, fallback }; setNavActive(id, true); return; }   // 読み込み中（カードはまだ空）
  let el = document.getElementById(id) || (fallback ? document.getElementById(fallback) : null); if (!el) return;
  const card = el.closest('.card'); if (card && card.classList.contains('is-collapsed')) setCollapsed(card.id, false);
  if (!visible(el)) { el = fallback ? document.getElementById(fallback) : null; if (!visible(el)) return; }
  setNavActive(id, true);
  navJump = { id, fallback };
  el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  armNavSettle();
}
function armNavSettle() { clearTimeout(navSettleTimer); navSettleTimer = setTimeout(navSettled, 220); }
function navSettled() {
  const j = navJump; if (!j) return;
  let el = document.getElementById(j.id); if (!visible(el)) el = j.fallback ? document.getElementById(j.fallback) : null;
  if (visible(el) && !j.retried) {
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const off = el.getBoundingClientRect().top - pad; const room = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;   // まだ下へ動ける量
    if (Math.abs(off) > 24 && (off < 0 || room > 2)) { j.retried = true; el.scrollIntoView({ block: 'start' }); armNavSettle(); return; }
  }
  navJump = null; updateNav();
}
// 飛んでいる途中に自分でスクロールし始めたら、飛び直しはしない
['wheel', 'touchstart', 'keydown'].forEach(t => window.addEventListener(t, ev => { if (navJump && !(ev.target.closest && ev.target.closest('#nav'))) { navJump = null; clearTimeout(navSettleTimer); } }, { passive: true }));
// 今どの見出しを見ているか: ナビの下端より上にある見出しのうち、いちばん下のもの（2 列の画面でも見た目の位置で決める）
function updateNav() {
  if (navJump) return;   // 飛んでいる途中は押したチップのまま（途中の見出しでチラつかない）
  const nav = $('#nav'); if (!nav) return; const limit = nav.getBoundingClientRect().bottom + 20;
  let active = '', best = -Infinity, last = '', lastTop = -Infinity;
  NAV_IDS.forEach(id => {
    const el = document.getElementById(id); if (!visible(el)) return; const t = el.getBoundingClientRect().top;
    if (t <= limit && t > best) { best = t; active = id; }
    if (t > lastTop) { lastTop = t; last = id; }
  });
  if (last && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) active = last;   // 一番下まで来たら最後の見出し
  setNavActive(active, true);
}
let navTick = false;
window.addEventListener('scroll', () => {
  if (navJump) armNavSettle();
  if (navTick) return; navTick = true; requestAnimationFrame(() => { navTick = false; updateNav(); });
}, { passive: true });
// チップは指を離した時点で飛ぶ（iPhone では、慣性で流れている最中のタップに click が来ないことがある）。キーボードは click で
let navPress = null, navFiredAt = 0;
$('#nav').addEventListener('pointerdown', ev => { const b = ev.target.closest('[data-go]'); navPress = b && ev.isPrimary ? { b, x: ev.clientX, y: ev.clientY } : null; });
$('#nav').addEventListener('pointercancel', () => { navPress = null; });   // 帯を横に動かした・ページをスクロールした
$('#nav').addEventListener('pointerup', ev => {
  const p = navPress; navPress = null; if (!p) return;
  const b = ev.target.closest('[data-go]'); if (b !== p.b || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 12) return;
  navFiredAt = Date.now(); goTo(b.dataset.go, b.dataset.fallback);
});
$('#nav').addEventListener('click', ev => { const b = ev.target.closest('[data-go]'); if (!b || Date.now() - navFiredAt < 700) return; goTo(b.dataset.go, b.dataset.fallback); });
function progressHTML(today, date, entries) {
  const t = targetInfo(date, entries); const ws = mondayOf(date), we = addDays(ws, 6);
  const got = Math.round(sumWeighted(entries, ws, we)); const last = Math.round(sumWeighted(entries, addDays(ws, -7), addDays(ws, -1)));
  const pct = t.target ? Math.round(got / t.target * 100) : 0; const left = daysBetween(date, we) + 1;
  const label = ws === mondayOf(today) ? '今週' : `${jaDate(ws)} の週`;
  const R = 44, C = 2 * Math.PI * R, fr = Math.min(1, pct / 100);
  const ring = `<svg class="ring-svg" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="rg-a"/><stop offset="1" class="rg-b"/></linearGradient></defs><circle class="ring-track" cx="50" cy="50" r="${R}"/><circle class="ring-fill${pct >= 100 ? ' is-full' : ''}" cx="50" cy="50" r="${R}" stroke-dasharray="${(C * fr).toFixed(1)} ${C.toFixed(1)}"/></svg>`;
  // 次の一手: 今の時間帯から、まだ終わっていない定期タスクを 1 つ
  const todays = entries.filter(e => e.date === date); const pairs = duePairs(date, todays);
  const rest = pairs.filter(x => !x.p.complete); const order = [currentSlot(), ...SLOTS.map(sl => sl.id)];
  const next = date === today ? order.map(sid => rest.find(x => x.sid === sid)).find(Boolean) : rest[0];
  const estSum = rest.reduce((sum, x) => sum + Math.round(weighted(x.r, x.p.doneIds.size ? x.p.rest : estOf(x.r))), 0);
  let nx;
  if (next) {
    const partial = next.p.doneIds.size > 0; const est = partial ? next.p.rest : estOf(next.r);
    nx = `<div class="hc-next has-rk ${rkOf(next.r.area)}" data-id="${esc(next.r.id)}" data-slot="${next.sid}"><div class="hc-k">${ic(SLOT_ICON[next.sid])}次の一手 ・ ${SLOT_JA[next.sid]}</div><div class="hc-t">${gemHTML(next.r.area)}${esc(next.r.title)}</div><div class="hc-m">${partial ? '残り ' : ''}${est}分 → 換算 ${Math.round(weighted(next.r, est))}分</div><button class="primary done-btn" data-act="done" data-id="${esc(next.r.id)}" data-slot="${next.sid}" data-min="${est}">${ic('check')}<span>${partial ? '残り完了' : '完了'}</span></button></div>`;
  } else nx = `<div class="hc-next is-clear"><div class="hc-k">${ic('sparkle')}${pairs.length ? '定期タスクは全部終わり' : 'この日の定期タスクはない'}</div><div class="hc-t">${pairs.length ? 'よくやった。あとは好きに過ごしていい' : '掃除メニューから一つ選んでもいい'}</div></div>`;
  return `<div class="hc-week"><div class="ring${pct >= 100 ? ' is-full' : ''}">${ring}<div class="ring-c"><b class="num">${pct}</b><span>%</span></div>${pct >= 100 ? `<i class="ring-ok">${ic('sparkle')}達成</i>` : ''}</div>
    <div class="hc-nums"><div class="hc-label">${label}の換算時間</div><div class="hc-big"><b class="num">${got}</b><span> / ${t.target} 分</span></div>
    <div class="hc-tags"><span>Week ${t.weekNo}</span><span>目標 ${Math.round(t.ratio * 100)}%${t.penalty ? `（${t.penalty} 段階下げ）` : ''}</span><span>残り ${left} 日</span><span>前週 ${last} 分</span></div>
    <div class="hc-today">${rest.length ? `${isToday() ? '今日' : 'この日'} 残り <b>${rest.length}</b> 件 ・ 見込み <b>${estSum}</b> 分` : (pairs.length ? '全部完了' : '')}</div></div></div>${nx}`;
}
// 手順ブロック（今日のタスク・掃除メニュー共通）。doneMap: 手順 id → その手順の記録（配列）
function stepsBlockHTML(r, key, sid, doneMap, open, showDate) {
  const steps = stepsOf(r); if (!steps.length) return { toggle: '', list: '' };
  const n = steps.filter(st => (doneMap[st.id] || []).length).length;
  const toggle = `<button class="steps-toggle${open ? ' is-open' : ''}${n ? ' has-n' : ''}" data-act="steps-toggle" data-key="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}" aria-label="手順 ${n}/${steps.length}" title="手順">${ic('list')}<span class="num">${n}/${steps.length}</span></button>`;
  const slotAttr = sid ? ` data-slot="${sid}"` : '';
  const rows = steps.map(st => {
    const done = doneMap[st.id] || []; const est = +st.est_minutes || 1;
    if (done.length) {
      const act = done.reduce((a, e) => a + (+e.actual_minutes || 0), 0), wm = done.reduce((a, e) => a + (+e.weighted_minutes || 0), 0); const last = done[done.length - 1];
      const when = showDate && last.date && last.date !== viewDate() ? `${esc(last.date.slice(5).replace('-', '/'))} ` : '';
      return `<li class="step is-done" data-id="${esc(st.id)}">${tickHTML(true, '', `${st.title}：完了済み`)}<span class="nm">${esc(st.title)}</span><span class="mt">${when}${act}分 → ${Math.round(wm)}</span>${last.id ? `<button class="ghost icon-only sm" data-act="undo" data-entry="${esc(last.id)}" aria-label="取り消し" title="取り消し">${ic('undo')}</button>` : ''}</li>`;
    }
    return `<li class="step" data-id="${esc(st.id)}">${tickHTML(false, `data-act="done"${slotAttr} data-min="${est}"`, `完了：${st.title}`)}${ttBtn(esc(st.title), `${slotAttr.trim()} data-min="${est}"`, 'nm')}<span class="mt">${est}分</span></li>`;
  }).join('');
  return { toggle, list: open ? `<ul class="steps">${rows}</ul>` : '' };
}
// 手順の開閉。押して変えていなければ、途中まで記録があるときだけ開く
const stepsOpen = (key, partial) => { const ex = state.openSteps.get(key); return ex !== undefined ? ex : partial; };
// その日の記録を「親そのもの」と「手順」に分ける。親の記録があるか、手順が全部そろえば完了
function doneParts(r, sid, todays) {
  const entries = todays.filter(e => (e.task_id === r.id || e.parent === r.id) && EARNED.has(e.status) && entrySlot(e, r) === sid);
  const own = entries.filter(e => e.task_id === r.id); const doneMap = {};
  entries.forEach(e => { if (e.parent === r.id) (doneMap[e.task_id] || (doneMap[e.task_id] = [])).push(e); });
  const steps = stepsOf(r); const doneIds = new Set(Object.keys(doneMap));
  const complete = own.length > 0 || (steps.length > 0 && steps.every(st => doneIds.has(st.id)));
  return { entries, own, doneMap, doneIds, complete, rest: restMinutes(r, doneIds) };
}
function taskRowHTML(r, sid, p) {
  const tl = timeLabel(r); const key = `${r.id}:${sid}`; const partial = p.doneIds.size > 0 && !p.complete;
  const sb = stepsBlockHTML(r, key, sid, p.doneMap, stepsOpen(key, partial), false);
  const nSteps = stepsOf(r).length; const pp = nSteps ? Math.round(p.doneIds.size / nSteps * 100) : 0;
  let meta, btns, tick, tt; const core = r.core ? ' <span class="badge core">core</span>' : '';
  if (p.complete) {
    const done = p.entries;
    const act = done.reduce((a, e) => a + (+e.actual_minutes || 0), 0), wm = done.reduce((a, e) => a + (+e.weighted_minutes || 0), 0);
    const moods = done.filter(e => e.mood).map(e => MOODS[e.mood - 1]).join('');
    meta = `<span class="m-done">${act}分 → 換算 ${Math.round(wm)}分${done.length > 1 ? `（${done.length} 回）` : ''}${done.some(e => e.status === 'partial') ? '（70点）' : ''}${moods ? ' ' + moods : ''}</span>`;
    btns = `<button class="ghost icon-only" data-act="undo" data-entry="${esc(done[done.length - 1].id || '')}" aria-label="取り消し：${esc(r.title)}" title="取り消し">${ic('undo')}</button>`;
    tick = tickHTML(true, '', `${r.title}：完了済み`); tt = ttBtn(ttIn(r, core), `data-slot="${sid}"`);
  } else {
    const est = partial ? p.rest : estOf(r);
    meta = `<span>${partial ? '残り ' : ''}${est}分 → 換算 ${Math.round(weighted(r, est))}分</span>${tl ? `<span class="m-at">${ic('clock')}${tl}</span>` : ''}`;
    btns = '';
    tick = tickHTML(false, `data-act="done" data-slot="${sid}" data-min="${est}"`, `${partial ? '残りを完了' : '完了'}：${r.title}`, pp); tt = ttBtn(ttIn(r, core), `data-slot="${sid}" data-min="${est}"`);
  }
  const jd = p.complete && justDone(r.id, sid) ? ' just-done' : '';
  const st = p.complete && !p.doneIds.size ? { toggle: '', list: '' } : sb;   // 親ごと完了した行には手順を出さない
  return `<li class="task has-rk ${rkOf(r.area)}${p.complete ? ' is-done' : ''}${jd}" data-id="${esc(r.id)}" data-slot="${sid}"><div class="lead">${tick}</div><div class="main"><div class="title">${tt}</div><div class="meta">${meta}</div></div>${btns || st.toggle ? `<div class="btns">${st.toggle}${btns}</div>` : ''}${st.list}</li>`;
}
function duePairs(date, todays) {
  const pairs = []; activeRoutines().filter(r => dueToday(r, date)).forEach(r => slotsOf(r).filter(sid => !isHidden(`${r.id}@${sid}`)).forEach(sid => pairs.push({ r, sid, p: doneParts(r, sid, todays) })));
  return pairs;
}
function tasksHTML(date, todays, entries) {
  const pairs = duePairs(date, todays);
  const remaining = pairs.filter(x => !x.p.complete);
  const est = remaining.reduce((sum, x) => sum + Math.round(weighted(x.r, x.p.doneIds.size ? x.p.rest : estOf(x.r))), 0);
  const perWeek = +(state.config.pass && state.config.pass.per_week) || 0;
  const ws = mondayOf(date); const passUsed = entries.filter(e => e.status === 'passed' && e.date >= ws && e.date <= addDays(ws, 6)).length;
  const passedToday = todays.some(e => e.status === 'passed');
  const sections = SLOTS.map(sl => {
    const items = pairs.filter(x => x.sid === sl.id); if (!items.length) return '';
    const left = items.filter(x => !x.p.complete).length;
    return `<h3 class="group slot slot-${sl.id}" id="slot-${sl.id}"><span class="slot-ic">${ic(SLOT_ICON[sl.id])}</span>${sl.ja} <span class="sub">${left ? `残り ${left} 件` : '全部完了'}</span></h3><ul class="tasks">${items.map(x => taskRowHTML(x.r, x.sid, x.p)).join('')}</ul>`;
  }).join('');
  const summary = remaining.length ? `残り ${remaining.length} 件 ・ 見込み ${est} 換算分` : (pairs.length ? '全部完了' : '');
  const pass = passedToday
    ? '<span class="sub">この日はパス済み。ストリークは続く</span>'
    : `<button class="ghost small" data-act="pass"${perWeek && passUsed >= perWeek ? ' disabled' : ''}>${ic('pause')}この日はパス${perWeek ? `（その週 残り ${Math.max(0, perWeek - passUsed)}）` : ''}</button>`;
  return `${head('quest', `${isToday() ? '今日' : jaDate(date)}のタスク`, summary)}${sections || '<p class="empty">この日の定期タスクはない</p>'}<div class="pass-row">${pass}</div>`;
}
// 掃除メニュー（schedule.type: interval）。前回からの経過日数 ÷ 目安日数 が大きい順。未実施は 1.5 扱い
const isMenu = r => r.schedule && r.schedule.type === 'interval';
function menuItems(date, entries) {
  const last = {}; const prog = {};   // prog[id]: Map(手順 id → 記録)。目安日数の範囲内で手順が全部そろったら 1 回完了
  entries.filter(e => EARNED.has(e.status)).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
    if (e.parent) {
      const r = routineById(e.parent); if (!r || !isMenu(r)) return;
      const days = Math.max(1, +r.schedule.days || 7); const m = prog[r.id] || (prog[r.id] = new Map());
      m.set(e.task_id, e);
      for (const [k, v] of m) if (daysBetween(v.date, e.date) > days) m.delete(k);
      if (stepsOf(r).length && stepsOf(r).every(st => m.has(st.id))) { last[r.id] = e.date; m.clear(); }
    } else if (!last[e.task_id] || e.date > last[e.task_id]) { last[e.task_id] = e.date; if (prog[e.task_id]) prog[e.task_id].clear(); }
  });
  return activeRoutines().filter(isMenu).map(r => {
    const days = Math.max(1, +r.schedule.days || 7); const ld = last[r.id]; const since = ld ? daysBetween(ld, date) : null;
    const doneMap = {}; for (const [k, v] of (prog[r.id] || new Map())) if (daysBetween(v.date, date) <= days) doneMap[k] = [v];
    return { r, days, since, score: since === null ? 1.5 : since / days, doneMap, doneIds: new Set(Object.keys(doneMap)) };
  }).sort((a, b) => b.score - a.score || a.days - b.days || a.r.est_minutes - b.r.est_minutes);
}
function menuRowHTML(i, big) {
  const { r, days, since, score, doneMap, doneIds } = i; const done = since === 0; const partial = doneIds.size > 0 && !done;
  const key = `menu:${r.id}`; const sb = stepsBlockHTML(r, key, '', doneMap, stepsOpen(key, partial), true);
  const when = since === null ? '前回 まだ' : done ? 'この日やった' : `前回 ${since}日前`;
  const badge = done ? '' : big ? '<span class="badge big">大物</span>' : score >= 1 ? '<span class="badge due">そろそろ</span>' : '';
  const later = !done && score < 1 && since !== null ? ` ・ あと ${Math.max(1, Math.ceil(days - since))} 日` : '';
  const est = partial ? restMinutes(r, doneIds) : estOf(r);
  const st = done && !doneIds.size ? { toggle: '', list: '' } : sb;
  const meta = `<span>${partial ? '残り ' : ''}${est}分 → 換算 ${Math.round(weighted(r, est))}分</span><span>目安 ${days}日ごと ・ ${when}${later}</span>`;
  const nSteps = stepsOf(r).length; const tick = tickHTML(done, `data-act="done" data-min="${est}"`, done ? `${r.title}：この日やった` : `${partial ? '残りを完了' : '完了'}：${r.title}`, nSteps ? Math.round(doneIds.size / nSteps * 100) : 0);
  const jd = done && justDone(r.id, '') ? ' just-done' : '';
  return `<li class="task has-rk ${rkOf(r.area)}${done ? ' is-done' : ''}${!done && score < 1 ? ' is-later' : ''}${jd}" data-id="${esc(r.id)}"><div class="lead">${tick}</div><div class="main"><div class="title">${ttBtn(ttIn(r, badge ? ' ' + badge : ''), done ? '' : `data-min="${est}"`)}</div><div class="meta">${meta}</div></div>${st.toggle ? `<div class="btns">${st.toggle}</div>` : ''}${st.list}</li>`;
}
function menuHTML(date, entries) {
  const items = menuItems(date, entries); if (!items.length) return '';
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
  return `${head('broom', '掃除メニュー', `${doneToday ? `この日 ${doneToday} 件 ・ ` : ''}悩んだら上から。過ぎても責めない`)}
    <ul class="tasks">${picks.map(i => menuRowHTML(i, i === big && i.days >= BIG_DAYS)).join('')}</ul>
    <button class="ghost small wide more" data-act="menu-toggle" aria-expanded="${state.showMenu}">${state.showMenu ? '閉じる' : `全部見る（${items.length} 件）`}${ic('chev-d', 'chev')}</button>${full}`;
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
function todaysTip(date, stats) {
  const ordered = orderTips(state.tips, stats); if (!ordered.length) return null;
  const due = ordered.filter(t => tipNext(stats, t) <= date); const pool = due.length ? due : ordered;
  const n = pool.length; const idx = (((daysBetween(startMonday(), date) + state.tipOffset) % n) + n) % n;   // 日替わり
  return pool[idx];
}
const tipBoxHTML = t => `<div class="title">${esc(t.title)}</div><div class="body">${md(t.body || '')}</div>${t.caution ? `<div class="caution">⚠ ${esc(t.caution)}</div>` : ''}${t.action ? `<div class="action">今日やること: ${esc(t.action)}</div>` : ''}`;
function tipItemHTML(t, stats, withButton) {
  const st = stats[t.id]; const lv = LEVEL_JA[t.level] ? `<span class="badge">${LEVEL_JA[t.level]}</span>` : '';
  return `<div class="tip-item"><div class="title">${esc(t.title)} ${lv}${st && st.practiced ? ` <span class="badge">実践 ${st.practiced}回</span>` : ''}</div><div class="body">${md(t.body || '')}</div>${t.caution ? `<div class="caution">⚠ ${esc(t.caution)}</div>` : ''}${t.action ? `<div class="action">今日やること: ${esc(t.action)}</div>` : ''}${withButton ? `<div class="actions left"><button class="ghost small" data-act="tip-practiced" data-tip="${esc(t.id)}">実践した</button></div>` : ''}</div>`;
}
function tipHTML(date, entries) {
  if (!state.tips.length) return '';
  const stats = tipStats(entries);
  // その日すでに実践したコツがあれば、その日はそれを ✓ 付きで出したまま（「別のコツ」で他も見られる）
  const practicedIds = entries.filter(e => e.date === date && e.tip_id && e.tip_practiced).map(e => e.tip_id);
  const kept = state.tipOffset === 0 && practicedIds.length ? state.tips.find(t => t.id === practicedIds[practicedIds.length - 1]) : null;
  const tip = kept || todaysTip(date, stats); if (!tip) return '';
  const s = stats[tip.id]; const practicedToday = practicedIds.includes(tip.id);
  let list = '';
  if (state.showTips) {
    const groups = new Map();
    state.tips.forEach(t => { const k = t.topic || 'その他'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    list = [...groups].map(([k, arr]) => `<h3 class="group">${esc(k)}（${arr.length}）</h3>` + arr.map(t => tipItemHTML(t, stats, false)).join('')).join('');
  }
  const done = practicedToday ? `<span class="sub done-mark">${ic('check')}実践した</span>` : `<button class="primary" data-act="tip-practiced" data-tip="${esc(tip.id)}">${ic('check')}<span>実践した</span></button>`;
  return `${head('bulb', '今日のコツ', `${esc(tip.topic || '')}${LEVEL_JA[tip.level] ? ` ・ ${LEVEL_JA[tip.level]}` : ''}${s && s.practiced ? ` ・ これまで ${s.practiced}回` : ''}`)}
    <div class="tip">${tipBoxHTML(tip)}</div>
    <div class="actions left">${done}<button class="ghost small" data-act="tip-next">別のコツ</button><button class="ghost small" data-act="tips-toggle">${state.showTips ? '閉じる' : `コツ一覧（${state.tips.length}）`}</button></div>${list}`;
}
// 掃除の教科書（knowledge/basics/*.md のやさしい版 → data/basics.json）。1 章ずつ開閉
const chapterSrcUrl = c => c.source ? `https://github.com/${repo().owner}/${repo().name}/blob/${branch()}/knowledge/reference/${c.source}` : '';
function basicsHTML() {
  if (!state.basics.length) return '';
  const rows = state.basics.map((c, i) => {
    const open = state.openChapter === c.id;
    return `<div class="chapter${open ? ' is-open' : ''}" id="ch-${esc(c.id)}">
      <button class="chapter-head" data-act="chapter" data-ch="${esc(c.id)}" aria-expanded="${open}"><span class="num">${i}</span><span class="ttl">${esc(c.title)}</span><span class="sum">${esc(c.summary || '')}</span><span class="arrow">${ic('chev-d', 'chev')}</span></button>
      ${open ? `<div class="chapter-body">${c.html}${chapterSrcUrl(c) ? `<p class="src"><a href="${esc(chapterSrcUrl(c))}" target="_blank" rel="noopener">くわしい元の資料（原文）を開く</a></p>` : ''}<button class="ghost small wide" data-act="chapter" data-ch="${esc(c.id)}">閉じる</button></div>` : ''}
    </div>`;
  }).join('');
  return `${head('book', '掃除の教科書', 'やさしい版。数字や決まりは元の資料で確かめる')}${rows}`;
}
function openChapter(id, scroll) {
  state.openChapter = state.openChapter === id && !scroll ? '' : id; render();
  if (scroll) { const el = document.getElementById('ch-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function quickHTML(todays) {
  const manual = activeRoutines().filter(r => r.schedule && r.schedule.type === 'manual' && !isRefill(r));
  if (!manual.length) return '';
  const rows = manual.map(r => {
    const done = todays.filter(e => e.task_id === r.id && EARNED.has(e.status));
    const sum = Math.round(done.reduce((s, e) => s + (+e.weighted_minutes || 0), 0));
    const mins = Array.isArray(r.quick_minutes) && r.quick_minutes.length ? r.quick_minutes : [r.est_minutes];
    const chips = mins.map(m => `<button class="chip" data-act="quick" data-id="${esc(r.id)}" data-min="${+m}">${+m}分</button>`).join('');
    return `<div class="quick-row has-rk ${rkOf(r.area)}"><div class="title">${gemHTML(r.area)}<span class="tt">${esc(r.title)}</span>${done.length ? ` <span class="badge ok">${done.length}回 ・ 換算 ${sum}分</span>` : ''}</div><div class="chips">${chips}<button class="chip ghost" data-act="detail" data-id="${esc(r.id)}" aria-label="${esc(r.title)} の詳細">${ic('dots')}詳細</button></div></div>`;
  }).join('');
  return `${head('clock', '後から記録', '終わってから 1 タップ。時間帯は今の時刻で自動')}${rows}`;
}
// 補充（routines/refill.yml、kind: refill）。洗剤・消耗品ごとに 1 タスク。記録 2 回以上なら実際の間隔から次の目安を出す
function refillItems(date, entries) {
  const dates = {};
  entries.forEach(e => { if (EARNED.has(e.status)) (dates[e.task_id] || (dates[e.task_id] = new Set())).add(e.date); });
  return activeRoutines().filter(isRefill).map(r => {
    const ds = [...(dates[r.id] || [])].sort(); const n = ds.length; const last = n ? ds[n - 1] : null;
    const avg = n >= 2 ? Math.max(1, Math.round(daysBetween(ds[0], last) / (n - 1))) : 0;
    const days = avg || +r.interval_days || 30;
    const since = last ? daysBetween(last, date) : null; const next = since === null ? null : days - since;
    return { r, n, since, days, avg, next, due: since !== null && since !== 0 && next <= 3 };
  });
}
function refillRowHTML(i) {
  const { r, n, since, days, avg, next, due } = i; const today = since === 0;
  const when = since === null ? 'まだ記録なし' : today ? 'この日 補充' : `前回 ${since}日前`;
  const cyc = avg ? `だいたい ${avg}日ごと` : `目安 ${days}日ごと`;
  const later = !today && next !== null && next > 3 ? ` ・ あと ${next} 日` : '';
  const badge = today ? '' : due ? '<span class="badge due">そろそろ</span>' : '';
  const meta = `${when} ・ ${cyc}${later}${n ? ` ・ ${n} 回` : ''}`;
  const cart = `<button class="ghost icon-only" data-act="shop-add" data-text="${esc(shopNameOf(r))}" aria-label="買い物メモへ：${esc(shopNameOf(r))}" title="買い物メモへ">${ic('cart')}</button>`;
  const tick = tickHTML(today, `data-act="done" data-min="${+r.est_minutes || 3}"`, today ? `${r.title}：この日 補充した` : `補充した：${r.title}`);
  return `<li class="task has-rk ${rkOf(r.area)}${today ? ' is-done' : ''}" data-id="${esc(r.id)}"><div class="lead">${tick}</div><div class="main"><div class="title">${ttBtn(ttIn(r, badge ? ' ' + badge : ''))}</div><div class="meta"><span>${meta}</span></div></div><div class="btns">${cart}</div></li>`;
}
function refillHTML(date, entries) {
  const items = refillItems(date, entries); if (!items.length) return '';
  const picks = [...items.filter(i => i.due).sort((a, b) => a.next - b.next), ...items.filter(i => i.since === 0)];
  let full = '';
  if (state.showRefill) {
    const groups = new Map();
    items.forEach(i => { const g = i.r.group || 'その他'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
    const order = [...REFILL_GROUPS.filter(g => groups.has(g)), ...[...groups.keys()].filter(g => !REFILL_GROUPS.includes(g))];
    full = order.map(g => `<h3 class="group">${esc(g)}</h3><ul class="tasks">${groups.get(g).map(refillRowHTML).join('')}</ul>`).join('');
  }
  return `${head('bottle', '補充', '洗剤・消耗品ごとに 1 タップ。2 回目から次の目安が出る')}
    ${picks.length ? `<ul class="tasks">${picks.map(refillRowHTML).join('')}</ul>` : '<p class="empty">そろそろの物はない。詰め替えたら「全部見る」から 1 タップ</p>'}
    <button class="ghost small wide more" data-act="refill-toggle" aria-expanded="${state.showRefill}">${state.showRefill ? '閉じる' : `全部見る（${items.length} 種）`}${ic('chev-d', 'chev')}</button>${full}`;
}
function weekHTML(today, date, entries) {
  const ws = mondayOf(date); const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const totals = days.map(d => Math.round(sumWeighted(entries, d, d)));
  const t = targetInfo(date, entries); const daily = t.target ? Math.round(t.target / 7) : 0;
  const max = Math.max(60, daily * 1.25, ...totals); const top = Math.max(...totals);
  const cols = days.map((d, i) => { const v = totals[i]; const label = (d === date || (v > 0 && v === top)) && v ? v : '';
    return `<button class="day${d === date ? ' is-today' : ''}${d > today ? ' is-future' : ''}${v && v >= daily && daily ? ' is-goal' : ''}" data-date="${d}" aria-label="${jaDate(d)} 換算 ${v} 分"><span class="v">${label}</span><span class="col"><span class="bar-c" style="height:${Math.round(v / max * 100)}%"></span></span><span class="l">${DOW_JA[dowOf(d)]}</span></button>`; }).join('');
  const byArea = {};
  entries.forEach(e => { if (e.date >= ws && e.date <= addDays(ws, 6) && EARNED.has(e.status)) { const a = e.area || 'nameless'; byArea[a] = (byArea[a] || 0) + (+e.weighted_minutes || 0); } });
  const areas = Object.entries(byArea).sort((a, b) => b[1] - a[1]).map(([a, v]) => `<span class="ak ${rkOf(a)}">${AREA_SVG[a] ? ic(AREA_SVG[a]) : ''}${esc(AREA_JA[a] || a)} <b>${Math.round(v)}</b></span>`).join('');
  return `${head('chart', ws === mondayOf(today) ? '今週' : 'その週', '換算分／日。日をタップで移動')}<div class="days${daily ? ' has-goal' : ''}" style="--goal:${daily ? (daily / max).toFixed(3) : 0}">${cols}${daily ? `<span class="goal-l">1日の目安 ${daily}</span>` : ''}</div>${areas ? `<div class="area-keys">${areas}</div>` : ''}`;
}
function logRowHTML(e, showDate) {
  const time = e.ts ? String(e.ts).slice(11, 16) : ''; const st = e.status === 'partial' ? '70点' : e.status === 'tip' ? 'コツ' : '';
  const slot = SLOT_JA[entrySlot(e, taskById(e.task_id))] || '';
  const when = showDate ? esc(e.date.slice(5).replace('-', '/')) : esc(time);
  const area = e.area || (taskById(e.task_id) || {}).area || 'nameless';
  return `<li class="${rkOf(area)}${e.status === 'tip' ? ' is-tip' : ''}${e.status === 'passed' ? ' is-pass' : ''}"><span class="t">${when}</span><span class="n">${esc(e.title || e.task_id)} <span class="badge">${slot}</span>${st ? ` <span class="badge">${st}</span>` : ''}${e.mood ? ' ' + MOODS[e.mood - 1] : ''}${e.learned ? `<span class="note">${ic('bulb')}${esc(e.learned)}</span>` : ''}${e.mode === 'shop' ? `<span class="note shop-note">${ic('cart')}${esc((e.items || []).join('・'))}</span>` : ''}</span><span class="m">${e.mode === 'shop' ? `${(e.items || []).length}点` : EARNED.has(e.status) ? `${e.actual_minutes}分 → ${Math.round(e.weighted_minutes)}` : ''}</span>${e.id ? `<button class="ghost icon-only sm" data-act="undo" data-entry="${esc(e.id)}" aria-label="取り消し" title="取り消し">${ic('x')}</button>` : ''}</li>`;
}
function logHTML(date, todays) {
  const title = isToday() ? '今日の記録' : `${jaDate(date)} の記録`;
  if (!todays.length) return `${head('list', title)}<p class="empty">まだ何もない。最初の 1 件が一番えらい</p>`;
  return `${head('list', title, `${todays.length} 件`)}<ul class="log">${[...todays].reverse().map(e => logRowHTML(e, false)).join('')}</ul>`;
}
// 検索: タスク（定期・メニュー・後から記録）、コツ、過去の記録
function renderSearch(date, todays, entries) {
  const q = norm(state.q).trim(); const box = $('#search-results');
  if (!q) { box.innerHTML = ''; return; }
  const terms = q.split(/\s+/).filter(Boolean); const hit = s => { const n = norm(s); return terms.every(t => n.includes(t)); };
  const routines = activeRoutines().filter(r => hit([r.title, r.id, r.place, r.group, AREA_JA[r.area], ...(r.checklist || []), ...stepsOf(r).map(st => st.title)].join(' '))).slice(0, 12);
  const tips = state.tips.filter(t => hit([t.title, t.body, t.action, t.topic, ...(t.tags || [])].join(' '))).slice(0, 10);
  const logs = entries.filter(e => hit([e.title, e.learned, e.task_id, ...(e.items || [])].join(' '))).slice(-8).reverse();
  const chapters = state.basics.filter(c => hit([c.title, c.summary, c.text].join(' ')));
  const stats = tipStats(entries);
  const rHtml = routines.map(r => {
    const done = todays.filter(e => e.task_id === r.id && EARNED.has(e.status)); const s = r.schedule || {};
    const kind = s.type === 'interval' ? `目安 ${s.days}日ごと` : s.type === 'manual' ? (isRefill(r) ? '補充' : '後から記録') : s.type === 'weekly' ? `毎週 ${s.day}` : '毎日';
    return `<li class="task has-rk ${rkOf(r.area)}" data-id="${esc(r.id)}"><div class="lead">${tickHTML(false, 'data-act="done"', `完了：${r.title}`)}</div><div class="main"><div class="title">${ttBtn(ttIn(r))}</div><div class="meta">${r.est_minutes}分 → 換算 ${Math.round(weighted(r, r.est_minutes))}分 ・ ${kind}${done.length ? ` ・ この日 ${done.length} 回` : ''}</div></div></li>`;
  }).join('');
  const html = (routines.length ? `<h3 class="group">タスク（${routines.length}）</h3><ul class="tasks">${rHtml}</ul>` : '')
    + (tips.length ? `<h3 class="group">コツ（${tips.length}）</h3>${tips.map(t => tipItemHTML(t, stats, true)).join('')}` : '')
    + (chapters.length ? `<h3 class="group">教科書（${chapters.length}）</h3><ul class="tasks">${chapters.map(c => `<li class="task"><div class="lead"><span class="lead-ic">${ic('book')}</span></div><div class="main"><div class="title">${esc(c.title)}</div><div class="meta">${esc(c.summary || '')}</div></div><div class="btns"><button class="ghost small" data-act="chapter-open" data-ch="${esc(c.id)}">${ic('book')}開く</button></div></li>`).join('')}</ul>` : '')
    + (logs.length ? `<h3 class="group">記録（新しい順 ${logs.length} 件）</h3><ul class="log">${logs.map(e => logRowHTML(e, true)).join('')}</ul>` : '');
  box.innerHTML = html || '<p class="empty">見つからない</p>';
}

// ---- バッジ・レベル・称号（docs/badges.md → data/badges.json）。記録から毎回計算する。取ったものは記録が残るかぎり残る ----
const AREAS = ['dishes', 'cooking', 'cleaning', 'laundry', 'nameless'];
const TIER_XP = { bronze: 10, silver: 30, gold: 100, platinum: 300, secret: 50 };
const levelOf = xp => Math.floor(Math.sqrt(Math.max(0, xp) / 100));
// レベルの段（色）。Lv0 初 / 1 銅 / 2 銀 / 3 金 / 4 白金 / 5 紅 / 6 蒼 / 7 翠 / 8 紫 / 9 以上 虹（色の値は style.css の --rk0〜8）
const RANKS = ['初', '銅', '銀', '金', '白金', '紅', '蒼', '翠', '紫', '虹'];
const rankIdx = lv => Math.max(0, Math.min(RANKS.length - 1, Math.floor(lv) || 0));
const rankCls = lv => `rk${rankIdx(lv)}`;
const rankName = lv => RANKS[rankIdx(lv)];
const TIER_RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4, secret: 8 };   // バッジの格も同じ色の言葉で
const TIER_JA = { bronze: '銅', silver: '銀', gold: '金', platinum: '白金', secret: '秘' };
const AREA_ICON = { dishes: '🧽', cooking: '🍳', cleaning: '🧹', laundry: '🧺', nameless: '✨' };
const AREA_SHORT = { dishes: '洗い物', cooking: '料理', cleaning: '掃除', laundry: '洗濯', nameless: '名もなき' };
const titleRank = (idx, len) => Math.round(idx * 9 / Math.max(1, len - 1));   // 称号の段を色の段に割り当てる
// 領域ごとの累計 XP（statAdd と同じ数え方）。タスク行の色を実績より先に決めるために描画のはじめに計算する
function areaXpOf(entries) {
  const xp = {};
  entries.forEach(e => {
    if (!EARNED.has(e.status)) return;
    const sx = stepById(e.task_id); const r = sx ? sx.parent : routineById(e.task_id); const area = e.area || (r && r.area) || 'nameless';
    xp[area] = (xp[area] || 0) + (Number.isFinite(+e.xp) ? +e.xp : Math.round(+e.weighted_minutes || 0));
  });
  return xp;
}
const areaLv = area => levelOf((state.areaXp || {})[area] || 0);
const rkOf = area => rankCls(areaLv(area));
const gemHTML = area => { const lv = areaLv(area); return `<span class="gem ${rankCls(lv)}" title="${esc(AREA_JA[area] || area)} Lv${lv}（${rankName(lv)}）">Lv${lv}</span>`; };         // §7: Lv = floor(sqrt(累計XP / 100))
const nextLevelXp = lv => (lv + 1) * (lv + 1) * 100;
function newStats() {
  return { n: 0, byTask: {}, byArea: {}, weighted: 0, weightedByArea: {}, xpByArea: {}, days: new Set(), passDays: new Set(), coreDays: new Set(),
    streakCur: 0, streakBest: 0, coreStreakCur: 0, coreStreakBest: 0, passes: 0, partials: 0, learned: 0, practiced: 0, tipStage: {},
    fast: {}, long: {}, slotDays: {}, dayCount: {}, morningCount: {}, early: 0, resume: 0, placeLast: {}, weekTotal: {}, areaDays: {}, lastDay: '',
    byKind: {}, stepEntries: 0, stepSets: {}, stepsComplete: 0, menuSteps: {},
    moods: 0, backfills: 0, dayWeighted: {}, daySlots: {}, slotCount: {}, dayTasks: {}, tipsPracticed: new Set(), firstDay: '', yearEnd: {},
    shop: { items: 0, days: {}, names: {}, refill: 0, pairs: 0, clean: 0, buys: {}, fills: {} } };
}
// ---- 買い物（logs の mode: shop の行）の数え方 ----
// 名前の比べ方: 全角半角・空白・「・」「用」・（ ）の中・末尾の個数（×2、2本 など）をそろえる
const shopKey = t => String(t || '').normalize('NFKC').replace(/[（(][^）)]*[）)]/g, '').replace(/[×✖xX]\uFE0F?\s*\d+\s*$/u, '')
  .replace(/\d+\s*(個入り|個|本|袋|パック|箱|枚|つ|ロール|kg|g|ml|l)$/i, '').replace(/[\s・用]/g, '').toLowerCase();
// 買った物がどの補充の項目か（refill.yml の buy:・title、match: の別名）。完全一致を優先し、3 文字以上の部分一致も見る
let refillKeysCache = null;
function refillOfItem(text) {
  const k = shopKey(text); if (!k) return null;
  if (!refillKeysCache) refillKeysCache = state.routines.filter(isRefill).map(r => [r.id, [shopNameOf(r), ...(Array.isArray(r.match) ? r.match : [])].map(shopKey).filter(Boolean)]);
  let best = null;
  refillKeysCache.forEach(([id, keys]) => keys.forEach(a => {
    const score = a === k ? 100 : Math.min(a.length, k.length) >= 3 && (a.includes(k) || k.includes(a)) ? Math.min(a.length, k.length) : 0;
    if (score && (!best || score > best.score)) best = { id, score };
  }));
  return best && best.id;
}
function shopStat(st, e, day) {
  const sh = st.shop; const items = Array.isArray(e.items) ? e.items : [];
  sh.items += items.length; sh.days[day] = (sh.days[day] || 0) + items.length;
  if (e.left === 0) sh.clean++;   // メモを全部買いきって記録した
  items.forEach(t => { const k = shopKey(t); if (k) sh.names[k] = (sh.names[k] || 0) + 1; const rid = refillOfItem(t); if (rid) { sh.refill++; shopPair(st, rid, day, 'buy'); } });
}
// 補充とその物の買い物が 14 日以内に並んだら 1 回（買ってから補充でも、補充してから買い足しでも）。1 つの記録は 1 回だけ使う
function shopPair(st, rid, day, kind) {
  const sh = st.shop; const other = kind === 'buy' ? sh.fills : sh.buys; const mine = kind === 'buy' ? sh.buys : sh.fills;
  const list = other[rid] || []; const i = list.findIndex(d => daysBetween(d, day) <= 14);
  if (i >= 0) { list.splice(i, 1); sh.pairs++; } else (mine[rid] || (mine[rid] = [])).push(day);
}
// 買い物をした週が何週続いたか（月曜はじまり）の最長
function shopWeeks(sh) {
  const ws = [...new Set(Object.keys(sh.days).map(mondayOf))].sort(); let best = 0, run = 0;
  ws.forEach((w, i) => { run = i && daysBetween(ws[i - 1], w) === 7 ? run + 1 : 1; best = Math.max(best, run); });
  return best;
}
const addDayTask = (st, day, pid) => { (st.dayTasks[day] || (st.dayTasks[day] = new Set())).add(pid); };
// 掃除メニューを 1 回やり終えた（親を記録、または手順が全部そろった）
function menuDone(st, r, day) {
  st.placeLast[r.place || 'その他'] = day;
  const md = day.slice(5); if (md >= '12-25' && md <= '12-31') { const y = day.slice(0, 4); st.yearEnd[y] = (st.yearEnd[y] || 0) + 1; }
}
function statAdd(st, e) {
  if (e.tip_id) { const t = st.tipStage[e.tip_id] || (st.tipStage[e.tip_id] = { stage: 0 }); if (e.tip_practiced) { t.stage = Math.min(t.stage + 1, TIP_INTERVALS.length - 1); st.practiced++; st.tipsPracticed.add(e.tip_id); } else t.stage = Math.max(0, t.stage - 1); }
  if (e.status === 'passed') { st.passes++; st.passDays.add(e.date); return; }
  if (!EARNED.has(e.status)) return;
  const sx = stepById(e.task_id); const r = sx ? sx.parent : routineById(e.task_id); const pid = r ? r.id : e.task_id;   // 手順の記録は親のタスクに数える
  const area = e.area || (r && r.area) || 'nameless'; const day = e.date;
  if (e.mode === 'shop') shopStat(st, e, day);
  if (r && isRefill(r) && !sx) shopPair(st, r.id, day, 'fill');
  st.n++; st.byArea[area] = (st.byArea[area] || 0) + 1;
  if (!st.firstDay || day < st.firstDay) st.firstDay = day;
  if (e.mood) st.moods++;
  if (e.backfill) st.backfills++;
  if (!sx) { st.byTask[pid] = (st.byTask[pid] || 0) + 1; addDayTask(st, day, pid); }   // 手順だけの記録は、その日に手順が全部そろった時点で親 1 回と数える（statEndDay）
  if (r && r.kind) st.byKind[r.kind] = (st.byKind[r.kind] || 0) + 1;
  if (sx) {
    st.stepEntries++; st.byTask[e.task_id] = (st.byTask[e.task_id] || 0) + 1;   // 手順 id 自体の回数は手順ごとのバッジ用
    if (r && isMenu(r)) {   // 掃除メニューの手順は、目安日数の範囲で全部そろえば 1 回（時間帯や日をまたいでよい。menuItems と同じ）
      const days = Math.max(1, +r.schedule.days || 7); const m = st.menuSteps[pid] || (st.menuSteps[pid] = new Map());
      m.set(e.task_id, day); for (const [k, d] of m) if (daysBetween(d, day) > days) m.delete(k);
      if (stepsOf(r).length && stepsOf(r).every(x => m.has(x.id))) { st.stepsComplete++; st.byTask[pid] = (st.byTask[pid] || 0) + 1; addDayTask(st, day, pid); menuDone(st, r, day); m.clear(); }
    } else { const k = `${day}|${pid}|${entrySlot(e, r)}`; (st.stepSets[k] || (st.stepSets[k] = new Set())).add(e.task_id); }   // 毎日のタスクは、その日のその時間帯で全部そろえば 1 回
  }
  const wm = +e.weighted_minutes || 0; st.weighted += wm; st.weightedByArea[area] = (st.weightedByArea[area] || 0) + wm;
  st.dayWeighted[day] = (st.dayWeighted[day] || 0) + wm;
  st.xpByArea[area] = (st.xpByArea[area] || 0) + (Number.isFinite(+e.xp) ? +e.xp : Math.round(wm));
  const wn = weekNoOf(day); st.weekTotal[wn] = (st.weekTotal[wn] || 0) + wm;
  if (e.status === 'partial') st.partials++;
  if (e.learned) st.learned++;
  const act = +e.actual_minutes || 0;
  if (!sx && r && r.est_minutes && act > 0 && act <= r.est_minutes / 2) st.fast[pid] = (st.fast[pid] || 0) + 1;
  if (act >= 30) st.long[pid] = (st.long[pid] || 0) + 1;
  const sl = entrySlot(e, r);
  const sd = st.slotDays[pid] || (st.slotDays[pid] = {}); (sd[day] || (sd[day] = new Set())).add(sl);
  st.dayCount[day] = (st.dayCount[day] || 0) + 1;
  (st.daySlots[day] || (st.daySlots[day] = new Set())).add(sl); st.slotCount[sl] = (st.slotCount[sl] || 0) + 1;
  if (sl === 'morning') st.morningCount[day] = (st.morningCount[day] || 0) + 1;
  const m = /T(\d\d):(\d\d)/.exec(String(e.ts || '')); if (m) { const hm = +m[1] * 60 + +m[2]; if (hm >= 180 && hm < 330) st.early++; }
  if (r && isMenu(r) && !sx) menuDone(st, r, day);
  (st.areaDays[day] || (st.areaDays[day] = new Set())).add(area);
  if (r && r.core) st.coreDays.add(day);
}
function statEndDay(st, day) {
  Object.keys(st.stepSets).forEach(k => {   // その日、手順を全部たどって終えたタスクを数える（親 1 回の完了としても数える）
    if (!k.startsWith(day + '|')) return;
    const pid = k.split('|')[1]; const r = routineById(pid);
    if (r && stepsOf(r).length && stepsOf(r).every(x => st.stepSets[k].has(x.id))) { st.stepsComplete++; st.byTask[pid] = (st.byTask[pid] || 0) + 1; addDayTask(st, day, pid); }
    delete st.stepSets[k];
  });
  const counted = (st.dayCount[day] || 0) > 0 || st.passDays.has(day);
  if (counted) {
    const prev = addDays(day, -1);
    if (st.lastDay && st.lastDay !== prev) st.resume++;                     // 途切れた翌日に再開
    st.days.add(day);
    st.streakCur = st.days.has(prev) ? st.streakCur + 1 : 1; st.streakBest = Math.max(st.streakBest, st.streakCur);
    st.lastDay = day;
  }
  if (st.coreDays.has(day)) { st.coreStreakCur = st.coreDays.has(addDays(day, -1)) ? st.coreStreakCur + 1 : 1; st.coreStreakBest = Math.max(st.coreStreakBest, st.coreStreakCur); }
}
// 終わった週ごとの結果（目標は §6.3 のランプと自動ダウンシフトで決まる）
function weekResults(st, day) {
  const t = state.config.target || {}; const final = +t.final_weighted_minutes || 0; const after = +t.auto_downshift_after_miss || 0;
  const cur = weekNoOf(day); const list = []; let penalty = 0, misses = 0;
  for (let w = 1; w < cur; w++) {
    if (addDays(weekStartOf(w), 6) >= day) break;
    const total = st.weekTotal[w] || 0; const target = final * ratioFor(w, penalty); const hit = final > 0 && total >= target;
    list.push({ w, total, target, hit, ratio: target ? total / target : 0 });
    if (!hit) { misses++; if (after && misses >= after) { penalty++; misses = 0; } } else misses = 0;
  }
  return { list, penalty };
}
function measure(b, st, earned, day) {
  const c = b.condition || {}; const gte = +c.gte || 1;
  const countOf = () => {
    if (c.kind) return st.byKind[c.kind] || 0;
    if (c.task) return st.byTask[c.task] || 0;
    if (Array.isArray(c.tasks)) return c.tasks.reduce((s, id) => s + (st.byTask[id] || 0), 0);
    if (c.area) return st.byArea[c.area] || 0;
    if (c.status === 'passed') return st.passes;
    if (c.status === 'partial') return st.partials;
    if (c.learned) return st.learned;
    if (c.practiced) return st.practiced;
    if (c.mood) return st.moods;
    if (c.backfill) return st.backfills;
    return st.n;
  };
  const lv = a => levelOf(st.xpByArea[a] || 0);
  switch (c.type) {
    case 'count': return { v: countOf(), t: gte };
    case 'first': return { v: Math.min(1, countOf()), t: 1 };
    case 'streak': return { v: st.streakBest, t: gte };
    case 'weighted_total': return { v: Math.round(c.area ? (st.weightedByArea[c.area] || 0) : st.weighted), t: gte };
    case 'target_hit': {
      const wr = weekResults(st, day).list;
      if (c.consecutive) { let best = 0, run = 0; wr.forEach(x => { run = x.hit ? run + 1 : 0; best = Math.max(best, run); }); return { v: best, t: +c.consecutive }; }
      if (c.ratio_gte) return { v: wr.some(x => x.ratio >= +c.ratio_gte) ? 1 : 0, t: 1 };
      return { v: wr.filter(x => x.hit).length, t: gte };
    }
    case 'level':
      if (c.area) return { v: lv(c.area), t: gte };
      if (c.all) return { v: Math.min(...AREAS.map(lv)), t: gte };
      if (c.areas_gte) return { v: AREAS.filter(a => lv(a) >= gte).length, t: +c.areas_gte };
      return { v: Math.max(...AREAS.map(lv)), t: gte };
    case 'combo': { const ids = c.all_of || []; return { v: ids.filter(id => earned[id]).length, t: ids.length }; }
    case 'custom': return customMeasure(c, st, day, gte);
  }
  return { v: 0, t: 1 };
}
function customMeasure(c, st, day, gte) {
  const daysWhere = (obj, n) => Object.keys(obj).filter(d => obj[d] >= n).length;
  switch (c.key) {
    case 'fast': return { v: st.fast[c.task] || 0, t: gte };
    case 'long': return { v: st.long[c.task] || 0, t: gte };
    case 'both_slots': { const sd = st.slotDays[c.task] || {}; return { v: Object.keys(sd).filter(d => sd[d].size >= 2).length, t: gte }; }
    case 'trio': { const areas = c.areas || []; return { v: Object.keys(st.areaDays).filter(d => areas.every(a => st.areaDays[d].has(a))).length, t: gte }; }
    case 'day_entries': return { v: daysWhere(st.dayCount, +c.n || 10), t: gte };
    case 'morning_entries': return { v: daysWhere(st.morningCount, +c.n || 3), t: gte };
    case 'weekend_days': return { v: Object.keys(st.dayCount).filter(d => st.dayCount[d] >= (+c.n || 5) && (dowOf(d) === 0 || dowOf(d) === 6)).length, t: gte };
    case 'early': return { v: st.early, t: gte };
    case 'core_streak': return { v: st.coreStreakBest, t: gte };
    case 'resume': return { v: st.resume, t: gte };
    case 'all_places': { const places = [...new Set(activeRoutines().filter(isMenu).map(r => r.place || 'その他'))]; const within = +c.days || 30;
      return { v: places.filter(p => st.placeLast[p] && daysBetween(st.placeLast[p], day) <= within).length, t: places.length }; }
    case 'everyday_weeks': { let v = 0; const cur = weekNoOf(day); for (let w = 1; w < cur; w++) { const a = weekStartOf(w); if (addDays(a, 6) >= day) break; if ([...Array(7)].every((_, i) => st.days.has(addDays(a, i)))) v++; } return { v, t: gte }; }
    case 'tip_stage': { const need = c.stage != null ? +c.stage : TIP_INTERVALS.length - 1; return { v: Object.values(st.tipStage).filter(t => t.stage >= need).length, t: gte }; }
    case 'best_week': { const wr = weekResults(st, day).list; let best = -1, v = 0; wr.forEach((x, i) => { if (i > 0 && x.total > best) v++; best = Math.max(best, x.total); }); return { v, t: gte }; }
    case 'ramp_top': return { v: ratioFor(weekNoOf(day), weekResults(st, day).penalty) >= 1 ? 1 : 0, t: 1 };
    case 'step_entries': return { v: st.stepEntries, t: gte };
    case 'steps_complete': return { v: st.stepsComplete, t: gte };
    case 'record_days': return { v: Object.keys(st.dayCount).length, t: gte };
    case 'since_first': return { v: st.firstDay ? daysBetween(st.firstDay, day) : 0, t: +c.n || 30 };
    case 'full_months': {   // 終わった暦の月で、全部の日に記録（パスを含む）があるもの
      let v = 0; new Set([...st.days].map(d => d.slice(0, 7))).forEach(ym => {
        const [y, mo] = ym.split('-').map(Number); const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        if (`${ym}-${String(dim).padStart(2, '0')}` <= day && [...Array(dim)].every((_, i) => st.days.has(`${ym}-${String(i + 1).padStart(2, '0')}`))) v++;
      }); return { v, t: gte }; }
    case 'seasons': { const s = new Set([...st.days].map(d => { const m = +d.slice(5, 7); return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'; })); return { v: s.size, t: gte }; }
    case 'dow_cover': { const cnt = [0, 0, 0, 0, 0, 0, 0]; Object.keys(st.dayCount).forEach(d => cnt[dowOf(d)]++); return { v: cnt.filter(x => x >= (+c.n || 1)).length, t: 7 }; }
    case 'tasks_day': { const ts = c.tasks || []; return { v: Object.keys(st.dayTasks).filter(d => ts.every(id => st.dayTasks[d].has(id))).length, t: gte }; }
    case 'distinct': {   // 種類数。削除したものは数えない。all: true は「今出ている全種類」
      const pool = activeRoutines().filter(r => c.of === 'refill' ? isRefill(r) : c.of === 'menu' ? isMenu(r) : true).filter(r => !c.place || (r.place || 'その他') === c.place);
      return { v: pool.filter(r => (st.byTask[r.id] || 0) > 0).length, t: c.all ? pool.length : gte }; }
    case 'menu_count': { const ids = activeRoutines().filter(r => isMenu(r) && (+r.schedule.days || 0) >= (+c.min_days || 0)).map(r => r.id); return { v: ids.reduce((a, id) => a + (st.byTask[id] || 0), 0), t: gte }; }
    case 'day_weighted': return { v: Object.keys(st.dayWeighted).filter(d => st.dayWeighted[d] >= (+c.n || 60)).length, t: gte };
    case 'light_days': return { v: Object.keys(st.dayWeighted).filter(d => d < day && st.dayWeighted[d] > 0 && st.dayWeighted[d] <= (+c.n || 20)).length, t: gte };   // その日はまだ増えるかもしれないので前日まで
    case 'all_slots_days': return { v: Object.keys(st.daySlots).filter(d => SLOTS.every(sl => st.daySlots[d].has(sl.id))).length, t: gte };
    case 'slot_total': return { v: st.slotCount[c.slot] || 0, t: gte };
    case 'tips_distinct': return { v: st.tipsPracticed.size, t: gte };
    case 'fast_total': return { v: Object.values(st.fast).reduce((a, x) => a + x, 0), t: gte };
    case 'on_date': { const md = c.md || []; return { v: [...st.days].filter(d => c.zorome ? d.slice(5, 7) === d.slice(8, 10) : md.includes(d.slice(5))).length, t: gte }; }
    case 'year_end': return { v: Math.max(0, ...Object.values(st.yearEnd)), t: gte };
    case 'shop': {   // 買い物。of: items 点数 / days 日数 / distinct 種類 / same 同じ物の最多 / bulk n 点以上の日 / weeks 続いた週 / refill 補充の物 / pairs 補充とのつながり / clean 買いきった回
      const sh = st.shop;
      const v = { items: sh.items, days: Object.keys(sh.days).length, distinct: Object.keys(sh.names).length, same: Math.max(0, ...Object.values(sh.names)),
        bulk: Object.values(sh.days).filter(x => x >= (+c.n || 10)).length, weeks: shopWeeks(sh), refill: sh.refill, pairs: sh.pairs, clean: sh.clean }[c.of];
      return { v: v || 0, t: gte }; }
  }
  return { v: 0, t: 1 };
}
// 記録を日付順にたどり、各日の終わりに未獲得バッジを判定する（獲得日 = その日）
function evaluateBadges(entries) {
  const badges = state.badges; const earned = {}; const st = newStats();
  if (!badges.length) return { earned, st };
  const byDay = {}; entries.forEach(e => { (byDay[e.date] || (byDay[e.date] = [])).push(e); });
  Object.keys(byDay).sort().forEach(day => {
    byDay[day].forEach(e => statAdd(st, e)); statEndDay(st, day);
    for (let pass = 0; pass < 2; pass++) badges.forEach(b => { if (!earned[b.id]) { const m = measure(b, st, earned, day); if (m.t > 0 && m.v >= m.t) earned[b.id] = day; } });
  });
  return { earned, st };
}
// 称号の段（config.yml の titles）。all: true は「出ているバッジを全部」。出ているバッジより多く要る段は外す
function titleList(total) {
  const ts = (state.config.titles || []).map(t => ({ name: t.name, badges: t.all ? total : +t.badges, all: !!t.all })).filter(t => t.name && Number.isFinite(t.badges) && (t.all || t.badges < total));
  return [{ name: '駆け出し', badges: 0 }, ...ts.sort((a, b) => a.badges - b.badges || (a.all ? 1 : -1))];
}
function titleFor(n, total) {
  const list = titleList(total); let cur = list[0]; list.forEach(t => { if (n >= t.badges) cur = t; });
  return { name: cur.name, cur, idx: list.indexOf(cur), next: list.find(t => n < t.badges), list };
}
// 削除したタスクだけが条件のバッジ（取っていないもの）は一覧と総数から外す。タスクを戻すと出てくる
const taskHidden = id => { const x = stepById(id); return x ? (isHidden(x.parent.id) || isHidden(id)) : (isHidden(id) || !routineById(id)); };
function badgeDormant(b, earned, seen = new Set()) {
  if (earned[b.id] || seen.has(b.id)) return false; seen.add(b.id);
  const c = b.condition || {}; const refs = [...(c.task ? [c.task] : []), ...(Array.isArray(c.tasks) ? c.tasks : [])];
  if (refs.length && c.type !== 'custom' && refs.every(taskHidden)) return true;
  if (c.type === 'custom' && ['fast', 'long', 'both_slots'].includes(c.key) && c.task && taskHidden(c.task)) return true;
  if (c.type === 'custom' && c.key === 'tasks_day' && (c.tasks || []).some(taskHidden)) return true;
  if (c.type === 'custom' && c.key === 'distinct' && c.place && !activeRoutines().some(r => isMenu(r) && (r.place || 'その他') === c.place)) return true;
  if (c.type === 'combo') return (c.all_of || []).some(id => { const o = state.badges.find(x => x.id === id); return o && badgeDormant(o, earned, seen); });
  return false;
}
function badgeTileHTML(b, when, m) {
  if (!when && b.secret) return '<div class="badge-tile locked secret rk8"><span class="tier">秘</span><div class="ic">❔</div><div class="nm">???</div><div class="ds">シークレット</div></div>';
  const pct = m.t ? Math.min(100, Math.round(m.v / m.t * 100)) : 0; const tj = TIER_JA[b.tier];
  return `<div class="badge-tile ${when ? 'earned' : 'locked'} ${rankCls(TIER_RANK[b.tier] ?? 1)} ${esc(b.tier || '')}">${tj ? `<span class="tier">${tj}</span>` : ''}<div class="ic">${b.icon}</div><div class="nm">${esc(b.name)}</div><div class="ds">${esc(b.desc || '')}</div>${when ? `<div class="when">${esc(when.slice(0, 10).replace(/-/g, '/'))} 獲得</div>` : `<div class="bar mini"><div class="fill" style="width:${pct}%"></div></div><div class="when">${m.v}/${m.t}</div>`}</div>`;
}
function achievementsHTML(today, date, entries, all) {
  if (!state.badges.length) return '';
  const ev = evaluateBadges(entries); const { earned, st } = ev; state.earned = earned;
  // 獲得トーストと昇段の比較用は、表示日に関係なく全記録で見る（過去日から今日へ戻っただけで「獲得」「昇段」と出さない）
  const evAll = date === today ? ev : evaluateBadges(all);
  state.earnedAll = evAll.earned;
  state.lvAll = Object.fromEntries(AREAS.map(a => [a, levelOf(evAll.st.xpByArea[a] || 0)]));
  state.titleAll = titleFor(Object.keys(evAll.earned).length, state.badges.filter(b => !badgeDormant(b, evAll.earned)).length);
  const shown = state.badges.filter(b => !badgeDormant(b, earned));
  const n = Object.keys(earned).length; const total = shown.length;
  const bonus = state.badges.filter(b => earned[b.id]).reduce((s, b) => s + (+b.xp_bonus || TIER_XP[b.tier] || 10), 0);
  const xp = Object.values(st.xpByArea).reduce((s, v) => s + v, 0) + bonus;
  const ttl = titleFor(n, total); const tRank = titleRank(ttl.idx, ttl.list.length);
  // 称号の札: 段の番号・名前・次の称号までの進み
  const lo = ttl.cur.badges, hi = ttl.next ? ttl.next.badges : lo; const tpct = ttl.next ? Math.round((n - lo) / Math.max(1, hi - lo) * 100) : 100;
  const plate = `<div class="title-plate ${rankCls(tRank)}"><div class="tp-emblem"><small>第</small><b>${ttl.idx + 1}</b><small>段</small></div><div class="tp-main"><div class="tp-label">称号 ・ 全 ${ttl.list.length} 段</div><div class="tp-name">${esc(ttl.name)}</div><div class="bar tp-bar"><div class="fill" style="width:${tpct}%"></div></div><div class="tp-next">${ttl.next ? `次は「${esc(ttl.next.name)}」 あと ${ttl.next.badges - n} 個` : '最上段に到達'}</div></div></div>`;
  const stats = `<div class="stats"><div class="stat"><span class="k">${ic('trophy')}バッジ</span><b>${n}</b><span class="u">/${total}</span></div><div class="stat"><span class="k">${ic('sparkle')}XP</span><b>${xp.toLocaleString()}</b></div><div class="stat"><span class="k">${ic('flame')}最長連続</span><b>${st.streakBest}</b><span class="u">日</span></div><div class="stat"><span class="k">${ic('clock')}換算</span><b>${Math.round(st.weighted / 60)}</b><span class="u">時間</span></div><div class="stat"><span class="k">${ic('cart')}買い物</span><b>${st.shop.items}</b><span class="u">点</span></div><div class="stat"><span class="k">${ic('bulb')}コツ実践</span><b>${st.practiced}</b><span class="u">回</span></div></div>`;
  // 領域のメダル: 輪は次の Lv までの進み、色は段。押すとその領域の詳しい数字
  const info = AREAS.map(a => { const x = st.xpByArea[a] || 0; const lv = levelOf(x); const lo2 = lv * lv * 100, hi2 = nextLevelXp(lv); return { a, x, lv, hi: hi2, p: Math.round((x - lo2) / (hi2 - lo2) * 100) }; });
  const focus = info.find(i => i.a === state.lvFocus) || info.slice().sort((p, q) => q.p - p.p)[0];
  const medals = info.map(i => `<button class="medal ${rankCls(i.lv)}${i === focus ? ' is-focus' : ''}${state.lvUp.includes(i.a) ? ' is-up' : ''}" data-act="lv-focus" data-area="${i.a}" style="--p:${i.lv >= 9 ? 100 : i.p}" aria-label="Lv${i.lv} ${rankName(i.lv)} ${AREA_SHORT[i.a]}（${AREA_JA[i.a]}）"><span class="ring"><span class="core">${ic(AREA_SVG[i.a])}</span></span><span class="lv">Lv${i.lv}<i>${rankName(i.lv)}</i></span><span class="nm">${AREA_SHORT[i.a]}</span></button>`).join('');
  const detail = `<div class="medal-detail"><div><b>${AREA_JA[focus.a]}</b><span class="rank-chip ${rankCls(focus.lv)}">Lv${focus.lv} ${rankName(focus.lv)}</span><span class="num">${focus.x.toLocaleString()} / ${focus.hi.toLocaleString()} XP</span></div><div><span>あと <b class="num">${(focus.hi - focus.x).toLocaleString()}</b> XP で</span><span class="rank-chip ${rankCls(focus.lv + 1)}">Lv${focus.lv + 1} ${rankName(focus.lv + 1)}</span></div></div>`;
  const legend = `<div class="rank-legend" aria-label="レベルの色">${RANKS.map((k, i) => `<span class="${rankCls(i)}">${i === RANKS.length - 1 ? `Lv${i}+` : `Lv${i}`} ${k}</span>`).join('')}</div>`;
  const measured = shown.map(b => ({ b, m: measure(b, st, earned, date) }));
  const near = measured.filter(x => !earned[x.b.id] && !x.b.secret && x.m.t > 0).map(x => ({ ...x, r: Math.min(1, x.m.v / x.m.t) })).sort((a, b) => b.r - a.r || a.m.t - b.m.t).slice(0, 3);
  const recent = state.badges.filter(b => earned[b.id]).sort((a, b) => earned[b.id].localeCompare(earned[a.id])).slice(0, 3);
  const tierRk = b => rankCls(TIER_RANK[b.tier] ?? 1);
  const nearHtml = near.map(x => `<div class="near ${tierRk(x.b)}"><span class="bic">${x.b.icon}</span><span class="nm">${esc(x.b.name)}</span><div class="bar"><div class="fill" style="width:${Math.round(x.r * 100)}%"></div></div><span class="sub">${x.m.v}/${x.m.t}</span></div>`).join('');
  const recentHtml = recent.map(b => `<div class="near recent ${tierRk(b)}"><span class="bic">${b.icon}</span><span class="nm">${esc(b.name)} <span class="sub">${esc(b.desc || '')}</span></span><span class="sub when">${esc(earned[b.id].slice(5).replace('-', '/'))}</span></div>`).join('');
  let room = '';
  if (state.showTrophy) {
    // 称号の段（色は段の格。今の段は塗りつぶし）と、分類のチップ（押すとその分類だけ）
    const ladder = ttl.list.map((t, i) => `<span class="tl ${rankCls(titleRank(i, ttl.list.length))}${n >= t.badges ? ' got' : ''}${t === ttl.cur ? ' now' : ''}">${esc(t.name)}<b>${t.all ? '全部' : t.badges}</b></span>`).join('');
    const cats = [...new Set(shown.map(b => b.cat || 'その他'))];
    const cat = cats.includes(state.trophyCat) ? state.trophyCat : '';
    const chips = [`<button class="chip${cat ? '' : ' is-on'}" data-act="trophy-cat" data-cat="">すべて ${n}/${total}</button>`, ...cats.map(c => {
      const list = shown.filter(b => (b.cat || 'その他') === c); return `<button class="chip${cat === c ? ' is-on' : ''}" data-act="trophy-cat" data-cat="${esc(c)}">${esc(c)} ${list.filter(b => earned[b.id]).length}/${list.length}</button>`; })].join('');
    room = `<h3 class="group">称号 <span class="sub">全 ${ttl.list.length} 段。バッジの数で上がる</span></h3><div class="ladder">${ladder}</div><div class="chips trophy-cats">${chips}</div>` +
      (cat ? [cat] : cats).map(c => { const list = shown.filter(b => (b.cat || 'その他') === c); const got = list.filter(b => earned[b.id]).length;
        return `<h3 class="group">${esc(c)} <span class="sub">${got}/${list.length}</span></h3><div class="badge-grid">${list.map(b => badgeTileHTML(b, earned[b.id], measured.find(x => x.b === b).m)).join('')}</div>`; }).join('');
  }
  return `${head('trophy', '実績', date !== today ? `${esc(date.slice(5).replace('-', '/'))} 時点` : '', ` <span class="sub only-collapsed">称号 <b>${esc(ttl.name)}</b> ・ ${n}/${total}</span>`)}
    ${plate}${stats}
    <h3 class="group">領域のレベル <span class="sub">Lv が上がると色が変わる</span></h3><div class="medals">${medals}</div>${detail}${legend}
    ${near.length ? `<h3 class="group">あと少し</h3>${nearHtml}` : ''}
    ${recent.length ? `<h3 class="group">最近の獲得</h3>${recentHtml}` : ''}
    <button class="ghost small wide" data-act="trophy-toggle">${state.showTrophy ? '閉じる' : `トロフィールームを開く（全 ${total} 種）`}</button>${room}`;
}

// ---- 昇段と称号アップの演出 ----
let celTimer;
function celebrate(items) {
  const box = $('#celebrate'); if (!box || !items.length) return;
  const [main, ...more] = items;
  const colors = ['--rk1', '--rk2', '--rk3', '--rk4', '--rk5', '--rk6', '--rk7', '--rk8'];
  const confetti = [...Array(18)].map((_, i) => `<i class="cf" style="--x:${Math.round(Math.random() * 96)}%;--d:${(Math.random() * .5).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg;--c:var(${colors[i % colors.length]})"></i>`).join('');
  box.className = `celebrate ${main.rk}`;
  box.innerHTML = `<div class="cel-card" role="status"><div class="cel-rays"></div>${confetti}<div class="cel-kicker">${esc(main.kicker)}</div><div class="cel-medal">${main.icon}</div><div class="cel-main">${main.html}</div><div class="cel-sub">${esc(main.sub)}</div>${more.length ? `<div class="cel-more">${more.map(m => `<div>${m.icon} ${esc(m.kicker === 'LEVEL UP' ? 'Lv アップ' : m.kicker)} ${m.html}</div>`).join('')}</div>` : ''}<div class="cel-close">タップで閉じる</div></div>`;
  box.hidden = false;
  clearTimeout(celTimer); celTimer = setTimeout(() => { box.hidden = true; }, 4200);
}
$('#celebrate').addEventListener('click', () => { $('#celebrate').hidden = true; });

// ---- 操作 ----
let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2500);
}
async function run(fn, okMsg) {
  if (state.busy) return;
  const before = state.loaded ? new Set(Object.keys(state.earnedAll || {})) : null; let ok = false;   // 初回読み込みでは過去の獲得を通知しない
  const lvBefore = state.loaded ? { ...(state.lvAll || {}) } : null; const titleBefore = state.loaded ? state.titleAll : null;
  state.busy = true;
  if (state.loaded) render(); else document.body.classList.add('busy');   // 最初の読み込み中は骨組みのまま（記録なしの仮の数字を出さない）
  try { await fn(); ok = true; }
  catch (e) { console.error(e); toast(e.message || String(e), true); }
  finally {
    state.busy = false; render();
    const news = before ? state.badges.filter(b => (state.earnedAll || {})[b.id] && !before.has(b.id)) : [];
    if (news.length) toast(`🏅 バッジ獲得: ${news.map(b => b.icon + ' ' + b.name).join('、')}${okMsg ? ' ・ ' + okMsg : ''}`);
    else if (ok && okMsg) toast(okMsg);
    // 領域の Lv が上がった・称号が上がったら演出（記録を増やしたときだけ。取り消しや日付の移動では出さない）
    if (ok && lvBefore && state.lvAll) {
      const ups = AREAS.filter(a => (state.lvAll[a] || 0) > (lvBefore[a] || 0));
      const items = ups.map(a => { const lv = state.lvAll[a]; return { rk: rankCls(lv), icon: ic(AREA_SVG[a]), kicker: 'LEVEL UP', html: `${esc(AREA_JA[a])} <span class="gem ${rankCls(lv)}">Lv${lv}</span>`, sub: rankIdx(lv) > rankIdx(lvBefore[a] || 0) ? `段の色が「${rankName(lvBefore[a] || 0)}」から「${rankName(lv)}」に変わった` : '虹のまま、さらに上へ' }; });
      const tA = state.titleAll, tB = titleBefore;
      if (tA && tB && tA.idx > tB.idx) items.push({ rk: rankCls(titleRank(tA.idx, tA.list.length)), icon: ic('trophy'), kicker: '称号アップ', html: esc(tA.name), sub: `「${tB.name}」から 1 段上がった` });
      if (items.length) {
        state.lvUp = ups; render(); celebrate(items);
        setTimeout(() => { state.lvUp = []; }, 5000);
      }
    }
  }
}
function requireToken() { if (state.token) return true; toast('先に ⚙ でトークンを保存する', true); openSettings(); return false; }
// 記録の共通部分。表示日が今日なら時刻を残す（config.privacy.log_time）。過去日への追記は backfill 扱いで時刻なし
function baseEntry() {
  const now = nowParts(); const date = viewDate(); const e = { date };
  if (date === now.date) { if (!(state.config.privacy && state.config.privacy.log_time === false)) e.ts = now.iso; }
  else e.backfill = true;
  return e;
}
async function append(e, message, okMsg) {
  await run(async () => {
    await ensureMonths(e.date, e.date);
    await mutateMonth(ymOf(e.date), lines => [...lines, JSON.stringify(e)], message);
    state.streak = await computeStreak(nowParts().date);
  }, okMsg);
}
// 完了した直後の行（数秒だけ光らせる）
const justDone = (id, slot) => !!state.justDone && state.justDone.id === id && (!slot || state.justDone.slot === slot) && Date.now() - state.justDone.at < 4000;
async function record(r, { minutes, mood, learned, status = 'done', tip_id, tip_practiced, slot }) {
  if (!requireToken()) return;
  try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* 振動できない端末 */ }
  const e = baseEntry();
  Object.assign(e, { task_id: r.id, title: r.title, area: r.area, slot: SLOT_JA[slot] ? slot : currentSlot(), status, mode: 'full', actual_minutes: minutes, weight: weightOf(r), weighted_minutes: weighted(r, minutes), xp: Math.round(weighted(r, minutes)) });
  if (r.parent) e.parent = r.parent;   // 手順の記録。親タスクの id
  if (tip_id) { e.tip_id = tip_id; e.tip_practiced = !!tip_practiced; }
  if (mood) e.mood = mood;
  if (learned) e.learned = learned;
  e.id = uid();
  state.justDone = { id: r.parent || r.id, slot: e.slot, at: Date.now() };
  await append(e, `log: ${r.id} ${e.date} ${minutes}m [skip ci]`, `${SLOT_JA[e.slot]}: ${r.title} ${minutes}分 → 換算 ${Math.round(e.weighted_minutes)}分`);
}
async function recordPass() {
  if (!requireToken()) return;
  const e = baseEntry();
  Object.assign(e, { task_id: '_pass', title: 'パス（ストリーク維持）', status: 'passed', mode: 'full', actual_minutes: 0, weight: 1, weighted_minutes: 0, xp: 0, id: uid() });
  await append(e, `log: pass ${e.date} [skip ci]`, 'パス。ストリークは続く');
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
async function setDate(d) {
  const today = nowParts().date;
  if (d && d > today) d = today;
  state.viewDate = d && d !== today ? d : '';
  const date = viewDate();
  await run(async () => { await ensureMonths(addDays(mondayOf(date), -7), date); });
}

// iPhone の Safari で押した瞬間の見た目（:active）を出すため
document.addEventListener('touchstart', () => {}, { passive: true });
document.addEventListener('click', ev => {
  const day = ev.target.closest('.day[data-date]'); if (day && !state.busy) { setDate(day.dataset.date); return; }
  const b = ev.target.closest('button[data-act]'); if (!b || b.disabled) return;
  if (state.busy && !/^chapter/.test(b.dataset.act) && !/toggle|tip-next/.test(b.dataset.act)) return;
  const host = b.closest('[data-id]'); const id = b.dataset.id || (host ? host.dataset.id : '');
  const r = taskById(id);
  switch (b.dataset.act) {
    case 'done': if (r) record(r, { minutes: +b.dataset.min || +r.est_minutes, slot: b.dataset.slot }); break;
    case 'quick': if (r) record(r, { minutes: +b.dataset.min }); break;
    case 'detail': if (r) openDetail(r, b.dataset.slot, +b.dataset.min || 0); break;
    case 'steps-toggle': state.openSteps.set(b.dataset.key, b.getAttribute('aria-expanded') !== 'true'); render(); break;
    case 'refill-toggle': state.showRefill = !state.showRefill; render(); break;
    case 'collapse-toggle': setCollapsed(b.dataset.card, !collapsed.has(b.dataset.card)); break;
    case 'shop-add': shopAdd(b.dataset.text); break;
    case 'shop-add-input': shopAdd($('#shop-input').value); break;
    case 'shop-toggle': { const li = b.closest('[data-sid]'); if (li) shopToggle(li.dataset.sid); break; }
    case 'shop-remove': { const li = b.closest('[data-sid]'); if (li) shopRemove(li.dataset.sid); break; }
    case 'shop-record': shopRecord(); break;
    case 'shop-share': shopShare(); break;
    case 'undo': undo(b.dataset.entry); break;
    case 'pass': recordPass(); break;
    case 'menu-toggle': state.showMenu = !state.showMenu; render(); break;
    case 'tip-practiced': recordTip(b.dataset.tip); break;
    case 'tip-next': state.tipOffset++; render(); break;
    case 'tips-toggle': state.showTips = !state.showTips; render(); break;
    case 'chapter': openChapter(b.dataset.ch, false); break;
    case 'chapter-open': openChapter(b.dataset.ch, true); break;
    case 'trophy-toggle': state.showTrophy = !state.showTrophy; render(); break;
    case 'trophy-cat': state.trophyCat = b.dataset.cat || ''; render(); break;
    case 'lv-focus': state.lvFocus = b.dataset.area || ''; render(); break;
  }
});

// 詳細ダイアログ（時間・時間帯・気分・気づき・コツ・70点完了）
let detailRoutine = null, detailMood = 0, detailMin = 0, detailTip = null, detailSlot = 'night', detailFromSlot = '';
function openDetail(r, slot, min) {
  detailRoutine = r; detailMood = 0; detailMin = +min || estOf(r) || 0; detailSlot = SLOT_JA[slot] ? slot : currentSlot(); detailFromSlot = SLOT_JA[slot] ? slot : '';
  // 削除（非表示）。朝と夜の両方に出るタスクは、開いた欄だけ消す選択肢も出す
  const kindLabel = r.parent ? 'この手順' : isMenu(r) ? 'このメニュー' : isRefill(r) ? 'この項目' : 'このタスク';
  $('#detail-delete').textContent = `${kindLabel}を削除…`; $('#detail-delete-panel').hidden = true;
  const multiSlot = !r.parent && !!detailFromSlot && slotsOf(r).filter(sid => !isHidden(`${r.id}@${sid}`)).length >= 2;
  $('#detail-delete-slot').hidden = !multiSlot; if (multiSlot) $('#detail-delete-slot').textContent = `${SLOT_JA[detailFromSlot]}の欄からだけ消す`;
  $('#detail-delete-all').textContent = `${kindLabel}を削除（記録は残る）`;
  detailTip = tipForRoutine(r, tipStats(allEntries()));
  $('#detail-tip-wrap').hidden = !detailTip;
  if (detailTip) { $('#detail-tip').innerHTML = tipBoxHTML(detailTip); $('#detail-tip-practiced').checked = false; }
  $('#detail-title').textContent = r.title; $('#detail-w').textContent = `負荷の係数 ×${weightOf(r).toFixed(2)}${isToday() ? '' : ` ・ ${jaDate(viewDate())} に記録`}`;
  const opts = [...new Set([detailMin, estOf(r), ...(r.quick_minutes || []).map(Number), 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120].filter(n => n > 0))].sort((a, b) => a - b);
  $('#detail-minutes').innerHTML = opts.map(m => `<button type="button" class="chip${m === detailMin ? ' is-on' : ''}" data-min="${m}">${m}分</button>`).join('');
  $('#detail-slot').innerHTML = SLOTS.map(s => `<button type="button" class="chip${s.id === detailSlot ? ' is-on' : ''}" data-slot="${s.id}">${s.ja}</button>`).join('');
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
  if (b.dataset.slot) { detailSlot = b.dataset.slot; [...$('#detail-slot').children].forEach(c => c.classList.toggle('is-on', c === b)); }
  if (b.dataset.mood) { const v = +b.dataset.mood; detailMood = detailMood === v ? 0 : v; [...$('#detail-mood').children].forEach(c => c.classList.toggle('is-on', +c.dataset.mood === detailMood)); }
  if (b.id === 'detail-cancel') $('#dlg-detail').close();
  if (b.id === 'detail-delete') { const p = $('#detail-delete-panel'); p.hidden = !p.hidden; }
  if (b.id === 'detail-delete-cancel') $('#detail-delete-panel').hidden = true;
  if (b.id === 'detail-delete-slot' || b.id === 'detail-delete-all') {
    const key = b.id === 'detail-delete-slot' ? `${detailRoutine.id}@${detailFromSlot}` : detailRoutine.id;
    $('#dlg-detail').close(); hideTask(key);
  }
  if (b.id === 'detail-done' || b.id === 'detail-partial') {
    const custom = parseInt($('#detail-custom').value, 10); const minutes = custom > 0 ? custom : detailMin;
    if (!(minutes > 0)) { toast('時間を選ぶ', true); return; }
    const learned = $('#detail-note').value.trim().slice(0, 140);
    $('#dlg-detail').close();
    record(detailRoutine, { minutes, slot: detailSlot, mood: detailMood || undefined, learned: learned || undefined, status: b.id === 'detail-partial' ? 'partial' : 'done',
      tip_id: detailTip ? detailTip.id : undefined, tip_practiced: detailTip ? $('#detail-tip-practiced').checked : undefined });
  }
});

// 設定（トークン）
function openSettings() {
  $('#token').value = state.token; $('#settings-status').textContent = state.token ? '保存済み（この端末のみ）' : '未設定';
  renderHiddenList();
  $('#dlg-settings').showModal();
}
$('#hidden-list').addEventListener('click', ev => { const b = ev.target.closest('button[data-act="unhide"]'); if (b && !state.busy) unhideTask(b.dataset.key); });
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

// 日付の切り替えと検索
$('#date-pick').addEventListener('click', ev => { const inp = $('#date-input'); if (ev.target === inp || !inp.showPicker) return; ev.preventDefault(); try { inp.showPicker(); } catch { inp.focus(); } });
$('#btn-date-prev').addEventListener('click', () => { if (!state.busy) setDate(addDays(viewDate(), -1)); });
$('#btn-date-next').addEventListener('click', () => { if (!state.busy) setDate(addDays(viewDate(), 1)); });
$('#btn-today').addEventListener('click', () => { if (!state.busy) setDate(''); });
$('#date-input').addEventListener('change', ev => { if (ev.target.value && !state.busy) setDate(ev.target.value); });
$('#app').addEventListener('input', ev => { if (ev.target.id === 'shop-input') state.shopDraft = ev.target.value; });
$('#app').addEventListener('keydown', ev => { if (ev.target.id === 'shop-input' && ev.key === 'Enter') { ev.preventDefault(); shopAdd(ev.target.value); } });
$('#q').addEventListener('input', ev => {
  state.q = ev.target.value; const date = viewDate(); const entries = allEntries().filter(e => e.date <= date);
  renderSearch(date, entries.filter(e => e.date === date), entries);
});

// ---- 起動 ----
// 記録（logs・prefs・買い物メモ）を GitHub から読む。要るのは設定（リポジトリ名）だけなので、起動時はほかのデータと並行して読む
async function loadLogs() {
  state.months.clear();
  const today = nowParts().date; const a = addDays(startMonday(), -7), b = addDays(today, -366);
  const pf = fetchPrefs().catch(() => state.prefsFile || { sha: null, data: { hidden: [] } });   // 読めなくても動く（書くときに読み直す）
  const sf = fetchJsonFile('shopFile').catch(() => state.shopFile);
  await ensureMonths(a > b ? a : b, today);
  state.prefsFile = await pf; state.shopFile = await sf;
  if (state.viewDate) await ensureMonths(addDays(mondayOf(state.viewDate), -7), state.viewDate);
  state.streak = await computeStreak(today);
}
async function reload() { await run(async () => { await loadLogs(); state.loaded = true; }); }
async function init() {
  { const t = nowParts().date; renderSky(t, t); }   // 空・あいさつ・日付はすぐ出す
  try { state.token = localStorage.getItem(TOKEN_KEY) || ''; } catch { state.token = ''; }
  let logs = null;
  try {
    const get = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); });
    const pConfig = get('data/config.json');
    const pRest = Promise.all([get('data/routines.json'), get('data/knowledge.json').catch(() => []), get('data/basics.json').catch(() => []), get('data/badges.json').catch(() => [])]); pRest.catch(() => {});
    state.config = (await pConfig) || {};
    logs = loadLogs(); logs.catch(() => {});   // 記録はすぐ取りに行く（失敗は下の run で知らせる）
    const [routines, tips, basics, badges] = await pRest;
    state.routines = Array.isArray(routines) ? routines : []; stepIndexCache = null; refillKeysCache = null; state.tips = Array.isArray(tips) ? tips : []; state.basics = Array.isArray(basics) ? basics : []; state.badges = Array.isArray(badges) ? badges : [];
  } catch (e) { $('#tasks').innerHTML = `<p class="empty">設定の読み込みに失敗: ${esc(e.message)}</p>`; return; }
  const rp = repo();
  $('#repo-link').href = `https://github.com/${rp.owner}/${rp.name}`;
  $('#spec-link').href = `https://github.com/${rp.owner}/${rp.name}/blob/${branch()}/docs/SPEC.md`;
  $('#supplies-link').href = `https://github.com/${rp.owner}/${rp.name}/blob/${branch()}/docs/supplies.md`;
  await run(async () => { await logs; state.loaded = true; });
}
$('#btn-reload').addEventListener('click', reload);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !state.busy && state.routines.length) reload(); });
init();
