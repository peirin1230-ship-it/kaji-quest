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

const state = { routines: [], config: {}, token: '', months: new Map(), streak: 0, busy: false, showMenu: false, tips: [], tipOffset: 0, showTips: false, viewDate: '', q: '', basics: [], openChapter: '', badges: [], earned: {}, showTrophy: false, openSteps: new Map(), showRefill: false, prefsFile: { sha: null, data: { hidden: [] } }, shopFile: { sha: null, data: { items: [], recent: [] } }, shopDraft: '', shopFocus: false };

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');   // 太字と改行だけの最小 Markdown
const norm = s => String(s || '').normalize('NFKC').toLowerCase();

// ---- 日付（すべて JST の暦日で扱う。端末のタイムゾーンに依存しない） ----
function nowParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, hour: +p.hour, iso: `${date}T${p.hour}:${p.minute}:${p.second}+09:00` };
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
      list.forEach(t => { const dup = d.items.find(i => i.text === t); if (dup) dup.done = false; else d.items.push({ id: uid(), text: t, added: nowParts().date }); });
      d.recent = [...list, ...d.recent.filter(t => !list.includes(t))].slice(0, 40);
      return d;
    }, `shop: add ${list.join('、')} [skip ci]`);
  });
}
async function shopToggle(id) {
  if (!requireToken()) return;
  await run(async () => { await saveJsonFile('shopFile', d => { const it = d.items.find(i => i.id === id); if (it) it.done = !it.done; return d; }, `shop: toggle ${id} [skip ci]`); });
}
async function shopRemove(id) {
  if (!requireToken()) return;
  await run(async () => { await saveJsonFile('shopFile', d => { d.items = d.items.filter(i => i.id !== id); return d; }, `shop: remove ${id} [skip ci]`); });
}
async function shopClearDone() {
  if (!requireToken()) return;
  await run(async () => { await saveJsonFile('shopFile', d => { d.items = d.items.filter(i => !i.done); return d; }, 'shop: clear bought [skip ci]'); }, '買った分を消した');
}
async function shopShare() {
  const open = shopItems().filter(i => !i.done); if (!open.length) { toast('メモは空', true); return; }
  const text = `買い物メモ ${jaDate(nowParts().date)}\n${open.map(i => '・' + i.text).join('\n')}`;
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('コピーした'); } catch { window.prompt('コピーして使う', text); }
}
function shoppingHTML() {
  const items = shopItems(); const open = items.filter(i => !i.done), done = items.filter(i => i.done);
  const inList = new Set(items.map(i => i.text));
  const chips = shopRecent().filter(t => !inList.has(t)).slice(0, 12).map(t => `<button class="chip" data-act="shop-add" data-text="${esc(t)}">${esc(t)}</button>`).join('');
  const row = i => `<li class="shop-item${i.done ? ' is-done' : ''}" data-sid="${esc(i.id)}"><button class="tick" data-act="shop-toggle" aria-label="${i.done ? '戻す' : '買った'}">${i.done ? '✓' : ''}</button><button class="shop-name" data-act="shop-toggle">${esc(i.text)}</button><button class="ghost tiny" data-act="shop-remove" aria-label="消す">×</button></li>`;
  return `<h2>買い物メモ <span class="sub">${open.length ? `${open.length} 件` : '空'} ・ タップで買った</span></h2>
    <div class="shop-add"><input type="text" id="shop-input" placeholder="牛乳、卵（「、」で区切ると複数）" value="${esc(state.shopDraft)}" maxlength="120" autocomplete="off" enterkeyhint="done"><button class="primary" data-act="shop-add-input">追加</button></div>
    ${chips ? `<div class="chips shop-chips">${chips}</div>` : ''}
    ${open.length ? `<ul class="shop">${open.map(row).join('')}</ul>` : '<p class="empty">まだ何もない。補充の 🛒 からも足せる</p>'}
    ${done.length ? `<h3 class="group">買った <span class="sub">${done.length}</span></h3><ul class="shop">${done.map(row).join('')}</ul>` : ''}
    <div class="actions left"><button class="ghost small" data-act="shop-share">共有・コピー</button>${done.length ? '<button class="ghost small" data-act="shop-clear">買った分を消す</button>' : ''}</div>`;
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
  renderHeader(today, date);
  $('#progress').innerHTML = progressHTML(today, date, entries);
  $('#tasks').innerHTML = tasksHTML(date, todays, entries);
  $('#menu').innerHTML = menuHTML(date, entries);
  $('#tip').innerHTML = tipHTML(date, entries);
  $('#basics').innerHTML = basicsHTML();
  $('#quick').innerHTML = quickHTML(todays);
  $('#refill').innerHTML = refillHTML(date, entries);
  $('#shopping').innerHTML = shoppingHTML();
  $('#week').innerHTML = weekHTML(today, date, entries);
  $('#achievements').innerHTML = achievementsHTML(today, date, entries, all);
  $('#today-log').innerHTML = logHTML(date, todays);
  renderSearch(date, todays, entries);
  document.body.classList.toggle('busy', state.busy);
  decorateCards(); updateNav();
  if (state.shopFocus && !state.busy) { state.shopFocus = false; const inp = $('#shop-input'); if (inp) inp.focus({ preventScroll: true }); }
}
function renderHeader(today, date) {
  $('#date-input').value = date; $('#date-input').max = today;
  $('#date-dow').textContent = `（${DOW_JA[dowOf(date)]}）`;
  $('#btn-today').hidden = date === today;
  $('#btn-date-next').disabled = date >= today;
  $('#streak').textContent = `🔥 ${state.streak}日`;
  const nd = $('#nav-date'); nd.textContent = jaDate(date); nd.classList.toggle('is-past', date !== today);
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
  const b = sec.querySelector(':scope > h2 > .collapse'); if (b) { b.textContent = on ? '▸' : '▾'; b.setAttribute('aria-expanded', on ? 'false' : 'true'); b.setAttribute('aria-label', on ? '開く' : 'たたむ'); }
  updateNav();
}
// 各カードの見出しに折りたたみボタンを付け、記憶した状態を当てる（描画のたびに呼ぶ）
function decorateCards() {
  document.querySelectorAll('#app > .card').forEach(sec => {
    const h = sec.querySelector(':scope > h2'); if (!h) return;
    const on = collapsed.has(sec.id);
    if (!h.querySelector('.collapse')) h.insertAdjacentHTML('beforeend', `<button class="collapse" data-act="collapse-toggle" data-card="${esc(sec.id)}"></button>`);
    const b = h.querySelector('.collapse'); b.textContent = on ? '▸' : '▾'; b.setAttribute('aria-expanded', on ? 'false' : 'true'); b.setAttribute('aria-label', on ? '開く' : 'たたむ');
    sec.classList.toggle('is-collapsed', on);
  });
}
// 見出しへ飛ぶ。飛び先が無い（その日にその欄が無い）ときは fallback のカードへ。たたんであれば開く
function goTo(id, fallback) {
  if (id === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  let el = document.getElementById(id); if (!visible(el)) el = fallback ? document.getElementById(fallback) : null; if (!visible(el)) return;
  const card = el.closest('.card') || el; if (card.classList.contains('is-collapsed')) setCollapsed(card.id, false);
  navHold = Date.now() + 900;   // スクロール中は押したチップを保つ（途中の見出しでチラつかない）
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  markNav(id);
}
let navHold = 0;
function markNav(id) {
  document.querySelectorAll('#nav .nav-chip').forEach(c => c.classList.toggle('is-active', c.dataset.go === id));
  const c = document.querySelector('#nav .nav-chip.is-active'); if (c) c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
// 今どの見出しを見ているかをナビに映す（見出しがナビの下端より上にある最後のもの）
function updateNav() {
  const nav = $('#nav'); if (!nav || Date.now() < navHold) return; const limit = nav.getBoundingClientRect().bottom + 20; let active = '';   // scroll-margin-top（60px）で止まった見出しが「見ている」に入るよう少し余裕を取る
  const shown = NAV_IDS.filter(id => visible(document.getElementById(id)));
  shown.forEach(id => { if (document.getElementById(id).getBoundingClientRect().top <= limit) active = id; });
  if (shown.length && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) active = shown[shown.length - 1];   // 一番下まで来たら最後の見出し
  document.querySelectorAll('#nav .nav-chip').forEach(c => c.classList.toggle('is-active', c.dataset.go === active));
}
let navTick = false;
window.addEventListener('scroll', () => { if (navTick) return; navTick = true; requestAnimationFrame(() => { navTick = false; updateNav(); }); }, { passive: true });
$('#nav').addEventListener('click', ev => { const b = ev.target.closest('[data-go]'); if (b) goTo(b.dataset.go, b.dataset.fallback); });
function progressHTML(today, date, entries) {
  const t = targetInfo(date, entries); const ws = mondayOf(date), we = addDays(ws, 6);
  const got = Math.round(sumWeighted(entries, ws, we)); const last = Math.round(sumWeighted(entries, addDays(ws, -7), addDays(ws, -1)));
  const pct = t.target ? Math.round(got / t.target * 100) : 0; const left = daysBetween(date, we) + 1;
  const label = ws === mondayOf(today) ? '今週' : `${jaDate(ws)} の週`;
  return `<div class="row"><span class="label">${label}</span><strong class="big">${got}<span class="unit"> / ${t.target} 分</span></strong><span class="pct${pct >= 100 ? ' ok' : ''}">${pct}%</span></div>
    <div class="bar"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div>
    <div class="sub">Week ${t.weekNo} ・ 目標比率 ${Math.round(t.ratio * 100)}%${t.penalty ? `（未達が続いたので ${t.penalty} 段階下げ）` : ''} ・ この日を入れて残り ${left} 日 ・ 前の週 ${last} 分</div>`;
}
// 手順ブロック（今日のタスク・掃除メニュー共通）。doneMap: 手順 id → その手順の記録（配列）
function stepsBlockHTML(r, key, sid, doneMap, open, showDate) {
  const steps = stepsOf(r); if (!steps.length) return { toggle: '', list: '' };
  const n = steps.filter(st => (doneMap[st.id] || []).length).length;
  const toggle = ` ・ <button class="steps-toggle" data-act="steps-toggle" data-key="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}">手順 ${n}/${steps.length} ${open ? '▴' : '▾'}</button>`;
  const slotAttr = sid ? ` data-slot="${sid}"` : '';
  const rows = steps.map(st => {
    const done = doneMap[st.id] || []; const est = +st.est_minutes || 1;
    if (done.length) {
      const act = done.reduce((a, e) => a + (+e.actual_minutes || 0), 0), wm = done.reduce((a, e) => a + (+e.weighted_minutes || 0), 0); const last = done[done.length - 1];
      const when = showDate && last.date && last.date !== viewDate() ? `${esc(last.date.slice(5).replace('-', '/'))} ` : '';
      return `<li class="step is-done" data-id="${esc(st.id)}"><span class="ck">✓</span><span class="nm">${esc(st.title)}</span><span class="mt">${when}${act}分 → ${Math.round(wm)}</span>${last.id ? `<button class="ghost tiny" data-act="undo" data-entry="${esc(last.id)}" aria-label="取り消し">×</button>` : ''}</li>`;
    }
    return `<li class="step" data-id="${esc(st.id)}"><span class="ck"></span><span class="nm">${esc(st.title)}</span><span class="mt">${est}分</span><button class="ghost tiny" data-act="detail"${slotAttr} data-min="${est}" aria-label="詳細">…</button><button class="primary tiny" data-act="done"${slotAttr} data-min="${est}">完了</button></li>`;
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
  let meta, btns;
  if (p.complete) {
    const done = p.entries;
    const act = done.reduce((a, e) => a + (+e.actual_minutes || 0), 0), wm = done.reduce((a, e) => a + (+e.weighted_minutes || 0), 0);
    const moods = done.filter(e => e.mood).map(e => MOODS[e.mood - 1]).join('');
    meta = `✓ ${act}分 → 換算 ${Math.round(wm)}分${done.length > 1 ? `（${done.length} 回）` : ''}${done.some(e => e.status === 'partial') ? '（70点）' : ''}${moods ? ' ' + moods : ''}`;
    btns = `<button class="ghost small" data-act="detail" data-slot="${sid}">追加</button><button class="ghost small" data-act="undo" data-entry="${esc(done[done.length - 1].id || '')}">取り消し</button>`;
  } else {
    const est = partial ? p.rest : estOf(r);
    meta = `${partial ? '残り ' : ''}${est}分 → 換算 ${Math.round(weighted(r, est))}分${tl ? ' ・ ' + tl : ''}`;
    btns = `<button class="ghost small" data-act="detail" data-slot="${sid}" data-min="${est}">詳細</button><button class="primary" data-act="done" data-slot="${sid}" data-min="${est}">${partial ? '残り完了' : '完了'}</button>`;
  }
  return `<li class="task${p.complete ? ' is-done' : ''}" data-id="${esc(r.id)}" data-slot="${sid}"><div class="main"><div class="title">${esc(r.title)}${r.core ? ' <span class="badge core">core</span>' : ''}</div><div class="meta">${meta}${sb.toggle}</div></div><div class="btns">${btns}</div>${sb.list}</li>`;
}
function tasksHTML(date, todays, entries) {
  const due = activeRoutines().filter(r => dueToday(r, date));
  const pairs = []; due.forEach(r => slotsOf(r).filter(sid => !isHidden(`${r.id}@${sid}`)).forEach(sid => pairs.push({ r, sid, p: doneParts(r, sid, todays) })));
  const remaining = pairs.filter(x => !x.p.complete);
  const est = remaining.reduce((sum, x) => sum + Math.round(weighted(x.r, x.p.doneIds.size ? x.p.rest : estOf(x.r))), 0);
  const perWeek = +(state.config.pass && state.config.pass.per_week) || 0;
  const ws = mondayOf(date); const passUsed = entries.filter(e => e.status === 'passed' && e.date >= ws && e.date <= addDays(ws, 6)).length;
  const passedToday = todays.some(e => e.status === 'passed');
  const sections = SLOTS.map(sl => {
    const items = pairs.filter(x => x.sid === sl.id); if (!items.length) return '';
    const left = items.filter(x => !x.p.complete).length;
    return `<h3 class="group slot" id="slot-${sl.id}">${sl.ja} <span class="sub">${left ? `残り ${left} 件` : '全部完了'}</span></h3><ul class="tasks">${items.map(x => taskRowHTML(x.r, x.sid, x.p)).join('')}</ul>`;
  }).join('');
  const head = remaining.length ? `残り ${remaining.length} 件 ・ 見込み ${est} 換算分` : (pairs.length ? '全部完了 🎉' : '');
  const pass = passedToday
    ? '<span class="sub">この日はパス済み。ストリークは続く</span>'
    : `<button class="ghost small" data-act="pass"${perWeek && passUsed >= perWeek ? ' disabled' : ''}>この日はパス${perWeek ? `（その週 残り ${Math.max(0, perWeek - passUsed)}）` : ''}</button>`;
  return `<h2>${isToday() ? '今日' : jaDate(date)}のタスク <span class="sub">${head}</span></h2>${sections || '<p class="empty">この日の定期タスクはない</p>'}<div class="pass-row">${pass}</div>`;
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
  const meta = `${partial ? '残り ' : ''}${est}分 → 換算 ${Math.round(weighted(r, est))}分 ・ 目安 ${days}日ごと ・ ${when}${later}${sb.toggle}`;
  const btns = done ? '<button class="ghost small" data-act="detail">追加</button><span class="check">✓</span>' : `<button class="ghost small" data-act="detail" data-min="${est}">詳細</button><button class="primary" data-act="done" data-min="${est}">${partial ? '残り完了' : '完了'}</button>`;
  return `<li class="task${done ? ' is-done' : ''}${!done && score < 1 ? ' is-later' : ''}" data-id="${esc(r.id)}"><div class="main"><div class="title">${esc(r.title)} ${badge}</div><div class="meta">${meta}</div></div><div class="btns">${btns}</div>${sb.list}</li>`;
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
  return `<h2>掃除メニュー <span class="sub">${doneToday ? `この日 ${doneToday} 件 ・ ` : ''}悩んだら上から。過ぎても責めない</span></h2>
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
  const done = practicedToday ? '<span class="sub">✓ 実践した</span>' : `<button class="primary" data-act="tip-practiced" data-tip="${esc(tip.id)}">実践した</button>`;
  return `<h2>💡 今日のコツ <span class="sub">${esc(tip.topic || '')}${LEVEL_JA[tip.level] ? ` ・ ${LEVEL_JA[tip.level]}` : ''}${s && s.practiced ? ` ・ これまで ${s.practiced}回` : ''}</span></h2>
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
      <button class="chapter-head" data-act="chapter" data-ch="${esc(c.id)}" aria-expanded="${open}"><span class="num">${i}</span><span class="ttl">${esc(c.title)}</span><span class="sum">${esc(c.summary || '')}</span><span class="arrow">${open ? '▾' : '▸'}</span></button>
      ${open ? `<div class="chapter-body">${c.html}${chapterSrcUrl(c) ? `<p class="src"><a href="${esc(chapterSrcUrl(c))}" target="_blank" rel="noopener">くわしい元の資料（原文）を開く</a></p>` : ''}<button class="ghost small wide" data-act="chapter" data-ch="${esc(c.id)}">閉じる</button></div>` : ''}
    </div>`;
  }).join('');
  return `<h2>📘 掃除の教科書 <span class="sub">やさしい版。数字や決まりは元の資料で確かめる</span></h2>${rows}`;
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
    return `<div class="quick-row"><div class="title">${esc(r.title)}${done.length ? ` <span class="badge">${done.length}回 ・ 換算 ${sum}分</span>` : ''}</div><div class="chips">${chips}<button class="chip ghost" data-act="detail" data-id="${esc(r.id)}">詳細</button></div></div>`;
  }).join('');
  return `<h2>後から記録 <span class="sub">終わってから 1 タップ。時間帯は今の時刻で自動</span></h2>${rows}`;
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
  const cart = `<button class="ghost tiny" data-act="shop-add" data-text="${esc(shopNameOf(r))}" aria-label="買い物メモへ" title="買い物メモへ">🛒</button>`;
  const btns = today ? `${cart}<button class="ghost small" data-act="detail">追加</button><span class="check">✓</span>` : `${cart}<button class="ghost small" data-act="detail">詳細</button><button class="primary" data-act="done" data-min="${+r.est_minutes || 3}">補充した</button>`;
  return `<li class="task${today ? ' is-done' : ''}" data-id="${esc(r.id)}"><div class="main"><div class="title">${esc(r.title)} ${badge}</div><div class="meta">${meta}</div></div><div class="btns">${btns}</div></li>`;
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
  return `<h2>補充 <span class="sub">洗剤・消耗品ごとに 1 タップ。2 回目から次の目安が出る</span></h2>
    ${picks.length ? `<ul class="tasks">${picks.map(refillRowHTML).join('')}</ul>` : '<p class="empty">そろそろの物はない。詰め替えたら「全部見る」から 1 タップ</p>'}
    <button class="ghost small wide" data-act="refill-toggle">${state.showRefill ? '閉じる' : `全部見る（${items.length} 種）`}</button>${full}`;
}
function weekHTML(today, date, entries) {
  const ws = mondayOf(date); const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const totals = days.map(d => Math.round(sumWeighted(entries, d, d))); const max = Math.max(60, ...totals);
  const cols = days.map((d, i) => `<div class="day${d === date ? ' is-today' : ''}${d > today ? ' is-future' : ''}" data-date="${d}"><div class="v">${totals[i] || ''}</div><div class="bar-v"><div style="height:${Math.round(totals[i] / max * 100)}%"></div></div><div class="l">${DOW_JA[dowOf(d)]}</div></div>`).join('');
  const byArea = {};
  entries.forEach(e => { if (e.date >= ws && e.date <= addDays(ws, 6) && EARNED.has(e.status)) byArea[e.area] = (byArea[e.area] || 0) + (+e.weighted_minutes || 0); });
  const areas = Object.entries(byArea).sort((a, b) => b[1] - a[1]).map(([a, v]) => `${AREA_JA[a] || a} ${Math.round(v)}`).join(' ・ ');
  return `<h2>${ws === mondayOf(today) ? '今週' : 'その週'} <span class="sub">換算分／日。日をタップで移動</span></h2><div class="days">${cols}</div>${areas ? `<div class="sub" style="margin-top:8px">${esc(areas)}</div>` : ''}`;
}
function logRowHTML(e, showDate) {
  const time = e.ts ? String(e.ts).slice(11, 16) : ''; const st = e.status === 'partial' ? '70点' : e.status === 'tip' ? 'コツ' : '';
  const slot = SLOT_JA[entrySlot(e, taskById(e.task_id))] || '';
  const when = showDate ? esc(e.date.slice(5).replace('-', '/')) : esc(time);
  return `<li><span class="t">${when}</span><span class="n">${esc(e.title || e.task_id)} <span class="badge">${slot}</span>${st ? ` <span class="badge">${st}</span>` : ''}${e.mood ? ' ' + MOODS[e.mood - 1] : ''}${e.learned ? `<div class="note">💡 ${esc(e.learned)}</div>` : ''}</span><span class="m">${EARNED.has(e.status) ? `${e.actual_minutes}分 → ${Math.round(e.weighted_minutes)}` : ''}</span>${e.id ? `<button class="ghost tiny" data-act="undo" data-entry="${esc(e.id)}" aria-label="取り消し">×</button>` : ''}</li>`;
}
function logHTML(date, todays) {
  const title = isToday() ? '今日の記録' : `${jaDate(date)} の記録`;
  if (!todays.length) return `<h2>${title}</h2><p class="empty">まだ何もない。最初の 1 件が一番えらい</p>`;
  return `<h2>${title} <span class="sub">${todays.length} 件</span></h2><ul class="log">${[...todays].reverse().map(e => logRowHTML(e, false)).join('')}</ul>`;
}
// 検索: タスク（定期・メニュー・後から記録）、コツ、過去の記録
function renderSearch(date, todays, entries) {
  const q = norm(state.q).trim(); const box = $('#search-results');
  if (!q) { box.innerHTML = ''; return; }
  const terms = q.split(/\s+/).filter(Boolean); const hit = s => { const n = norm(s); return terms.every(t => n.includes(t)); };
  const routines = activeRoutines().filter(r => hit([r.title, r.id, r.place, r.group, AREA_JA[r.area], ...(r.checklist || []), ...stepsOf(r).map(st => st.title)].join(' '))).slice(0, 12);
  const tips = state.tips.filter(t => hit([t.title, t.body, t.action, t.topic, ...(t.tags || [])].join(' '))).slice(0, 10);
  const logs = entries.filter(e => hit([e.title, e.learned, e.task_id].join(' '))).slice(-8).reverse();
  const chapters = state.basics.filter(c => hit([c.title, c.summary, c.text].join(' ')));
  const stats = tipStats(entries);
  const rHtml = routines.map(r => {
    const done = todays.filter(e => e.task_id === r.id && EARNED.has(e.status)); const s = r.schedule || {};
    const kind = s.type === 'interval' ? `目安 ${s.days}日ごと` : s.type === 'manual' ? (isRefill(r) ? '補充' : '後から記録') : s.type === 'weekly' ? `毎週 ${s.day}` : '毎日';
    return `<li class="task" data-id="${esc(r.id)}"><div class="main"><div class="title">${esc(r.title)}</div><div class="meta">${r.est_minutes}分 → 換算 ${Math.round(weighted(r, r.est_minutes))}分 ・ ${kind}${done.length ? ` ・ この日 ${done.length} 回` : ''}</div></div><div class="btns"><button class="ghost small" data-act="detail">詳細</button><button class="primary" data-act="done">完了</button></div></li>`;
  }).join('');
  const html = (routines.length ? `<h3 class="group">タスク（${routines.length}）</h3><ul class="tasks">${rHtml}</ul>` : '')
    + (tips.length ? `<h3 class="group">コツ（${tips.length}）</h3>${tips.map(t => tipItemHTML(t, stats, true)).join('')}` : '')
    + (chapters.length ? `<h3 class="group">教科書（${chapters.length}）</h3><ul class="tasks">${chapters.map(c => `<li class="task"><div class="main"><div class="title">${esc(c.title)}</div><div class="meta">${esc(c.summary || '')}</div></div><div class="btns"><button class="ghost small" data-act="chapter-open" data-ch="${esc(c.id)}">開く</button></div></li>`).join('')}</ul>` : '')
    + (logs.length ? `<h3 class="group">記録（新しい順 ${logs.length} 件）</h3><ul class="log">${logs.map(e => logRowHTML(e, true)).join('')}</ul>` : '');
  box.innerHTML = html || '<p class="empty">見つからない</p>';
}

// ---- バッジ・レベル・称号（docs/badges.md → data/badges.json）。記録から毎回計算する。取ったものは記録が残るかぎり残る ----
const AREAS = ['dishes', 'cooking', 'cleaning', 'laundry', 'nameless'];
const TIER_XP = { bronze: 10, silver: 30, gold: 100, platinum: 300, secret: 50 };
const levelOf = xp => Math.floor(Math.sqrt(Math.max(0, xp) / 100));         // §7: Lv = floor(sqrt(累計XP / 100))
const nextLevelXp = lv => (lv + 1) * (lv + 1) * 100;
function newStats() {
  return { n: 0, byTask: {}, byArea: {}, weighted: 0, weightedByArea: {}, xpByArea: {}, days: new Set(), passDays: new Set(), coreDays: new Set(),
    streakCur: 0, streakBest: 0, coreStreakCur: 0, coreStreakBest: 0, passes: 0, partials: 0, learned: 0, practiced: 0, tipStage: {},
    fast: {}, long: {}, slotDays: {}, dayCount: {}, morningCount: {}, early: 0, resume: 0, placeLast: {}, weekTotal: {}, areaDays: {}, lastDay: '',
    byKind: {}, stepEntries: 0, stepSets: {}, stepsComplete: 0 };
}
function statAdd(st, e) {
  if (e.tip_id) { const t = st.tipStage[e.tip_id] || (st.tipStage[e.tip_id] = { stage: 0 }); if (e.tip_practiced) { t.stage = Math.min(t.stage + 1, TIP_INTERVALS.length - 1); st.practiced++; } else t.stage = Math.max(0, t.stage - 1); }
  if (e.status === 'passed') { st.passes++; st.passDays.add(e.date); return; }
  if (!EARNED.has(e.status)) return;
  const sx = stepById(e.task_id); const r = sx ? sx.parent : routineById(e.task_id); const pid = r ? r.id : e.task_id;   // 手順の記録は親のタスクに数える
  const area = e.area || (r && r.area) || 'nameless'; const day = e.date;
  st.n++; st.byArea[area] = (st.byArea[area] || 0) + 1;
  if (!sx) st.byTask[pid] = (st.byTask[pid] || 0) + 1;   // 手順だけの記録は、その日に手順が全部そろった時点で親 1 回と数える（statEndDay）
  if (r && r.kind) st.byKind[r.kind] = (st.byKind[r.kind] || 0) + 1;
  if (sx) { st.stepEntries++; st.byTask[e.task_id] = (st.byTask[e.task_id] || 0) + 1; const k = `${day}|${pid}|${entrySlot(e, r)}`; (st.stepSets[k] || (st.stepSets[k] = new Set())).add(e.task_id); }   // 手順 id 自体の回数は手順ごとのバッジ用
  const wm = +e.weighted_minutes || 0; st.weighted += wm; st.weightedByArea[area] = (st.weightedByArea[area] || 0) + wm;
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
  if (sl === 'morning') st.morningCount[day] = (st.morningCount[day] || 0) + 1;
  const m = /T(\d\d):(\d\d)/.exec(String(e.ts || '')); if (m) { const hm = +m[1] * 60 + +m[2]; if (hm >= 180 && hm < 330) st.early++; }
  if (r && isMenu(r) && !sx) st.placeLast[r.place || 'その他'] = day;
  (st.areaDays[day] || (st.areaDays[day] = new Set())).add(area);
  if (r && r.core) st.coreDays.add(day);
}
function statEndDay(st, day) {
  Object.keys(st.stepSets).forEach(k => {   // その日、手順を全部たどって終えたタスクを数える（親 1 回の完了としても数える）
    if (!k.startsWith(day + '|')) return;
    const pid = k.split('|')[1]; const r = routineById(pid);
    if (r && stepsOf(r).length && stepsOf(r).every(x => st.stepSets[k].has(x.id))) { st.stepsComplete++; st.byTask[pid] = (st.byTask[pid] || 0) + 1; }
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
    case 'tip_stage': return { v: Object.values(st.tipStage).filter(t => t.stage >= TIP_INTERVALS.length - 1).length, t: gte };
    case 'best_week': { const wr = weekResults(st, day).list; let best = -1, v = 0; wr.forEach((x, i) => { if (i > 0 && x.total > best) v++; best = Math.max(best, x.total); }); return { v, t: gte }; }
    case 'ramp_top': return { v: ratioFor(weekNoOf(day), weekResults(st, day).penalty) >= 1 ? 1 : 0, t: 1 };
    case 'step_entries': return { v: st.stepEntries, t: gte };
    case 'steps_complete': return { v: st.stepsComplete, t: gte };
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
function titleFor(n) {
  const ts = (state.config.titles || []).slice().sort((a, b) => a.badges - b.badges);
  let name = '駆け出し'; ts.forEach(t => { if (n >= +t.badges) name = t.name; });
  return { name, next: ts.find(t => n < +t.badges) };
}
function badgeTileHTML(b, when, m) {
  if (!when && b.secret) return '<div class="badge-tile locked secret"><div class="ic">❔</div><div class="nm">???</div><div class="ds">シークレット</div></div>';
  const pct = m.t ? Math.min(100, Math.round(m.v / m.t * 100)) : 0;
  return `<div class="badge-tile ${when ? 'earned' : 'locked'} ${esc(b.tier || '')}"><div class="ic">${b.icon}</div><div class="nm">${esc(b.name)}</div><div class="ds">${esc(b.desc || '')}</div>${when ? `<div class="when">${esc(when.slice(0, 10).replace(/-/g, '/'))} 獲得</div>` : `<div class="bar mini"><div class="fill" style="width:${pct}%"></div></div><div class="when">${m.v}/${m.t}</div>`}</div>`;
}
function achievementsHTML(today, date, entries, all) {
  if (!state.badges.length) return '';
  const { earned, st } = evaluateBadges(entries); state.earned = earned;
  // 獲得トーストの比較用は表示日に関係なく全記録で見る（過去日から今日へ戻っただけで「獲得」と出さない）
  state.earnedAll = date === today ? earned : evaluateBadges(all).earned;
  const n = Object.keys(earned).length; const total = state.badges.length;
  const bonus = state.badges.filter(b => earned[b.id]).reduce((s, b) => s + (+b.xp_bonus || TIER_XP[b.tier] || 10), 0);
  const xp = Object.values(st.xpByArea).reduce((s, v) => s + v, 0) + bonus;
  const ttl = titleFor(n);
  const levels = AREAS.map(a => { const x = st.xpByArea[a] || 0; const lv = levelOf(x); const lo = lv * lv * 100, hi = nextLevelXp(lv); const pct = Math.round((x - lo) / (hi - lo) * 100);
    return `<div class="lvl"><span class="a">${AREA_JA[a]}</span><span class="l">Lv${lv}</span><div class="bar"><div class="fill" style="width:${pct}%"></div></div><span class="sub">${x}/${hi}</span></div>`; }).join('');
  const measured = state.badges.map(b => ({ b, m: measure(b, st, earned, date) }));
  const near = measured.filter(x => !earned[x.b.id] && !x.b.secret && x.m.t > 0).map(x => ({ ...x, r: Math.min(1, x.m.v / x.m.t) })).sort((a, b) => b.r - a.r || a.m.t - b.m.t).slice(0, 3);
  const recent = state.badges.filter(b => earned[b.id]).sort((a, b) => earned[b.id].localeCompare(earned[a.id])).slice(0, 3);
  const nearHtml = near.map(x => `<div class="near"><span class="ic">${x.b.icon}</span><span class="nm">${esc(x.b.name)}</span><div class="bar"><div class="fill" style="width:${Math.round(x.r * 100)}%"></div></div><span class="sub">${x.m.v}/${x.m.t}</span></div>`).join('');
  const recentHtml = recent.map(b => `<div class="near recent"><span class="ic">${b.icon}</span><span class="nm">${esc(b.name)} <span class="sub">${esc(b.desc || '')}</span></span><span class="sub when">${esc(earned[b.id].slice(5).replace('-', '/'))}</span></div>`).join('');
  let room = '';
  if (state.showTrophy) {
    const cats = [...new Set(state.badges.map(b => b.cat || 'その他'))];
    room = cats.map(cat => { const list = state.badges.filter(b => (b.cat || 'その他') === cat); const got = list.filter(b => earned[b.id]).length;
      return `<h3 class="group">${esc(cat)} <span class="sub">${got}/${list.length}</span></h3><div class="badge-grid">${list.map(b => badgeTileHTML(b, earned[b.id], measured.find(x => x.b === b).m)).join('')}</div>`; }).join('');
  }
  return `<h2>🏆 実績${date !== today ? ` <span class="sub">${esc(date.slice(5).replace('-', '/'))} 時点</span>` : ''} <span class="sub">称号 <b>${esc(ttl.name)}</b>${ttl.next ? `（${esc(ttl.next.name)} まであと ${ttl.next.badges - n}）` : ''}</span></h2>
    <div class="stats"><div><b>${n}</b><span>/${total} バッジ</span></div><div><b>${xp.toLocaleString()}</b><span>XP</span></div><div><b>${st.streakBest}</b><span>最長連続日</span></div><div><b>${Math.round(st.weighted / 60)}</b><span>時間（換算）</span></div></div>
    <div class="levels">${levels}</div>
    ${near.length ? `<h3 class="group">あと少し</h3>${nearHtml}` : ''}
    ${recent.length ? `<h3 class="group">最近の獲得</h3>${recentHtml}` : ''}
    <button class="ghost small wide" data-act="trophy-toggle">${state.showTrophy ? '閉じる' : `トロフィールームを開く（全 ${total} 種）`}</button>${room}`;
}

// ---- 操作 ----
let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2500);
}
async function run(fn, okMsg) {
  if (state.busy) return;
  const before = state.loaded ? new Set(Object.keys(state.earnedAll || {})) : null; let ok = false;   // 初回読み込みでは過去の獲得を通知しない
  state.busy = true; render();
  try { await fn(); ok = true; }
  catch (e) { console.error(e); toast(e.message || String(e), true); }
  finally {
    state.busy = false; render();
    const news = before ? state.badges.filter(b => (state.earnedAll || {})[b.id] && !before.has(b.id)) : [];
    if (news.length) toast(`🏅 バッジ獲得: ${news.map(b => b.icon + ' ' + b.name).join('、')}${okMsg ? ' ・ ' + okMsg : ''}`);
    else if (ok && okMsg) toast(okMsg);
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
async function record(r, { minutes, mood, learned, status = 'done', tip_id, tip_practiced, slot }) {
  if (!requireToken()) return;
  const e = baseEntry();
  Object.assign(e, { task_id: r.id, title: r.title, area: r.area, slot: SLOT_JA[slot] ? slot : currentSlot(), status, mode: 'full', actual_minutes: minutes, weight: weightOf(r), weighted_minutes: weighted(r, minutes), xp: Math.round(weighted(r, minutes)) });
  if (r.parent) e.parent = r.parent;   // 手順の記録。親タスクの id
  if (tip_id) { e.tip_id = tip_id; e.tip_practiced = !!tip_practiced; }
  if (mood) e.mood = mood;
  if (learned) e.learned = learned;
  e.id = uid();
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

$('#app').addEventListener('click', ev => {
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
    case 'shop-clear': shopClearDone(); break;
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
  $('#detail-title').textContent = r.title; $('#detail-w').textContent = `W=${weightOf(r).toFixed(2)}${isToday() ? '' : ` ・ ${jaDate(viewDate())} に記録`}`;
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
async function reload() {
  await run(async () => {
    state.months.clear();
    const today = nowParts().date; const a = addDays(startMonday(), -7), b = addDays(today, -366);
    const pf = fetchPrefs().catch(() => state.prefsFile || { sha: null, data: { hidden: [] } });   // 読めなくても動く（書くときに読み直す）
    const sf = fetchJsonFile('shopFile').catch(() => state.shopFile);
    await ensureMonths(a > b ? a : b, today);
    state.prefsFile = await pf; state.shopFile = await sf;
    if (state.viewDate) await ensureMonths(addDays(mondayOf(state.viewDate), -7), state.viewDate);
    state.streak = await computeStreak(today); state.loaded = true;
  });
}
async function init() {
  try { state.token = localStorage.getItem(TOKEN_KEY) || ''; } catch { state.token = ''; }
  try {
    const get = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); });
    const [routines, config, tips, basics, badges] = await Promise.all([get('data/routines.json'), get('data/config.json'), get('data/knowledge.json').catch(() => []), get('data/basics.json').catch(() => []), get('data/badges.json').catch(() => [])]);
    state.routines = Array.isArray(routines) ? routines : []; stepIndexCache = null; state.config = config || {}; state.tips = Array.isArray(tips) ? tips : []; state.basics = Array.isArray(basics) ? basics : []; state.badges = Array.isArray(badges) ? badges : [];
  } catch (e) { $('#tasks').innerHTML = `<p class="empty">設定の読み込みに失敗: ${esc(e.message)}</p>`; return; }
  const rp = repo();
  $('#repo-link').href = `https://github.com/${rp.owner}/${rp.name}`;
  $('#spec-link').href = `https://github.com/${rp.owner}/${rp.name}/blob/${branch()}/docs/SPEC.md`;
  $('#supplies-link').href = `https://github.com/${rp.owner}/${rp.name}/blob/${branch()}/docs/supplies.md`;
  await reload();
}
$('#btn-reload').addEventListener('click', reload);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !state.busy && state.routines.length) reload(); });
init();
