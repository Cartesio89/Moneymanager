'use strict';
/* MoneyManager v6 — offline-first (IndexedDB) + sync Supabase con login */

const APP_VERSION = '6.3.0';
const SUPABASE_URL = 'https://ymvuotafffjbdvhtqkjn.supabase.co';
// Chiave "anon": pubblica per progetto; la sicurezza dei dati è garantita da login + RLS sul DB.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltdnVvdGFmZmZqYmR2aHRxa2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE0OTE3NjQsImV4cCI6MjA3NzA2Nzc2NH0.wtbDlmmAXbdU58SOIuYsrapYpLXUhgs56m7OYH1ajHs';
const DB_NAME = 'MoneyManagerDB';
const DB_VERSION = 3;

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTHS_LONG = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MACROS = ['Spese fisse', 'Spese variabili', 'Entrate'];
const MACRO_COLORS = { 'Spese fisse': '#f59e0b', 'Spese variabili': '#3b82f6', 'Entrate': '#22c55e', 'Senza categoria': '#6b7280' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- utilità ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowISO = () => new Date().toISOString();
const pad2 = (n) => String(n).padStart(2, '0');
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function currentMonthKey() { return todayISO().slice(0, 7); }
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function nextMonthKey(ym) { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return y + '-' + pad2(m); }
function addMonthsKey(ym, n) { let [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + pad2((t % 12) + 1); }

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
// UUID deterministico (stessa stringa => stesso id su ogni dispositivo): evita duplicati dalle ricorrenze
function hash128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
function detUUID(str) {
  const hex = (n) => n.toString(16).padStart(8, '0');
  const s = hash128(str).map(hex).join('');
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-' + '89ab'[parseInt(s[16], 16) & 3] + s.slice(17, 20) + '-' + s.slice(20, 32);
}

const toCents = (v) => Math.round((parseFloat(v) || 0) * 100);
const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const fmt = (cents) => eurFmt.format(cents / 100);
const fmtSigned = (cents) => (cents > 0 ? '+' : '') + fmt(cents);
function fmtCompact(cents) {
  const v = Math.round(cents / 100), a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',') + 'k' : String(a);
  return (v > 0 ? '+' : v < 0 ? '-' : '') + s;
}
function parseAmount(str) {
  const n = parseFloat(String(str ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const amountToInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');
function tms(s) { return s ? (Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1')) || 0) : 0; }
const recTs = (r) => r.updated_at || r.updatedAt || r.createdAt || '1970-01-01T00:00:00Z';

/* ---------- IndexedDB ---------- */
let dbPromise = null;
function initDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      ['accounts', 'categories', 'transactions', 'recurring'].forEach((s) => {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('Aggiornamento DB bloccato: chiudi le altre schede dell\'app');
  });
  return dbPromise;
}
const idbReq = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function dbGetAll(store) { const db = await initDB(); return idbReq(db.transaction(store, 'readonly').objectStore(store).getAll()); }
async function dbGet(store, id) { const db = await initDB(); return idbReq(db.transaction(store, 'readonly').objectStore(store).get(id)); }
async function dbPutMany(store, recs) {
  if (!recs.length) return;
  const db = await initDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    recs.forEach((r) => os.put(r));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transazione DB annullata'));
  });
}
const dbPut = (store, rec) => dbPutMany(store, [rec]);
async function settingGet(key) { const r = await dbGet('settings', key); return r ? r.value : null; }
const settingSet = (key, value) => dbPut('settings', { key, value });

/* ---------- stato ---------- */
let state = {
  view: 'home',
  accounts: [], categories: [], transactions: [], recurring: [],
  accAll: new Map(), catAll: new Map(), catById: new Map(), accById: new Map(), legs: new Map(),
  filterYear: new Date().getFullYear(), filterMonth: null,
  filterAccount: [], filterMacroCategory: [], filterCategory: [],
  filtersOpen: false, filterDropdownOpen: { account: false, macro: false, category: false },
  breakdownType: 'expense', breakdownBy: 'category',
  modal: null, editing: null, txType: 'expense', dismissible: true,
  prefs: { lastAccount: null, lastCat: { expense: null, income: null } },
  supabaseClient: null, session: null, online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false, syncError: null, lastSync: null, dirty: false, mutationSeq: 0,
  loginPrompted: false, authMsg: '', lastBackup: null, cloudChecked: false, recurringAfterSync: false, colorsChecked: false
};

/* ---------- caricamento dati ---------- */
const byName = (a, b) => String(a.name).trim().localeCompare(String(b.name).trim(), 'it', { sensitivity: 'base' });
async function loadData() {
  const [accs, cats, txs, recs] = await Promise.all(['accounts', 'categories', 'transactions', 'recurring'].map(dbGetAll));
  state.accAll = new Map(accs.map((a) => [a.id, a]));
  state.catAll = new Map(cats.map((c) => [c.id, c]));
  state.accounts = accs.filter((a) => !a.deleted).sort((a, b) => tms(a.createdAt) - tms(b.createdAt) || a.name.localeCompare(b.name, 'it'));
  state.categories = cats.filter((c) => !c.deleted).sort(byName);
  state.transactions = txs.filter((t) => !t.deleted);
  state.recurring = recs.filter((r) => !r.deleted).sort((a, b) => (a.description || '').localeCompare(b.description || '', 'it'));
  state.accById = new Map(state.accounts.map((a) => [a.id, a]));
  state.catById = new Map(state.categories.map((c) => [c.id, c]));
  state.legs = new Map();
  state.transactions.forEach((t) => {
    if (t.transferId) { if (!state.legs.has(t.transferId)) state.legs.set(t.transferId, []); state.legs.get(t.transferId).push(t); }
  });
  render();
}
async function loadPrefs() {
  state.prefs.lastAccount = await settingGet('last_account');
  state.prefs.lastCat.expense = await settingGet('last_cat_expense');
  state.prefs.lastCat.income = await settingGet('last_cat_income');
  const ls = await settingGet('last_sync');
  state.lastSync = ls ? new Date(ls) : null;
  state.lastBackup = await settingGet('last_backup');
}

/* ---------- mutazioni ---------- */
function touch(rec, now = nowISO()) { rec.updated_at = now; if (rec.accountId !== undefined && rec.type) rec.updatedAt = now; return rec; }
function markDirty() { state.mutationSeq++; state.dirty = true; renderHeader(); }
async function afterMutation() { markDirty(); await loadData(); scheduleSync(); }

async function softDelete(store, ids) {
  const prev = [], recs = [], now = nowISO();
  for (const id of ids) {
    const r = await dbGet(store, id);
    if (!r) continue;
    prev.push(r);
    recs.push(touch({ ...r, deleted: true, deleted_at: now }, now));
  }
  await dbPutMany(store, recs);
  return prev;
}
async function restoreRecords(store, prev) {
  const now = nowISO();
  await dbPutMany(store, prev.map((r) => touch({ ...r, deleted: false, deleted_at: null }, now)));
  await afterMutation();
  toast('Ripristinato');
}

/* ---------- filtri e aggregazioni ---------- */
const txYear = (t) => +t.date.slice(0, 4);
const txMonth = (t) => +t.date.slice(5, 7) - 1;
function passFilters(tx) {
  if (state.filterAccount.length && !state.filterAccount.includes(tx.accountId)) return false;
  if (state.filterMacroCategory.length) {
    const c = state.catById.get(tx.categoryId);
    if (!c || !state.filterMacroCategory.includes(c.macroCategory || 'Spese variabili')) return false;
  }
  if (state.filterCategory.length && !state.filterCategory.includes(tx.categoryId)) return false;
  return true;
}
const yearTx = () => state.transactions.filter((t) => txYear(t) === state.filterYear && !t.hidden && passFilters(t));
const scopeTx = () => yearTx().filter((t) => state.filterMonth === null || txMonth(t) === state.filterMonth);
const statsOnly = (list) => list.filter((t) => !t.transferId);
function sums(list) {
  let income = 0, expense = 0;
  list.forEach((t) => { const c = toCents(t.amount); if (t.type === 'income') income += c; else expense += c; });
  return { income, expense, net: income - expense };
}
function monthlyNet() {
  const m = Array(12).fill(0);
  statsOnly(yearTx()).forEach((t) => { m[txMonth(t)] += (t.type === 'income' ? 1 : -1) * toCents(t.amount); });
  return m;
}
function accountBalances() {
  const today = todayISO();
  const bal = new Map(state.accounts.map((a) => [a.id, toCents(a.initialBalance)]));
  state.transactions.forEach((t) => {
    if (t.date > today || !bal.has(t.accountId)) return;
    bal.set(t.accountId, bal.get(t.accountId) + (t.type === 'income' ? 1 : -1) * toCents(t.amount));
  });
  return bal;
}
const activeFilterCount = () => state.filterAccount.length + state.filterMacroCategory.length + state.filterCategory.length;
const accName = (id) => (state.accAll.get(id) ? state.accAll.get(id).name + (state.accAll.get(id).deleted ? ' (eliminato)' : '') : '—');
const catName = (id) => (id ? (state.catAll.get(id) ? state.catAll.get(id).name : '—') : 'Senza categoria');

/* ---------- toast / snackbar ---------- */
let snackTimer = null, snackUndo = null;
function showSnack(message, undoFn) {
  snackUndo = undoFn || null;
  clearTimeout(snackTimer);
  $('snack-root').innerHTML = `<div class="fixed left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none" style="bottom:calc(9rem + env(safe-area-inset-bottom))">
    <div class="pointer-events-auto bg-gray-100 text-gray-900 rounded-lg shadow-xl px-4 py-3 flex items-center gap-4 text-sm max-w-sm w-full justify-between">
      <span>${esc(message)}</span>
      ${undoFn ? `<button onclick="doUndo()" class="font-bold text-blue-700 uppercase text-xs tracking-wide">Annulla</button>` : ''}
    </div></div>`;
  snackTimer = setTimeout(hideSnack, undoFn ? 7000 : 2500);
}
const toast = (m) => showSnack(m, null);
function hideSnack() { clearTimeout(snackTimer); snackUndo = null; $('snack-root').innerHTML = ''; }
async function doUndo() { const f = snackUndo; hideSnack(); if (f) await f(); }

/* ---------- sync ---------- */
const metaToCloud = (r) => ({ created_at: r.createdAt || recTs(r), updated_at: recTs(r), deleted: !!r.deleted, deleted_at: r.deleted_at || null });
const metaFromCloud = (c) => ({ createdAt: c.created_at || c.updated_at, updated_at: c.updated_at || c.created_at, deleted: !!c.deleted, deleted_at: c.deleted_at || null });

const TABLES = [
  {
    table: 'accounts', store: 'accounts',
    toCloud: (r, uid) => ({ id: r.id, user_id: uid, name: r.name, initial_balance: Number(r.initialBalance) || 0, ...metaToCloud(r) }),
    fromCloud: (c) => ({ id: c.id, name: c.name, initialBalance: Number(c.initial_balance) || 0, ...metaFromCloud(c) })
  },
  {
    table: 'categories', store: 'categories',
    toCloud: (r, uid) => ({ id: r.id, user_id: uid, name: r.name, color: r.color || '#3b82f6', macro_category: r.macroCategory || 'Spese variabili', ...metaToCloud(r) }),
    fromCloud: (c) => ({ id: c.id, name: c.name, color: c.color || '#3b82f6', macroCategory: c.macro_category || 'Spese variabili', ...metaFromCloud(c) })
  },
  {
    table: 'transactions', store: 'transactions',
    toCloud: (r, uid) => ({
      id: r.id, user_id: uid, account_id: r.accountId || null, category_id: r.categoryId || null, type: r.type,
      amount: Number(r.amount), description: r.description || '', date: r.date, hidden: !!r.hidden,
      transfer_id: r.transferId || null, recurring_id: r.recurringId || null, ...metaToCloud(r)
    }),
    fromCloud: (c) => {
      const m = metaFromCloud(c);
      const o = {
        id: c.id, accountId: c.account_id, categoryId: c.category_id, type: c.type, amount: Number(c.amount),
        description: c.description || '', date: c.date, hidden: !!c.hidden, ...m, updatedAt: m.updated_at
      };
      if (c.transfer_id) o.transferId = c.transfer_id;
      if (c.recurring_id) o.recurringId = c.recurring_id;
      return o;
    }
  },
  {
    table: 'recurring_rules', store: 'recurring',
    toCloud: (r, uid) => ({
      id: r.id, user_id: uid, description: r.description || '', account_id: r.accountId || null, category_id: r.categoryId || null,
      type: r.type, amount: Number(r.amount), day_of_month: r.dayOfMonth, start_month: r.startMonth, end_month: r.endMonth || null,
      active: r.active !== false, ...metaToCloud(r)
    }),
    fromCloud: (c) => ({
      id: c.id, description: c.description || '', accountId: c.account_id, categoryId: c.category_id, type: c.type, amount: Number(c.amount),
      dayOfMonth: c.day_of_month, startMonth: c.start_month, endMonth: c.end_month || null, active: c.active !== false, ...metaFromCloud(c)
    })
  }
];

async function fetchAllRows(table) {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error, count } = await state.supabaseClient.from(table).select('*', { count: 'exact' }).order('id').range(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length === 0 || out.length >= (count ?? 0)) break;
  }
  return out;
}
async function pushRows(table, rows) {
  let failed = 0, lastMsg = '';
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await state.supabaseClient.from(table).upsert(chunk, { onConflict: 'id' });
    if (!error) continue;
    if (chunk.length === 1) { failed++; lastMsg = error.message; continue; }
    for (const row of chunk) { // isola la riga problematica
      const r = await state.supabaseClient.from(table).upsert(row, { onConflict: 'id' });
      if (r.error) { failed++; lastMsg = r.error.message; if (failed >= 5) throw new Error(lastMsg); }
    }
  }
  return { failed, lastMsg };
}

let syncTimer = null;
function canSync() { return !!(state.supabaseClient && state.session && state.online); }
function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  if (!canSync()) { renderHeader(); return; }
  syncTimer = setTimeout(() => syncNow(false), delay);
}

async function syncNow(manual = false) {
  if (!state.supabaseClient) return;
  if (!state.session) { openLoginModal(); return; }
  if (!state.online) { if (manual) toast('Sei offline: sincronizzo appena torna la rete'); return; }
  if (state.syncing) { state.mutationSeq++; return; }
  state.syncing = true; state.syncError = null; renderHeader();
  const seqAtStart = state.mutationSeq;
  const uid = state.session.user.id;
  let failedTotal = 0, failMsg = '';
  try {
    for (const t of TABLES) {
      const local = await dbGetAll(t.store);
      const cloud = await fetchAllRows(t.table);
      const lMap = new Map(local.map((r) => [r.id, r]));
      const cMap = new Map(cloud.map((c) => [c.id, c]));
      const push = [], pull = [];
      local.forEach((l) => { const c = cMap.get(l.id); if (!c || tms(recTs(l)) > tms(c.updated_at || c.created_at)) push.push(l); });
      cloud.forEach((c) => { const l = lMap.get(c.id); if (!l || tms(c.updated_at || c.created_at) > tms(recTs(l))) pull.push(c); });
      if (push.length) {
        const res = await pushRows(t.table, push.map((r) => t.toCloud(r, uid)));
        failedTotal += res.failed; if (res.failed) failMsg = res.lastMsg;
      }
      if (pull.length) await dbPutMany(t.store, pull.map(t.fromCloud));
    }
    state.lastSync = new Date();
    await settingSet('last_sync', state.lastSync.toISOString());
    if (failedTotal) { state.syncError = failedTotal + ' righe non sincronizzate: ' + failMsg; }
    else if (state.mutationSeq === seqAtStart) state.dirty = false;
  } catch (err) {
    console.error('Sync error', err);
    state.syncError = (err && err.message) ? err.message : 'Errore di rete';
  }
  state.syncing = false;
  await loadData();
  if (!state.syncError && state.mutationSeq !== seqAtStart) scheduleSync(300);
  if (!state.syncError && !state.recurringAfterSync) { state.recurringAfterSync = true; await generateRecurring(); }
  if (!state.syncError) await autoColorsOnce();
  if (manual) toast(state.syncError ? 'Errore: ' + state.syncError : 'Sincronizzato ✓');
  renderHeader();
}

/* ---------- auth ---------- */
function authError(err) {
  const m = (err && err.message) || '';
  if (/invalid login/i.test(m)) return 'Email o password errati';
  if (/email not confirmed/i.test(m)) return 'Email non confermata (in Supabase spunta "Auto Confirm User")';
  if (/rate limit|too many/i.test(m)) return 'Troppi tentativi: riprova tra qualche minuto';
  if (/network|fetch/i.test(m)) return 'Nessuna connessione';
  return m || 'Errore di accesso';
}
async function signIn() {
  const email = $('login-email').value.trim(), password = $('login-pass').value;
  if (!email || !password) { $('login-err').textContent = 'Inserisci email e password'; return; }
  $('login-btn').disabled = true; $('login-btn').textContent = 'Accesso…';
  const { data, error } = await state.supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    $('login-err').textContent = authError(error);
    $('login-btn').disabled = false; $('login-btn').textContent = 'Accedi';
    return;
  }
  state.session = data.session; state.recurringAfterSync = false;
  closeModal(); renderHeader();
  await syncNow(true);
}
async function signOut() {
  if (!confirm('Uscire dall\'account cloud? I dati locali restano sul dispositivo.')) return;
  await state.supabaseClient.auth.signOut();
  state.session = null; render();
}
async function initCloud() {
  state.cloudChecked = true;
  if (typeof supabase === 'undefined' || !supabase.createClient) { renderHeader(); await generateRecurring(); return; }
  state.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  try {
    const { data } = await state.supabaseClient.auth.getSession();
    state.session = data.session || null;
  } catch (e) { state.session = null; }
  state.supabaseClient.auth.onAuthStateChange((evt, session) => {
    state.session = session;
    setTimeout(() => { renderHeader(); if (evt === 'SIGNED_IN' && session && !state.syncing && state.recurringAfterSync === false) { /* sync gestita da signIn/boot */ } }, 0);
  });
  state.dirty = true; // finché non c'è un sync riuscito in questa sessione
  if (state.session) { renderHeader(); scheduleSync(0); }
  else {
    await generateRecurring();
    renderHeader();
    if (state.online && !state.loginPrompted) { state.loginPrompted = true; openLoginModal(); }
  }
}

/* ---------- ricorrenze ---------- */
async function generateRecurring() {
  const rules = state.recurring.filter((r) => r.active !== false);
  if (!rules.length) return 0;
  const today = todayISO(), cur = today.slice(0, 7);
  const existing = new Set((await dbGetAll('transactions')).map((t) => t.id));
  const created = [];
  const now = nowISO();
  for (const rule of rules) {
    if (!/^\d{4}-\d{2}$/.test(rule.startMonth || '')) continue;
    let m = rule.startMonth;
    const last = rule.endMonth && rule.endMonth < cur ? rule.endMonth : cur;
    for (let guard = 0; m <= last && guard < 240; guard++, m = nextMonthKey(m)) {
      const day = Math.min(Math.max(1, rule.dayOfMonth || 1), daysInMonth(m));
      const date = m + '-' + pad2(day);
      if (date > today) continue;
      const id = detUUID('rec|' + rule.id + '|' + m);
      if (existing.has(id)) continue;
      existing.add(id);
      created.push({
        id, description: rule.description || '', accountId: rule.accountId, categoryId: rule.categoryId || null,
        type: rule.type, amount: Number(rule.amount), date, hidden: false, recurringId: rule.id,
        createdAt: now, updatedAt: now, updated_at: now, deleted: false, deleted_at: null
      });
    }
  }
  if (created.length) {
    await dbPutMany('transactions', created);
    markDirty(); await loadData(); scheduleSync();
    toast(created.length + (created.length === 1 ? ' movimento ricorrente aggiunto' : ' movimenti ricorrenti aggiunti'));
  }
  return created.length;
}
function countPendingRecurring(rule) { // quanti movimenti verrebbero creati ora da una regola
  const today = todayISO(), cur = today.slice(0, 7);
  let n = 0, m = rule.startMonth;
  const last = rule.endMonth && rule.endMonth < cur ? rule.endMonth : cur;
  for (let guard = 0; m <= last && guard < 240; guard++, m = nextMonthKey(m)) {
    const day = Math.min(Math.max(1, rule.dayOfMonth || 1), daysInMonth(m));
    if (m + '-' + pad2(day) <= today) n++;
  }
  return n;
}

/* ---------- navigazione / filtri UI ---------- */
/* Cronologia: il tasto "indietro" (Android, swipe iOS, browser) risale le schermate dell'app
   invece di uscire. Ogni cambio di schermata e ogni modale/foglio è una voce di history. */
const VIEWS = ['home', 'list', 'accounts', 'more', 'categories', 'recurring', 'hidden'];
const HIST = { idx: 0 };
let histModal = false; // true se la voce di history corrente è quella di un modale aperto
const histState = (extra) => Object.assign({ mm: 1, idx: HIST.idx, view: state.view, modal: false, from: null, scroll: 0 }, extra);
function histPush(extra) {
  try {
    history.replaceState(Object.assign({}, history.state || {}, { scroll: window.scrollY }), ''); // ricorda lo scroll della voce che lascio
    HIST.idx++; history.pushState(histState(extra), '');
  } catch (e) { /* history non disponibile: l'app funziona comunque */ }
}
function histInit() {
  try {
    history.scrollRestoration = 'manual';
    const st = history.state;
    if (st && st.mm) { // ricarica pagina: resta sulla schermata in cui eri
      HIST.idx = st.idx || 0;
      if (VIEWS.includes(st.view)) state.view = st.view;
      history.replaceState(Object.assign({}, st, { modal: false, view: state.view }), '');
    } else { HIST.idx = 0; history.replaceState(histState({ view: state.view }), ''); }
  } catch (e) { /* ignora */ }
}
function histSync() { // dopo closeModal: se non c'è più un modale, elimina la sua voce di history
  if (histModal && !$('modal-root').firstElementChild) { histModal = false; try { history.back(); } catch (e) { /* ignora */ } }
}
function goBack(fallback) { // freccia ← nell'app: stesso effetto del tasto indietro se arrivo da lì
  const st = history.state;
  if (!histModal && st && st.mm && st.from === fallback) history.back(); else setView(fallback);
}
window.addEventListener('popstate', (e) => {
  const st = e.state && e.state.mm ? e.state : { mm: 1, idx: 0, view: 'home', modal: false, scroll: 0 };
  HIST.idx = st.idx || 0;
  if (st.modal) { // sono "avanti" su un modale: se non esiste più, rimbalza indietro
    if ($('modal-root').firstElementChild) { histModal = true; return; }
    try { history.back(); } catch (err) { /* ignora */ }
    return;
  }
  histModal = false;
  if ($('modal-root').firstElementChild) closeModalDom();
  if (VIEWS.includes(st.view) && st.view !== state.view) { state.view = st.view; hideSnack(); render(); }
  window.scrollTo(0, st.scroll || 0);
});

function setView(v) {
  hideSnack();
  const from = state.view;
  if (histModal) { // un modale aperto: la sua voce diventa la nuova schermata
    closeModalDom(); histModal = false;
    try { history.replaceState(histState({ view: v, from }), ''); } catch (e) { /* ignora */ }
  } else if (v !== from) histPush({ view: v, from });
  state.view = v; render(); window.scrollTo(0, 0);
}
function changeYear(d) { state.filterYear += d; state.filterMonth = null; render(); }
function selectMonth(i) { state.filterMonth = state.filterMonth === i ? null : i; render(); }
function toggleFilters() { state.filtersOpen = !state.filtersOpen; render(); }
function toggleFilterDropdown(k) { state.filterDropdownOpen[k] = !state.filterDropdownOpen[k]; render(); }
function toggleIn(arr, v) { const i = arr.indexOf(v); if (i === -1) arr.push(v); else arr.splice(i, 1); render(); }
const toggleFilterAccount = (id) => toggleIn(state.filterAccount, id);
const toggleFilterMacroCategory = (m) => toggleIn(state.filterMacroCategory, m);
const toggleFilterCategory = (id) => toggleIn(state.filterCategory, id);
function clearFilters() { state.filterAccount = []; state.filterMacroCategory = []; state.filterCategory = []; render(); }
function setBreakdown(k, v) { state[k] = v; render(); }
function onStatusClick() {
  if (!state.supabaseClient) { toast('Cloud non disponibile (libreria non caricata)'); return; }
  if (!state.session) { openLoginModal(); return; }
  syncNow(true);
}

/* ---------- rendering: header / nav ---------- */
function syncStatus() {
  const C = {
    gray: 'bg-gray-700 text-gray-300', amber: 'bg-amber-900/60 text-amber-300', blue: 'bg-blue-900/60 text-blue-300',
    green: 'bg-green-900/50 text-green-300', red: 'bg-red-900/60 text-red-300'
  };
  let label, cls, icon = '●';
  if (!state.supabaseClient) { label = 'Solo locale'; cls = 'gray'; }
  else if (!state.session) { label = 'Accedi'; cls = 'amber'; icon = '🔑'; }
  else if (state.syncing) { label = 'Sincronizzo…'; cls = 'blue'; icon = '⟳'; }
  else if (!state.online) { label = state.dirty ? 'Offline · da sincronizzare' : 'Offline'; cls = 'gray'; }
  else if (state.syncError) { label = 'Errore · riprova'; cls = 'red'; }
  else if (state.dirty) { label = 'Da sincronizzare'; cls = 'amber'; }
  else if (state.lastSync) {
    const d = state.lastSync, same = d.toDateString() === new Date().toDateString();
    label = 'Sync ' + (same ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : d.getDate() + '/' + (d.getMonth() + 1));
    cls = 'green';
  } else { label = 'Mai sincronizzato'; cls = 'amber'; }
  return { label, icon, cls: C[cls], spin: state.syncing };
}
function renderHeader() {
  const s = syncStatus();
  $('header').innerHTML = `<header class="sticky top-0 z-30 bg-gray-800/95 border-b border-gray-700 px-4 pb-3 flex items-center justify-between" style="padding-top:calc(0.75rem + env(safe-area-inset-top))">
    <h1 class="text-lg font-bold text-blue-400">MoneyManager</h1>
    <button onclick="onStatusClick()" class="${s.cls} rounded-full px-3 py-1.5 text-xs font-bold flex items-center gap-1.5" ${state.syncError ? `title="${esc(state.syncError)}"` : ''}>
      <span class="${s.spin ? 'animate-spin inline-block' : ''}">${s.icon}</span><span>${esc(s.label)}</span>
    </button></header>`;
}
function renderNav() {
  const main = ['categories', 'recurring', 'hidden'].includes(state.view) ? 'more' : state.view;
  const item = (v, icon, label) => `<button onclick="setView('${v}')" class="flex flex-col items-center py-2 text-xs ${main === v ? 'text-blue-400 font-bold' : 'text-gray-400'}"><span class="text-xl leading-none mb-0.5">${icon}</span>${label}</button>`;
  $('nav').innerHTML = `<nav class="fixed bottom-0 inset-x-0 z-30 bg-gray-800 border-t border-gray-700 grid grid-cols-4" style="padding-bottom:env(safe-area-inset-bottom)">
    ${item('home', '📊', 'Panoramica')}${item('list', '🧾', 'Movimenti')}${item('accounts', '💳', 'Conti')}${item('more', '☰', 'Altro')}</nav>
    <button onclick="openTxModal()" aria-label="Aggiungi movimento" class="fixed right-4 z-30 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-3xl shadow-lg flex items-center justify-center" style="bottom:calc(4.75rem + env(safe-area-inset-bottom))">+</button>`;
}
function render() { renderHeader(); renderNav(); renderMain(); }
function renderMain() {
  const y = window.scrollY;
  const views = { home: viewHome, list: viewList, accounts: viewAccounts, more: viewMore, categories: viewCategories, recurring: viewRecurring, hidden: viewHidden };
  $('main').innerHTML = (views[state.view] || viewHome)();
  window.scrollTo(0, y);
}

/* ---------- viste: filtri ---------- */
function msDropdown(kind, label, items, selected, toggleFn, resetExpr) {
  const open = state.filterDropdownOpen[kind];
  return `<div class="mb-2">
    <button onclick="toggleFilterDropdown('${kind}')" class="w-full bg-gray-700 rounded-lg p-3 flex justify-between items-center text-sm font-bold">
      <span>${label} ${selected.length ? `(${selected.length})` : '(tutti)'}</span><span class="text-gray-400">${open ? '▲' : '▼'}</span></button>
    ${open ? `<div class="bg-gray-700 rounded-lg mt-1 max-h-56 overflow-y-auto">
      ${items.map((it) => `<label class="flex items-center gap-2 p-2.5 border-b border-gray-600/50 cursor-pointer">
        <input type="checkbox" ${selected.includes(it.id) ? 'checked' : ''} onchange="${toggleFn}('${esc(it.id)}')" class="w-4 h-4">
        ${it.color ? `<span class="w-3 h-3 rounded-full inline-block" style="background:${esc(it.color)}"></span>` : ''}
        <span class="text-sm flex-1">${esc(it.label)}</span>${it.sub ? `<span class="text-xs text-gray-400">${esc(it.sub)}</span>` : ''}</label>`).join('')}
      ${selected.length ? `<button onclick="${resetExpr}" class="w-full p-2 text-xs text-blue-400">Reset</button>` : ''}</div>` : ''}</div>`;
}
function filterBar() {
  const n = activeFilterCount();
  const cats = state.categories.filter((c) => !state.filterMacroCategory.length || state.filterMacroCategory.includes(c.macroCategory || 'Spese variabili'));
  return `<div class="flex items-center gap-2 mb-3">
      <div class="flex items-center bg-gray-800 rounded-lg"><button onclick="changeYear(-1)" class="px-3 py-2" aria-label="Anno precedente">◀</button><span class="px-1 font-bold">${state.filterYear}</span><button onclick="changeYear(1)" class="px-3 py-2" aria-label="Anno successivo">▶</button></div>
      <button onclick="toggleFilters()" class="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm text-left">⚙️ Filtri ${n ? `<span class="bg-blue-600 rounded-full px-2 py-0.5 text-xs ml-1">${n}</span>` : ''}</button>
      ${state.filterMonth !== null ? `<button onclick="selectMonth(${state.filterMonth})" class="bg-blue-900/60 text-blue-200 rounded-lg px-3 py-2 text-sm">${MONTHS[state.filterMonth]} ✕</button>` : ''}
    </div>
    ${state.filtersOpen ? `<div class="bg-gray-800 rounded-lg p-3 mb-3">
      ${msDropdown('account', 'Conti', state.accounts.map((a) => ({ id: a.id, label: a.name })), state.filterAccount, 'toggleFilterAccount', 'state.filterAccount=[];render()')}
      ${msDropdown('macro', 'Macrocategorie', MACROS.map((m) => ({ id: m, label: m })), state.filterMacroCategory, 'toggleFilterMacroCategory', 'state.filterMacroCategory=[];render()')}
      ${msDropdown('category', 'Categorie', cats.map((c) => ({ id: c.id, label: c.name, color: c.color, sub: c.macroCategory })), state.filterCategory, 'toggleFilterCategory', 'state.filterCategory=[];render()')}
      ${n ? `<button onclick="clearFilters()" class="w-full bg-red-600 hover:bg-red-700 rounded-lg p-2 mt-1 text-sm font-bold">Cancella tutti i filtri</button>` : ''}</div>` : ''}`;
}

/* ---------- colori categorie: tutti diversi, e ben distinti tra voci con la stessa prima parola ---------- */
const COLOR_VARIANTS = [[72, 58], [90, 44], [60, 72], [82, 52], [96, 65], [52, 48], [78, 70], [70, 42], [88, 56], [64, 62]]; // [saturazione, luminosità]
function hslHex(h, sat, lig) {
  const sa = sat / 100, l = lig / 100, k = (n) => (n + h / 30) % 12, a = sa * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function colorPool(n) { // almeno n colori candidati: 12 tonalità x varianti di saturazione/luminosità
  const out = [], V = Math.max(COLOR_VARIANTS.length, Math.ceil(n * 1.5 / 12));
  for (let v = 0; v < V; v++) {
    const [sat, lig] = COLOR_VARIANTS[v % COLOR_VARIANTS.length], off = (v % 2 ? 15 : 0) + Math.floor(v / COLOR_VARIANTS.length) * 7;
    for (let k = 0; k < 12; k++) out.push({ hex: hslHex((k * 30 + off) % 360, sat, lig), h: (k * 30 + off) % 360, s: sat, l: lig });
  }
  return out;
}
const colorDist = (a, b) => { const dh = Math.abs(a.h - b.h); return Math.min(dh, 360 - dh) + 1.2 * Math.abs(a.l - b.l) + 0.4 * Math.abs(a.s - b.s); };
const firstWord = (name) => ((String(name).toLowerCase().match(/[\p{L}\p{N}]+/u) || [''])[0]);
const hueDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
function distinctColorPlan(cats) { // id -> colore esadecimale. Deterministico: stessa lista => stessi colori su ogni dispositivo
  const list = cats.slice().sort((a, b) => byName(a, b) || String(a.id).localeCompare(String(b.id)));
  const pool = colorPool(list.length), used = new Set(), assigned = [], plan = new Map(), groups = new Map();
  list.forEach((c) => { const g = firstWord(c.name); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
  let gi = 0;
  const target = new Map(); // tonalità desiderata: le voci con la stessa prima parola si dividono equamente il cerchio cromatico
  groups.forEach((members) => {
    const base = (gi++ * 137.508) % 360;
    members.forEach((c, j) => target.set(c.id, (base + j * (360 / members.length)) % 360));
  });
  list.forEach((c) => {
    const t = target.get(c.id), free = pool.filter((p) => !used.has(p.hex));
    let best = null, bs = -Infinity;
    free.forEach((p) => {
      const near = assigned.filter((q) => hueDiff(q.h, p.h) <= 40); // colori vicini per tonalità: devono differire per luminosità/saturazione
      const sep = near.length ? Math.min(...near.map((q) => 1.2 * Math.abs(q.l - p.l) + 0.4 * Math.abs(q.s - p.s) + hueDiff(q.h, p.h))) : 99;
      const score = -hueDiff(t, p.h) * 10 + Math.min(sep, 40);
      if (score > bs) { bs = score; best = p; }
    });
    used.add(best.hex); assigned.push(best); plan.set(c.id, best.hex);
  });
  return plan;
}
async function assignDistinctColors(manual) {
  const plan = distinctColorPlan(state.categories), recs = [];
  state.categories.forEach((c) => { const col = plan.get(c.id); if (col && (c.color || '').toLowerCase() !== col) recs.push(touch({ ...c, color: col })); });
  if (recs.length) { await dbPutMany('categories', recs); await afterMutation(); }
  if (manual) toast(recs.length ? recs.length + ' categorie ricolorate' : 'Colori già distinti');
  return recs.length;
}
async function autoColorsOnce() { // una sola volta per dispositivo, appena ci sono categorie
  if (state.colorsChecked || !state.categories.length) return;
  state.colorsChecked = true;
  if (await settingGet('colors_distinct_v1')) return;
  await assignDistinctColors(false);
  await settingSet('colors_distinct_v1', '1');
}
function nextCategoryColor() { // colore per una categoria nuova: non usato e lontano da quelli già presi
  const pool = colorPool(state.categories.length + 1), used = new Set(state.categories.map((c) => (c.color || '').toLowerCase()));
  const taken = pool.filter((p) => used.has(p.hex)), free = pool.filter((p) => !used.has(p.hex));
  if (!free.length) return '#3b82f6';
  let best = free[0], bs = -1;
  free.forEach((p) => { const sc = taken.length ? Math.min(...taken.map((t) => colorDist(p, t))) : 999; if (sc > bs) { bs = sc; best = p; } });
  return best.hex;
}
function recolorAll() { if (confirm('Assegnare a tutte le categorie colori diversi? I colori scelti a mano verranno sostituiti.')) assignDistinctColors(true); }

/* ---------- viste: panoramica ---------- */
const pieColor = (i) => `hsl(${Math.round((i * 137.508) % 360)} 72% ${[58, 48, 68][i % 3]}%)`;
function donut(slices, total) {
  let acc = 0;
  const circles = slices.map((s) => {
    const pct = (s.value / total) * 100, gap = slices.length > 1 && pct > 1 ? 0.35 : 0;
    const c = `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${esc(s.color)}" stroke-width="6" stroke-dasharray="${Math.max(pct - gap, 0.05).toFixed(3)} ${(100 - Math.max(pct - gap, 0.05)).toFixed(3)}" stroke-dashoffset="${(-acc).toFixed(3)}"></circle>`;
    acc += pct; return c;
  }).join('');
  return `<svg viewBox="0 0 42 42" class="w-36 h-36 -rotate-90 shrink-0"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="#374151" stroke-width="6"></circle>${circles}</svg>`;
}
function breakdownHTML() {
  const type = state.breakdownType, by = state.breakdownBy;
  const list = statsOnly(scopeTx()).filter((t) => t.type === type);
  const groups = new Map();
  list.forEach((t) => {
    const c = state.catById.get(t.categoryId);
    let key, name, color;
    if (by === 'macro') { name = c ? (c.macroCategory || 'Spese variabili') : 'Senza categoria'; key = name; color = MACRO_COLORS[name] || '#8b5cf6'; }
    else { key = t.categoryId || 'none'; name = c ? c.name : 'Senza categoria'; color = c ? c.color || '#3b82f6' : MACRO_COLORS['Senza categoria']; }
    const g = groups.get(key) || { key, name, color, value: 0 };
    g.value += toCents(t.amount); groups.set(key, g);
  });
  let rows = [...groups.values()].sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  // ogni voce resta separata (niente "Altre"); se due categorie hanno lo stesso colore salvato, la torta ne usa uno alternativo
  if (by === 'category') { const seen = new Set(); rows.forEach((r, i) => { const col = String(r.color).toLowerCase(); if (r.key === 'none') r.color = MACRO_COLORS['Senza categoria']; else if (seen.has(col)) r.color = pieColor(i); seen.add(String(r.color).toLowerCase()); }); }
  const pill = (active, label, js) => `<button onclick="${js}" class="px-3 py-1.5 rounded-md text-xs font-bold ${active ? 'bg-blue-600 text-white' : 'text-gray-400'}">${label}</button>`;
  return `<div class="bg-gray-800 rounded-lg p-4 mb-4">
    <div class="flex justify-between items-center mb-3 gap-2">
      <div class="flex bg-gray-900 rounded-lg p-0.5">${pill(type === 'expense', 'Uscite', "setBreakdown('breakdownType','expense')")}${pill(type === 'income', 'Entrate', "setBreakdown('breakdownType','income')")}</div>
      <div class="flex bg-gray-900 rounded-lg p-0.5">${pill(by === 'category', 'Categorie', "setBreakdown('breakdownBy','category')")}${pill(by === 'macro', 'Macro', "setBreakdown('breakdownBy','macro')")}</div>
    </div>
    ${total === 0 ? '<p class="text-gray-400 text-center py-6 text-sm">Nessun dato nel periodo</p>' : `
    <div class="flex items-center gap-4">
      <div class="relative">${donut(rows, total)}<div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none"><span class="text-[10px] text-gray-400">Totale</span><span class="text-sm font-bold">${fmt(total)}</span></div></div>
      <div class="flex-1 min-w-0 space-y-1.5">
        ${rows.slice(0, 6).map((r) => `<div class="flex items-center gap-2 text-xs"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(r.color)}"></span><span class="truncate flex-1">${esc(r.name)}</span><span class="text-gray-400">${Math.round((r.value / total) * 100)}%</span></div>`).join('')}
        ${rows.length > 6 ? `<div class="text-[11px] text-gray-500">+ ${rows.length - 6} voci nell'elenco sotto</div>` : ''}
      </div></div>
    <div class="mt-4 divide-y divide-gray-700">
      ${rows.map((r) => {
        const clickable = by === 'category' && r.key !== 'none';
        return `<${clickable ? 'button onclick="toggleFilterCategory(\'' + r.key + '\')"' : 'div'} class="w-full flex items-center gap-2 py-2 text-sm text-left">
          <span class="w-3 h-3 rounded-full shrink-0" style="background:${esc(r.color)}"></span><span class="flex-1 truncate">${esc(r.name)}</span>
          <span class="font-medium">${fmt(r.value)}</span><span class="text-xs text-gray-400 w-9 text-right">${Math.round((r.value / total) * 100)}%</span></${clickable ? 'button' : 'div'}>`;
      }).join('')}</div>`}</div>`;
}
function viewHome() {
  const scope = statsOnly(scopeTx());
  const s = sums(scope);
  const monthly = monthlyNet();
  const maxAbs = Math.max(...monthly.map(Math.abs), 10000);
  const bal = accountBalances();
  const totalBal = [...bal.values()].reduce((a, b) => a + b, 0);
  const label = state.filterMonth !== null ? MONTHS_LONG[state.filterMonth] + ' ' + state.filterYear : 'Anno ' + state.filterYear;
  return `${filterBar()}
    ${state.accounts.length ? `<button onclick="setView('accounts')" class="w-full bg-gray-800 rounded-lg p-4 mb-3 text-left flex justify-between items-center">
      <div><div class="text-xs text-gray-400">Patrimonio oggi (somma saldi conti)</div><div class="text-2xl font-bold ${totalBal >= 0 ? 'text-gray-100' : 'text-red-400'}">${fmt(totalBal)}</div></div><span class="text-gray-500">›</span></button>` : ''}
    <div class="text-xs text-gray-400 mb-1 px-1">${esc(label)}</div>
    <div class="grid grid-cols-3 gap-2 mb-4">
      <div class="bg-gray-800 rounded-lg p-3"><div class="text-xs text-gray-400">Entrate</div><div class="text-sm font-bold text-green-400">${s.income ? '+' : ''}${fmt(s.income)}</div></div>
      <div class="bg-gray-800 rounded-lg p-3"><div class="text-xs text-gray-400">Uscite</div><div class="text-sm font-bold text-red-400">${s.expense ? '-' : ''}${fmt(s.expense)}</div></div>
      <div class="bg-gray-800 rounded-lg p-3"><div class="text-xs text-gray-400">Saldo</div><div class="text-sm font-bold ${s.net >= 0 ? 'text-green-400' : 'text-red-400'}">${fmtSigned(s.net)}</div></div>
    </div>
    <div class="bg-gray-800 rounded-lg p-3 mb-4">
      <div class="flex justify-between items-baseline mb-2 px-1"><h2 class="font-bold text-sm">Andamento ${state.filterYear}</h2><span class="text-[11px] text-gray-500">tocca un mese per filtrare</span></div>
      <div class="flex items-end gap-0.5 h-48">
        ${monthly.map((val, idx) => {
          const h = (Math.abs(val) / maxAbs) * 100, pos = val >= 0, sel = state.filterMonth === idx;
          return `<button onclick="selectMonth(${idx})" aria-label="${MONTHS_LONG[idx]}" class="flex-1 flex flex-col items-center h-full rounded ${sel ? 'bg-gray-700 ring-1 ring-blue-500' : ''}">
            <div class="flex-1 flex items-end w-full px-0.5">${pos && val !== 0 ? `<div style="height:${h}%" class="w-full bg-green-500 rounded-t"></div>` : ''}</div>
            <div class="h-px w-full bg-gray-600"></div>
            <div class="flex-1 flex items-start w-full px-0.5">${!pos ? `<div style="height:${h}%" class="w-full bg-red-500 rounded-b"></div>` : ''}</div>
            <div class="text-[10px] mt-1 font-bold ${val === 0 ? 'text-gray-500' : pos ? 'text-green-400' : 'text-red-400'}">${val === 0 ? '0' : fmtCompact(val)}</div>
            <div class="text-[10px] ${sel ? 'text-blue-300 font-bold' : 'text-gray-400'}">${MONTHS[idx]}</div></button>`;
        }).join('')}
      </div></div>
    ${breakdownHTML()}`;
}

/* ---------- viste: movimenti ---------- */
function buildItems(list) {
  const seen = new Set(), out = [];
  list.slice().sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : tms(b.createdAt) - tms(a.createdAt))).forEach((t) => {
    if (t.transferId) {
      if (seen.has(t.transferId)) return;
      seen.add(t.transferId);
      const legs = state.legs.get(t.transferId) || [t];
      out.push({ tx: legs.find((l) => l.type === 'expense') || t, out: legs.find((l) => l.type === 'expense'), in: legs.find((l) => l.type === 'income') });
    } else out.push({ tx: t });
  });
  return out;
}
function txRowHTML(it) {
  const t = it.tx;
  if (t.transferId) {
    const cents = toCents(t.amount);
    return `<div class="flex items-center gap-3 px-3 py-2.5" onclick="editTx('${t.id}')">
      <div class="w-1.5 self-stretch rounded bg-blue-500"></div>
      <div class="flex-1 min-w-0"><div class="font-medium truncate">⇄ ${esc(t.description || 'Giroconto')}</div>
        <div class="text-xs text-gray-400 truncate">${esc(it.out ? accName(it.out.accountId) : '?')} → ${esc(it.in ? accName(it.in.accountId) : '?')}</div></div>
      <div class="font-bold text-blue-300 whitespace-nowrap">${fmt(cents)}</div>
      <button onclick="event.stopPropagation();openSheet('${t.id}')" class="px-2 py-1 text-gray-400 text-xl leading-none" aria-label="Azioni">⋯</button></div>`;
  }
  const c = state.catById.get(t.categoryId), cents = toCents(t.amount);
  return `<div class="flex items-center gap-3 px-3 py-2.5" onclick="editTx('${t.id}')">
    <div class="w-1.5 self-stretch rounded" style="background:${esc(c ? c.color : '#6b7280')}"></div>
    <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(t.description || catName(t.categoryId))}${t.recurringId ? ' <span title="Ricorrente">🔁</span>' : ''}${t.hidden ? ' <span title="Nascosto">🙈</span>' : ''}</div>
      <div class="text-xs text-gray-400 truncate">${esc(accName(t.accountId))} • ${esc(catName(t.categoryId))}</div></div>
    <div class="font-bold whitespace-nowrap ${t.type === 'income' ? 'text-green-400' : 'text-red-400'}">${t.type === 'income' ? '+' : '-'}${fmt(cents)}</div>
    <button onclick="event.stopPropagation();openSheet('${t.id}')" class="px-2 py-1 text-gray-400 text-xl leading-none" aria-label="Azioni">⋯</button></div>`;
}
function groupedListHTML(items, emptyMsg) {
  if (!items.length) return `<p class="text-gray-400 text-center py-10">${emptyMsg}</p>`;
  const days = new Map();
  items.forEach((it) => { const d = it.tx.date; if (!days.has(d)) days.set(d, []); days.get(d).push(it); });
  return [...days.entries()].map(([d, arr]) => {
    const [y, m, dd] = d.split('-').map(Number);
    const label = new Date(y, m - 1, dd).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
    const net = sums(arr.filter((i) => !i.tx.transferId).map((i) => i.tx)).net;
    return `<div class="mb-3"><div class="flex justify-between px-1 pb-1 text-xs text-gray-400"><span class="uppercase tracking-wide">${esc(label)}</span><span>${net ? fmtSigned(net) : ''}</span></div>
      <div class="bg-gray-800 rounded-lg divide-y divide-gray-700 overflow-hidden">${arr.map(txRowHTML).join('')}</div></div>`;
  }).join('');
}
function viewList() {
  const scope = scopeTx();
  const s = sums(statsOnly(scope));
  return `${filterBar()}
    <div class="flex justify-between text-xs text-gray-400 mb-3 px-1"><span>${scope.length} movimenti</span><span><span class="text-green-400">${s.income ? '+' : ''}${fmt(s.income)}</span> · <span class="text-red-400">${s.expense ? '-' : ''}${fmt(s.expense)}</span></span></div>
    ${groupedListHTML(buildItems(scope), 'Nessun movimento')}`;
}

/* ---------- viste: conti ---------- */
function viewAccounts() {
  const bal = accountBalances();
  const total = [...bal.values()].reduce((a, b) => a + b, 0);
  return `<div class="bg-gray-800 rounded-lg p-4 mb-3"><div class="text-xs text-gray-400">Patrimonio oggi</div><div class="text-3xl font-bold ${total >= 0 ? '' : 'text-red-400'}">${fmt(total)}</div>
      <div class="text-[11px] text-gray-500 mt-1">Saldo = saldo iniziale + movimenti fino a oggi (i futuri non contano)</div></div>
    <div class="grid grid-cols-2 gap-2 mb-4">
      <button onclick="openAccountModal()" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold text-sm">➕ Nuovo conto</button>
      <button onclick="openTxModal(null,'transfer')" class="bg-gray-700 hover:bg-gray-600 rounded-lg p-3 font-bold text-sm" ${state.accounts.length < 2 ? 'disabled style="opacity:.5"' : ''}>⇄ Giroconto</button></div>
    ${state.accounts.map((a) => {
      const b = bal.get(a.id) || 0;
      return `<div class="bg-gray-800 rounded-lg p-4 mb-2 flex items-center justify-between">
        <div class="min-w-0"><div class="font-bold truncate">${esc(a.name)}</div><div class="text-xs text-gray-400">Saldo iniziale: ${fmt(toCents(a.initialBalance))}</div></div>
        <div class="flex items-center gap-2"><div class="text-lg font-bold ${b >= 0 ? 'text-gray-100' : 'text-red-400'}">${fmt(b)}</div>
          <button onclick="openAccountModal('${a.id}')" class="p-2 bg-gray-700 rounded" aria-label="Modifica">✏️</button>
          <button onclick="deleteAccount('${a.id}')" class="p-2 bg-gray-700 rounded" aria-label="Elimina">🗑️</button></div></div>`;
    }).join('')}
    ${state.accounts.length === 0 ? '<p class="text-gray-400 text-center py-8">Nessun conto</p>' : ''}`;
}

/* ---------- viste: altro ---------- */
function backupAgeDays() { return state.lastBackup ? Math.floor((Date.now() - Date.parse(state.lastBackup)) / 86400000) : null; }
function viewMore() {
  const age = backupAgeDays();
  const row = (icon, title, sub, js, extra = '') => `<button onclick="${js}" class="w-full bg-gray-800 hover:bg-gray-700 rounded-lg p-4 mb-2 flex items-center gap-3 text-left ${extra}">
    <span class="text-xl">${icon}</span><span class="flex-1"><span class="block font-bold text-sm">${title}</span><span class="block text-xs text-gray-400">${sub}</span></span><span class="text-gray-500">›</span></button>`;
  const email = state.session && state.session.user ? esc(state.session.user.email) : null;
  return `<h2 class="text-xs uppercase tracking-wide text-gray-500 mb-2 px-1">Gestione</h2>
    ${row('🏷️', 'Categorie', state.categories.length + ' categorie', "setView('categories')")}
    ${row('🔁', 'Ricorrenti', state.recurring.length + ' regole (affitto, abbonamenti, stipendio…)', "setView('recurring')")}
    ${row('🙈', 'Nascoste', 'Movimenti esclusi dalle analisi', "setView('hidden')")}
    <h2 class="text-xs uppercase tracking-wide text-gray-500 mt-5 mb-2 px-1">Cloud</h2>
    <div class="bg-gray-800 rounded-lg p-4 mb-2 text-sm">
      ${!state.supabaseClient ? '<span class="text-gray-400">Cloud non disponibile: libreria non caricata (sei offline al primo avvio?).</span>'
        : email ? `<div class="mb-1">Connesso come <b>${email}</b></div><div class="text-xs text-gray-400 mb-3">${state.lastSync ? 'Ultima sync: ' + state.lastSync.toLocaleString('it-IT') : 'Mai sincronizzato'}</div>
          <div class="grid grid-cols-2 gap-2"><button onclick="syncNow(true)" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-2 font-bold">🔄 Sincronizza</button><button onclick="signOut()" class="bg-gray-700 hover:bg-gray-600 rounded-lg p-2">Esci</button></div>`
        : `<div class="text-gray-400 mb-3">Non sei connesso al cloud: i dati restano solo su questo dispositivo.</div><button onclick="openLoginModal()" class="w-full bg-blue-600 hover:bg-blue-700 rounded-lg p-2 font-bold">🔑 Accedi</button>`}
    </div>
    <h2 class="text-xs uppercase tracking-wide text-gray-500 mt-5 mb-2 px-1">Dati</h2>
    ${row('💾', 'Esporta backup (JSON)', age === null ? '⚠️ Nessun backup ancora eseguito' : (age > 30 ? '⚠️ Ultimo backup ' + age + ' giorni fa' : 'Ultimo backup: ' + new Date(state.lastBackup).toLocaleDateString('it-IT')), 'exportBackup()')}
    ${row('📂', 'Importa backup (JSON)', 'Unisce il file ai dati attuali; vince il più recente, non cancella nulla', "$('import-file').click()")}
    <input id="import-file" type="file" accept=".json,application/json" class="hidden" onchange="importBackup(this.files[0]);this.value=''">
    ${row('📥', 'Esporta CSV', 'Movimenti del periodo/filtri attuali (per Excel)', 'exportCSV()')}
    <div class="text-center text-[11px] text-gray-600 mt-6">MoneyManager v${APP_VERSION}</div>`;
}
const backBtn = (title) => `<div class="flex items-center gap-2 mb-4"><button onclick="goBack('more')" class="px-3 py-2 bg-gray-800 rounded-lg" aria-label="Indietro">←</button><h2 class="text-lg font-bold">${title}</h2></div>`;
function viewCategories() {
  const sorted = state.categories.slice().sort((a, b) => MACROS.indexOf(a.macroCategory) - MACROS.indexOf(b.macroCategory) || a.name.localeCompare(b.name, 'it'));
  return `${backBtn('Categorie')}<button onclick="openCategoryModal()" class="w-full bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold mb-2">➕ Nuova categoria</button>
    <button onclick="recolorAll()" class="w-full bg-gray-800 hover:bg-gray-700 rounded-lg p-3 text-sm mb-4">🎨 Colori diversi per tutte le categorie</button>
    ${sorted.map((c) => `<div class="bg-gray-800 rounded-lg p-3 mb-2 flex items-center justify-between">
      <div class="flex items-center gap-3 min-w-0"><div class="w-4 h-4 rounded shrink-0" style="background:${esc(c.color)}"></div><div class="min-w-0"><div class="font-bold truncate">${esc(c.name)}</div><div class="text-xs text-gray-400">${esc(c.macroCategory || 'Spese variabili')}</div></div></div>
      <div class="flex gap-2"><button onclick="openCategoryModal('${c.id}')" class="p-2 bg-gray-700 rounded" aria-label="Modifica">✏️</button><button onclick="deleteCategory('${c.id}')" class="p-2 bg-gray-700 rounded" aria-label="Elimina">🗑️</button></div></div>`).join('')}
    ${sorted.length === 0 ? '<p class="text-gray-400 text-center py-8">Nessuna categoria</p>' : ''}`;
}
function viewRecurring() {
  return `${backBtn('Ricorrenti')}
    <p class="text-xs text-gray-400 mb-3">Le regole creano da sole il movimento ogni mese, nel giorno indicato (solo quando la data è arrivata). Cancellare un movimento generato non lo rigenera.</p>
    <button onclick="openRecurringModal()" class="w-full bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold mb-4">➕ Nuova ricorrenza</button>
    ${state.recurring.map((r) => `<div class="bg-gray-800 rounded-lg p-3 mb-2 ${r.active === false ? 'opacity-60' : ''}">
      <div class="flex justify-between gap-2"><div class="min-w-0"><div class="font-bold truncate">${esc(r.description || catName(r.categoryId))}</div>
        <div class="text-xs text-gray-400">Ogni ${r.dayOfMonth} del mese • dal ${esc(r.startMonth)}${r.endMonth ? ' al ' + esc(r.endMonth) : ''}</div>
        <div class="text-xs text-gray-400 truncate">${esc(accName(r.accountId))} • ${esc(catName(r.categoryId))}</div></div>
        <div class="font-bold whitespace-nowrap ${r.type === 'income' ? 'text-green-400' : 'text-red-400'}">${r.type === 'income' ? '+' : '-'}${fmt(toCents(r.amount))}</div></div>
      <div class="flex gap-2 mt-2 text-xs">
        <button onclick="toggleRule('${r.id}')" class="flex-1 p-2 bg-gray-700 rounded">${r.active === false ? '▶️ Attiva' : '⏸️ Sospendi'}</button>
        <button onclick="openRecurringModal('${r.id}')" class="flex-1 p-2 bg-gray-700 rounded">✏️ Modifica</button>
        <button onclick="deleteRule('${r.id}')" class="flex-1 p-2 bg-gray-700 rounded">🗑️ Elimina</button></div></div>`).join('')}
    ${state.recurring.length === 0 ? '<p class="text-gray-400 text-center py-8">Nessuna ricorrenza</p>' : ''}`;
}
function viewHidden() {
  const hidden = state.transactions.filter((t) => t.hidden && txYear(t) === state.filterYear);
  const tot = sums(statsOnly(hidden)).net;
  return `${backBtn('Nascoste ' + state.filterYear)}
    <div class="flex items-center bg-gray-800 rounded-lg w-max mb-3"><button onclick="changeYear(-1)" class="px-3 py-2">◀</button><span class="px-1 font-bold">${state.filterYear}</span><button onclick="changeYear(1)" class="px-3 py-2">▶</button></div>
    <div class="bg-gray-800 rounded-lg p-4 mb-4"><div class="text-xs text-gray-400">Totale nascosto</div><div class="text-2xl font-bold ${tot >= 0 ? 'text-green-400' : 'text-red-400'}">${fmtSigned(tot)}</div></div>
    ${groupedListHTML(buildItems(hidden), 'Nessuna transazione nascosta')}`;
}

/* ---------- modali ---------- */
function showModal(inner, { dismissible = true, top = false } = {}) {
  hideSnack();
  state.dismissible = dismissible;
  if (!histModal) { histPush({ modal: true }); histModal = true; }
  $('modal-root').innerHTML = `<div class="fixed inset-0 z-50 flex ${top ? 'items-start' : 'items-end'} sm:items-center justify-center bg-black/70" onmousedown="if(event.target===this&&state.dismissible)closeModal()">
    <div class="bg-gray-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto sheet-anim" style="padding-bottom:calc(1.25rem + env(safe-area-inset-bottom))">${inner}</div></div>`;
}
function closeModalDom() { state.modal = null; state.editing = null; $('modal-root').innerHTML = ''; }
function closeModal() { closeModalDom(); queueMicrotask(histSync); }
const modalHead = (title) => `<div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">${title}</h2><button type="button" onclick="closeModal()" class="text-gray-400 text-2xl leading-none px-2" aria-label="Chiudi">×</button></div>`;
const inputCls = 'w-full bg-gray-700 rounded-lg p-3 text-base outline-none focus:ring-2 focus:ring-blue-500';
const formErr = (msg) => { const e = $('form-err'); if (e) { e.textContent = msg; e.classList.remove('hidden'); } };

/* --- movimento (nuovo / modifica / giroconto) --- */
function categoryOptionsHTML(type, selectedId) { // un solo elenco, in ordine alfabetico
  const opt = (c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name.trim())}</option>`;
  const orphan = selectedId && !state.catById.has(selectedId) ? `<option value="${esc(selectedId)}" selected>(eliminata) ${esc(catName(selectedId))}</option>` : '';
  return `<option value="">Senza categoria</option>${orphan}${state.categories.map(opt).join('')}`;
}
function accountOptionsHTML(selectedId) {
  return state.accounts.map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}
function openTxModal(editingTx = null, preset = null) {
  if (!state.accounts.length) { toast('Crea prima un conto'); setView('accounts'); return; }
  const isTransfer = editingTx ? !!editingTx.transferId : preset === 'transfer';
  const type = isTransfer ? 'transfer' : (editingTx ? editingTx.type : (preset || 'expense'));
  state.modal = 'tx'; state.editing = editingTx; state.txType = type;
  let fromId, toId, cents = '', date = todayISO(), desc = '', catId = null, hidden = false;
  if (editingTx) {
    desc = editingTx.description || ''; date = editingTx.date; cents = toCents(editingTx.amount); catId = editingTx.categoryId; hidden = !!editingTx.hidden;
    if (isTransfer) {
      const legs = state.legs.get(editingTx.transferId) || [editingTx];
      const out = legs.find((l) => l.type === 'expense'), inn = legs.find((l) => l.type === 'income');
      fromId = out && out.accountId; toId = inn && inn.accountId;
    } else fromId = editingTx.accountId;
  } else {
    fromId = state.accById.has(state.prefs.lastAccount) ? state.prefs.lastAccount : state.accounts[0].id;
    toId = (state.accounts.find((a) => a.id !== fromId) || {}).id;
    const lc = state.prefs.lastCat[type === 'income' ? 'income' : 'expense'];
    catId = state.catById.has(lc) ? lc : null;
  }
  const seg = (t, label) => `<button type="button" id="seg-${t}" onclick="setTxType('${t}')" class="py-2 rounded-md text-sm font-bold ${type === t ? 'bg-blue-600 text-white' : 'text-gray-400'}">${label}</button>`;
  const segs = editingTx ? (isTransfer ? '' : `<div class="grid grid-cols-2 gap-1 bg-gray-900 rounded-lg p-1 mb-4">${seg('expense', 'Uscita')}${seg('income', 'Entrata')}</div>`)
    : `<div class="grid grid-cols-3 gap-1 bg-gray-900 rounded-lg p-1 mb-4">${seg('expense', 'Uscita')}${seg('income', 'Entrata')}${seg('transfer', 'Giroconto')}</div>`;
  showModal(`<form onsubmit="saveTxForm();return false" autocomplete="off">
    ${modalHead(editingTx ? (isTransfer ? 'Modifica giroconto' : 'Modifica movimento') : 'Nuovo movimento')}
    ${segs}
    <div class="flex items-baseline gap-2 mb-4"><input id="f-amount" type="text" inputmode="decimal" placeholder="0,00" value="${cents === '' ? '' : amountToInput(cents)}" class="w-full bg-transparent text-4xl font-bold outline-none placeholder-gray-600"><span class="text-3xl text-gray-400">€</span></div>
    <label id="lbl-acc" class="text-xs text-gray-400">${isTransfer ? 'Da conto' : 'Conto'}</label>
    <select id="f-acc" class="${inputCls} mb-3">${accountOptionsHTML(fromId)}</select>
    <div id="row-to" class="${isTransfer ? '' : 'hidden'}"><label class="text-xs text-gray-400">A conto</label>
      <select id="f-to" class="${inputCls} mb-3">${accountOptionsHTML(toId)}</select></div>
    <div id="row-cat" class="${isTransfer ? 'hidden' : ''}"><label class="text-xs text-gray-400">Categoria</label>
      <select id="f-cat" class="${inputCls} mb-3">${categoryOptionsHTML(type === 'income' ? 'income' : 'expense', catId)}</select></div>
    <label class="text-xs text-gray-400">Descrizione</label>
    <input id="f-desc" value="${esc(desc)}" placeholder="Opzionale" class="${inputCls} mb-3">
    <label class="text-xs text-gray-400">Data</label>
    <input id="f-date" type="date" value="${esc(date)}" class="${inputCls} mb-3">
    <label id="row-hidden" class="flex items-center gap-2 mb-3 ${isTransfer ? 'hidden' : ''}"><input id="f-hidden" type="checkbox" ${hidden ? 'checked' : ''} class="w-4 h-4"><span class="text-sm">Nascondi dalle analisi</span></label>
    <div id="form-err" class="hidden text-sm text-red-400 mb-3"></div>
    <div class="grid grid-cols-2 gap-2"><button type="button" onclick="closeModal()" class="bg-gray-700 hover:bg-gray-600 rounded-lg p-3">Annulla</button><button type="submit" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold">Salva</button></div>
  </form>`, { dismissible: false });
  if (!editingTx) setTimeout(() => { const a = $('f-amount'); if (a) a.focus(); }, 50);
}
function setTxType(t) {
  state.txType = t;
  ['expense', 'income', 'transfer'].forEach((k) => {
    const b = $('seg-' + k); if (!b) return;
    b.className = 'py-2 rounded-md text-sm font-bold ' + (k === t ? 'bg-blue-600 text-white' : 'text-gray-400');
  });
  const tr = t === 'transfer';
  $('row-to').classList.toggle('hidden', !tr);
  $('row-cat').classList.toggle('hidden', tr);
  $('row-hidden').classList.toggle('hidden', tr);
  $('lbl-acc').textContent = tr ? 'Da conto' : 'Conto';
  if (!tr) {
    const lc = state.prefs.lastCat[t];
    $('f-cat').innerHTML = categoryOptionsHTML(t, state.catById.has(lc) ? lc : null);
  } else if ($('f-to').value === $('f-acc').value) {
    const other = state.accounts.find((a) => a.id !== $('f-acc').value); if (other) $('f-to').value = other.id;
  }
}
async function saveTxForm() {
  const type = state.txType, cents = parseAmount($('f-amount').value);
  const accId = $('f-acc').value, date = $('f-date').value || todayISO(), desc = $('f-desc').value.trim();
  if (!(cents > 0)) { formErr('Inserisci un importo maggiore di zero'); return; }
  if (!accId) { formErr('Scegli il conto'); return; }
  if (!DATE_RE.test(date)) { formErr('Data non valida'); return; }
  const amount = cents / 100, now = nowISO(), ed = state.editing;
  const recs = [];
  if (type === 'transfer') {
    const toId = $('f-to').value;
    if (!toId || toId === accId) { formErr('Scegli due conti diversi'); return; }
    const legs = ed && ed.transferId ? (state.legs.get(ed.transferId) || []) : [];
    const tid = ed && ed.transferId ? ed.transferId : generateUUID();
    const mk = (leg, t, acc) => touch({
      ...(leg || { id: generateUUID(), createdAt: now, hidden: false, deleted: false, deleted_at: null }),
      type: t, accountId: acc, categoryId: null, amount, description: desc, date, transferId: tid
    }, now);
    recs.push(mk(legs.find((l) => l.type === 'expense'), 'expense', accId), mk(legs.find((l) => l.type === 'income'), 'income', toId));
  } else {
    const catId = $('f-cat').value || null;
    const base = ed ? { ...ed } : { id: generateUUID(), createdAt: now, deleted: false, deleted_at: null };
    recs.push(touch({ ...base, type, accountId: accId, categoryId: catId, amount, description: desc, date, hidden: $('f-hidden').checked }, now));
    settingSet('last_cat_' + type, catId); state.prefs.lastCat[type] = catId;
  }
  settingSet('last_account', accId); state.prefs.lastAccount = accId;
  await dbPutMany('transactions', recs);
  closeModal();
  await afterMutation();
  toast('Salvato ✓');
}
function editTx(id) { const t = state.transactions.find((x) => x.id === id); if (t) openTxModal(t); }

/* --- azioni sul movimento --- */
function openSheet(id) {
  const t = state.transactions.find((x) => x.id === id); if (!t) return;
  const tr = !!t.transferId;
  const btn = (icon, label, js, cls = '') => `<button onclick="${js}" class="w-full text-left p-3.5 rounded-lg bg-gray-700 hover:bg-gray-600 mb-2 font-medium ${cls}">${icon} ${label}</button>`;
  showModal(`<div class="mb-3"><div class="font-bold truncate">${esc(t.description || (tr ? 'Giroconto' : catName(t.categoryId)))}</div><div class="text-sm text-gray-400">${esc(t.date)} • ${fmt(toCents(t.amount))}</div></div>
    ${btn('✏️', 'Modifica', `closeModal();editTx('${id}')`)}
    ${tr ? '' : btn('📋', 'Duplica su altri mesi', `openDuplicate('${id}')`)}
    ${tr ? '' : btn('👁️', t.hidden ? 'Mostra nelle analisi' : 'Nascondi dalle analisi', `toggleHidden('${id}')`)}
    ${btn('🗑️', 'Elimina', `deleteTx('${id}')`, 'text-red-400')}
    <button onclick="closeModal()" class="w-full p-3 text-gray-400">Chiudi</button>`);
}
async function toggleHidden(id) {
  const t = await dbGet('transactions', id); if (!t) return;
  closeModal();
  await dbPut('transactions', touch({ ...t, hidden: !t.hidden }));
  await afterMutation();
  toast(t.hidden ? 'Di nuovo nelle analisi' : 'Nascosto dalle analisi');
}
async function deleteTx(id) {
  const tx = state.transactions.find((t) => t.id === id); if (!tx) return;
  closeModal();
  const ids = tx.transferId ? (state.legs.get(tx.transferId) || [tx]).map((l) => l.id) : [id];
  const prev = await softDelete('transactions', ids);
  await afterMutation();
  showSnack(tx.transferId ? 'Giroconto eliminato' : 'Movimento eliminato', () => restoreRecords('transactions', prev));
}
function monthOptions(back, fwd) {
  const cur = currentMonthKey(), out = [];
  for (let i = -back; i <= fwd; i++) { const k = addMonthsKey(cur, i); const [y, m] = k.split('-').map(Number); out.push({ value: k, label: MONTHS[m - 1] + ' ' + y }); }
  return out;
}
function dupBodyHTML() {
  const d = state.dup, cur = currentMonthKey();
  const nSel = d.sel.size;
  const months = MONTHS.map((m, i) => {
    const ym = d.year + '-' + pad2(i + 1), on = d.sel.has(ym);
    return `<button type="button" onclick="dupToggle('${ym}')" aria-pressed="${on}" class="rounded-lg py-3 text-sm font-bold ${on ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'} ${ym === cur ? 'ring-1 ring-blue-400' : ''}">${m}</button>`;
  }).join('');
  const inYear = [...d.sel].filter((k) => k.startsWith(d.year + '-')).length;
  const summary = [...d.sel].sort().map((k) => MONTHS[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4)).join(', ');
  return `<div class="flex items-center justify-between mb-2">
      <div class="flex items-center bg-gray-700 rounded-lg"><button type="button" onclick="dupYear(-1)" class="px-4 py-2" aria-label="Anno precedente">◀</button><span class="px-2 font-bold w-14 text-center" id="dup-year">${d.year}</span><button type="button" onclick="dupYear(1)" class="px-4 py-2" aria-label="Anno successivo">▶</button></div>
      <div class="flex gap-3 text-xs"><button type="button" onclick="dupAllYear()" class="text-blue-400">Tutto l'anno</button><button type="button" onclick="dupNoneYear()" class="${inYear ? 'text-blue-400' : 'text-gray-500'}">Nessuno</button></div></div>
    <div class="grid grid-cols-3 gap-2 mb-3">${months}</div>
    <div class="text-sm text-gray-400 mb-3"><span id="dup-count" class="font-bold text-gray-200">${nSel}</span> ${nSel === 1 ? 'mese selezionato' : 'mesi selezionati'}${nSel ? `<div class="text-xs mt-1 break-words" id="dup-summary">${esc(summary)}</div>` : ''}</div>`;
}
function dupRefresh() { const b = $('dup-body'); if (b) b.innerHTML = dupBodyHTML(); }
function dupToggle(ym) { const s = state.dup.sel; if (s.has(ym)) s.delete(ym); else s.add(ym); dupRefresh(); }
function dupYear(dy) { state.dup.year = Math.min(2100, Math.max(1990, state.dup.year + dy)); dupRefresh(); }
function dupAllYear() { for (let i = 1; i <= 12; i++) state.dup.sel.add(state.dup.year + '-' + pad2(i)); dupRefresh(); }
function dupNoneYear() { for (let i = 1; i <= 12; i++) state.dup.sel.delete(state.dup.year + '-' + pad2(i)); dupRefresh(); }
function openDuplicate(id) {
  const t = state.transactions.find((x) => x.id === id); if (!t) return;
  state.modal = 'duplicate'; state.editing = t;
  state.dup = { year: +t.date.slice(0, 4), sel: new Set() };
  showModal(`${modalHead('Duplica movimento')}<p class="text-sm text-gray-400 mb-3">Copia «${esc(t.description || catName(t.categoryId))}» (${fmt(toCents(t.amount))}) su altri mesi.</p>
    <label class="block text-xs text-gray-400 mb-1">Giorno del mese</label>
    <div class="flex items-center gap-3 mb-1"><input id="dup-day" type="number" inputmode="numeric" min="1" max="31" value="${+t.date.slice(8, 10)}" class="${inputCls} !w-24 text-center font-bold"><span class="text-xs text-gray-500">se il mese è più corto uso l'ultimo giorno</span></div>
    <div class="text-xs text-gray-400 mt-4 mb-1">Anno e mesi</div>
    <div id="dup-body">${dupBodyHTML()}</div>
    <div id="form-err" class="hidden text-sm text-red-400 mb-3"></div>
    <div class="grid grid-cols-2 gap-2"><button onclick="closeModal()" class="bg-gray-700 rounded-lg p-3">Annulla</button><button onclick="duplicateTransaction()" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold">Duplica</button></div>`);
}
async function duplicateTransaction() {
  const months = [...state.dup.sel].sort();
  if (!months.length) { formErr('Seleziona almeno un mese'); return; }
  const day = parseInt($('dup-day').value, 10);
  if (!(day >= 1 && day <= 31)) { formErr('Giorno non valido (1-31)'); return; }
  const tx = state.editing, now = nowISO();
  const recs = months.map((ym) => {
    const d = pad2(Math.min(day, daysInMonth(ym)));
    const { transferId, recurringId, ...rest } = tx;
    return { ...rest, id: generateUUID(), date: ym + '-' + d, createdAt: now, updatedAt: now, updated_at: now, deleted: false, deleted_at: null };
  });
  await dbPutMany('transactions', recs);
  closeModal(); await afterMutation(); toast(recs.length + (recs.length === 1 ? ' movimento creato' : ' movimenti creati'));
}

/* --- conti --- */
function openAccountModal(id = null) {
  const a = id ? state.accById.get(id) : null;
  state.modal = 'account'; state.editing = a;
  showModal(`<form onsubmit="saveAccount();return false" autocomplete="off">${modalHead(a ? 'Modifica conto' : 'Nuovo conto')}
    <label class="text-xs text-gray-400">Nome</label><input id="a-name" value="${esc(a ? a.name : '')}" class="${inputCls} mb-3">
    <label class="text-xs text-gray-400">Saldo iniziale (prima del primo movimento registrato)</label>
    <input id="a-bal" type="text" inputmode="decimal" value="${a ? amountToInput(toCents(a.initialBalance)) : '0,00'}" class="${inputCls} mb-3">
    <div id="form-err" class="hidden text-sm text-red-400 mb-3"></div>
    <div class="grid grid-cols-2 gap-2"><button type="button" onclick="closeModal()" class="bg-gray-700 rounded-lg p-3">Annulla</button><button type="submit" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold">Salva</button></div></form>`, { dismissible: false });
}
async function saveAccount() {
  const name = $('a-name').value.trim(), bal = parseAmount($('a-bal').value || '0');
  if (!name) { formErr('Inserisci un nome'); return; }
  if (Number.isNaN(bal)) { formErr('Saldo non valido'); return; }
  const now = nowISO(), ed = state.editing;
  const rec = ed ? touch({ ...ed, name, initialBalance: bal / 100 }, now) : touch({ id: generateUUID(), name, initialBalance: bal / 100, createdAt: now, deleted: false, deleted_at: null }, now);
  await dbPut('accounts', rec); closeModal(); await afterMutation(); toast('Salvato ✓');
}
async function deleteAccount(id) {
  const n = state.transactions.filter((t) => t.accountId === id).length;
  if (n && !confirm('Il conto ha ' + n + ' movimenti: resteranno nello storico ma senza conto associato. Eliminare?')) return;
  const prev = await softDelete('accounts', [id]); await afterMutation();
  showSnack('Conto eliminato', () => restoreRecords('accounts', prev));
}

/* --- categorie --- */
function openCategoryModal(id = null) {
  const c = id ? state.catById.get(id) : null;
  state.modal = 'category'; state.editing = c;
  showModal(`<form onsubmit="saveCategory();return false" autocomplete="off">${modalHead(c ? 'Modifica categoria' : 'Nuova categoria')}
    <label class="text-xs text-gray-400">Nome</label><input id="c-name" value="${esc(c ? c.name : '')}" class="${inputCls} mb-3">
    <label class="text-xs text-gray-400">Macrocategoria</label>
    <select id="c-macro" class="${inputCls} mb-3">${MACROS.map((m) => `<option ${(c ? c.macroCategory : 'Spese variabili') === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <label class="text-xs text-gray-400">Colore</label><input id="c-color" type="color" value="${esc(c ? c.color : nextCategoryColor())}" class="w-full bg-gray-700 rounded-lg h-12 mb-3">
    <div id="form-err" class="hidden text-sm text-red-400 mb-3"></div>
    <div class="grid grid-cols-2 gap-2"><button type="button" onclick="closeModal()" class="bg-gray-700 rounded-lg p-3">Annulla</button><button type="submit" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold">Salva</button></div></form>`, { dismissible: false });
}
async function saveCategory() {
  const name = $('c-name').value.trim();
  if (!name) { formErr('Inserisci un nome'); return; }
  const now = nowISO(), ed = state.editing, f = { name, color: $('c-color').value, macroCategory: $('c-macro').value };
  const rec = ed ? touch({ ...ed, ...f }, now) : touch({ id: generateUUID(), ...f, createdAt: now, deleted: false, deleted_at: null }, now);
  await dbPut('categories', rec); closeModal(); await afterMutation(); toast('Salvato ✓');
}
async function deleteCategory(id) {
  const n = state.transactions.filter((t) => t.categoryId === id).length;
  if (n && !confirm('La categoria ha ' + n + ' movimenti: resteranno nello storico. Eliminare?')) return;
  const prev = await softDelete('categories', [id]); await afterMutation();
  showSnack('Categoria eliminata', () => restoreRecords('categories', prev));
}

/* --- ricorrenze --- */
function openRecurringModal(id = null) {
  if (!state.accounts.length) { toast('Crea prima un conto'); return; }
  const r = id ? state.recurring.find((x) => x.id === id) : null;
  state.modal = 'recurring'; state.editing = r;
  const type = r ? r.type : 'expense', cur = currentMonthKey();
  const startOpts = monthOptions(24, 12), endOpts = monthOptions(0, 60);
  showModal(`<form onsubmit="saveRecurring();return false" autocomplete="off">${modalHead(r ? 'Modifica ricorrenza' : 'Nuova ricorrenza')}
    <label class="text-xs text-gray-400">Descrizione</label><input id="r-desc" value="${esc(r ? r.description : '')}" placeholder="es. Affitto, Netflix, Stipendio" class="${inputCls} mb-3">
    <div class="grid grid-cols-2 gap-2 mb-3"><div><label class="text-xs text-gray-400">Tipo</label>
      <select id="r-type" onchange="$('r-cat').innerHTML=categoryOptionsHTML(this.value,null)" class="${inputCls}"><option value="expense" ${type === 'expense' ? 'selected' : ''}>Uscita</option><option value="income" ${type === 'income' ? 'selected' : ''}>Entrata</option></select></div>
      <div><label class="text-xs text-gray-400">Importo €</label><input id="r-amount" type="text" inputmode="decimal" value="${r ? amountToInput(toCents(r.amount)) : ''}" placeholder="0,00" class="${inputCls}"></div></div>
    <label class="text-xs text-gray-400">Conto</label><select id="r-acc" class="${inputCls} mb-3">${accountOptionsHTML(r ? r.accountId : (state.accById.has(state.prefs.lastAccount) ? state.prefs.lastAccount : state.accounts[0].id))}</select>
    <label class="text-xs text-gray-400">Categoria</label><select id="r-cat" class="${inputCls} mb-3">${categoryOptionsHTML(type, r ? r.categoryId : null)}</select>
    <div class="grid grid-cols-3 gap-2 mb-3"><div><label class="text-xs text-gray-400">Giorno</label><input id="r-day" type="number" min="1" max="31" value="${r ? r.dayOfMonth : new Date().getDate()}" class="${inputCls}"></div>
      <div><label class="text-xs text-gray-400">Da</label><select id="r-start" class="${inputCls}">${startOpts.map((m) => `<option value="${m.value}" ${m.value === (r ? r.startMonth : cur) ? 'selected' : ''}>${m.label}</option>`).join('')}${r && !startOpts.some((m) => m.value === r.startMonth) ? `<option value="${esc(r.startMonth)}" selected>${esc(r.startMonth)}</option>` : ''}</select></div>
      <div><label class="text-xs text-gray-400">Fino a</label><select id="r-end" class="${inputCls}"><option value="">Nessuna fine</option>${endOpts.map((m) => `<option value="${m.value}" ${r && r.endMonth === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div></div>
    <p class="text-[11px] text-gray-500 mb-3">Se il giorno non esiste in un mese (es. 31 a febbraio) si usa l'ultimo giorno del mese.</p>
    <div id="form-err" class="hidden text-sm text-red-400 mb-3"></div>
    <div class="grid grid-cols-2 gap-2"><button type="button" onclick="closeModal()" class="bg-gray-700 rounded-lg p-3">Annulla</button><button type="submit" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold">Salva</button></div></form>`, { dismissible: false, top: true });
}
async function saveRecurring() {
  const cents = parseAmount($('r-amount').value), day = parseInt($('r-day').value, 10);
  const start = $('r-start').value, end = $('r-end').value || null;
  if (!(cents > 0)) { formErr('Inserisci un importo maggiore di zero'); return; }
  if (!(day >= 1 && day <= 31)) { formErr('Giorno non valido (1-31)'); return; }
  if (end && end < start) { formErr('La fine non può precedere l\'inizio'); return; }
  const now = nowISO(), ed = state.editing;
  const f = { description: $('r-desc').value.trim(), type: $('r-type').value, amount: cents / 100, accountId: $('r-acc').value, categoryId: $('r-cat').value || null, dayOfMonth: day, startMonth: start, endMonth: end };
  const rec = ed ? touch({ ...ed, ...f }, now) : touch({ id: generateUUID(), ...f, active: true, createdAt: now, deleted: false, deleted_at: null }, now);
  if (!ed) {
    const n = countPendingRecurring(rec);
    if (n > 1 && !confirm('Questa regola creerà subito ' + n + ' movimenti (uno per ogni mese da ' + start + ' a oggi). Continuare?')) return;
  }
  await dbPut('recurring', rec); closeModal();
  markDirty(); await loadData();
  const n = await generateRecurring();
  if (!n) { scheduleSync(); toast('Salvato ✓'); }
}
async function toggleRule(id) {
  const r = state.recurring.find((x) => x.id === id); if (!r) return;
  await dbPut('recurring', touch({ ...r, active: r.active === false }));
  markDirty(); await loadData();
  if (r.active === false) await generateRecurring(); else scheduleSync();
}
async function deleteRule(id) {
  if (!confirm('Eliminare la regola? I movimenti già generati restano.')) return;
  const prev = await softDelete('recurring', [id]); await afterMutation();
  showSnack('Regola eliminata', () => restoreRecords('recurring', prev));
}

/* --- login --- */
function openLoginModal() {
  if (!state.supabaseClient) { toast('Cloud non disponibile'); return; }
  state.modal = 'login';
  showModal(`<form onsubmit="signIn();return false">${modalHead('Accedi al cloud')}
    <p class="text-sm text-gray-400 mb-4">Serve solo per sincronizzare i dati tra dispositivi. Senza accesso l'app funziona comunque, con i dati salvati su questo telefono.</p>
    <input id="login-email" type="email" autocomplete="username" placeholder="Email" class="${inputCls} mb-3">
    <input id="login-pass" type="password" autocomplete="current-password" placeholder="Password" class="${inputCls} mb-3">
    <div id="login-err" class="text-sm text-red-400 mb-3 min-h-[1.25rem]"></div>
    <div class="grid grid-cols-2 gap-2"><button type="button" onclick="closeModal()" class="bg-gray-700 rounded-lg p-3">Più tardi</button><button id="login-btn" type="submit" class="bg-blue-600 hover:bg-blue-700 rounded-lg p-3 font-bold">Accedi</button></div></form>`, { dismissible: false });
}

/* ---------- backup / export ---------- */
function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function exportBackup() {
  const data = {};
  for (const s of ['accounts', 'categories', 'transactions', 'recurring']) data[s] = await dbGetAll(s);
  const payload = { app: 'moneymanager', schema: 1, appVersion: APP_VERSION, exportedAt: nowISO(), data };
  downloadFile('moneymanager-backup-' + todayISO() + '.json', JSON.stringify(payload), 'application/json');
  state.lastBackup = nowISO(); await settingSet('last_backup', state.lastBackup);
  toast('Backup scaricato (' + data.transactions.length + ' movimenti)'); renderMain();
}
const cleanMeta = (r) => { const u = r.updated_at || r.updatedAt || r.createdAt || nowISO(); return { createdAt: r.createdAt || u, updated_at: u, deleted: !!r.deleted, deleted_at: r.deleted_at || null }; };
const uuidOrNull = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
const CLEANERS = {
  accounts: (r) => (UUID_RE.test(r.id) && typeof r.name === 'string' ? { id: r.id, name: r.name.slice(0, 100), initialBalance: Number(r.initialBalance) || 0, ...cleanMeta(r) } : null),
  categories: (r) => (UUID_RE.test(r.id) && typeof r.name === 'string' ? { id: r.id, name: r.name.slice(0, 100), color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#3b82f6', macroCategory: String(r.macroCategory || 'Spese variabili').slice(0, 50), ...cleanMeta(r) } : null),
  transactions: (r) => {
    if (!UUID_RE.test(r.id) || !DATE_RE.test(r.date) || !['income', 'expense'].includes(r.type) || !Number.isFinite(Number(r.amount))) return null;
    const m = cleanMeta(r);
    const o = { id: r.id, accountId: uuidOrNull(r.accountId), categoryId: uuidOrNull(r.categoryId), type: r.type, amount: Number(r.amount), description: String(r.description || '').slice(0, 300), date: r.date, hidden: !!r.hidden, ...m, updatedAt: m.updated_at };
    if (uuidOrNull(r.transferId)) o.transferId = r.transferId;
    if (uuidOrNull(r.recurringId)) o.recurringId = r.recurringId;
    return o;
  },
  recurring: (r) => (UUID_RE.test(r.id) && ['income', 'expense'].includes(r.type) && /^\d{4}-\d{2}$/.test(r.startMonth || '') && Number.isFinite(Number(r.amount))
    ? { id: r.id, description: String(r.description || '').slice(0, 300), accountId: uuidOrNull(r.accountId), categoryId: uuidOrNull(r.categoryId), type: r.type, amount: Number(r.amount), dayOfMonth: Math.min(31, Math.max(1, parseInt(r.dayOfMonth, 10) || 1)), startMonth: r.startMonth, endMonth: /^\d{4}-\d{2}$/.test(r.endMonth || '') ? r.endMonth : null, active: r.active !== false, ...cleanMeta(r) } : null)
};
async function importBackup(file) {
  if (!file) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch (e) { alert('File non valido: non è un JSON.'); return; }
  if (!parsed || parsed.app !== 'moneymanager' || !parsed.data) { alert('File non valido: non è un backup di MoneyManager.'); return; }
  const clean = {}, bad = {};
  for (const s of Object.keys(CLEANERS)) {
    const arr = Array.isArray(parsed.data[s]) ? parsed.data[s] : [];
    clean[s] = arr.map(CLEANERS[s]).filter(Boolean); bad[s] = arr.length - clean[s].length;
  }
  const msg = `Backup del ${parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('it-IT') : '?'}:\n` +
    `• ${clean.accounts.length} conti\n• ${clean.categories.length} categorie\n• ${clean.transactions.length} movimenti\n• ${clean.recurring.length} ricorrenze\n` +
    (Object.values(bad).some(Boolean) ? `(${Object.values(bad).reduce((a, b) => a + b, 0)} record scartati perché non validi)\n` : '') +
    `\nVerranno uniti ai dati attuali: per ogni record vince il più recente, nulla viene cancellato. Procedere?`;
  if (!confirm(msg)) return;
  let changed = 0;
  for (const s of Object.keys(clean)) {
    const local = new Map((await dbGetAll(s)).map((r) => [r.id, r]));
    const toPut = clean[s].filter((r) => { const l = local.get(r.id); return !l || tms(recTs(r)) > tms(recTs(l)); });
    await dbPutMany(s, toPut); changed += toPut.length;
  }
  await afterMutation();
  toast(changed + ' record importati/aggiornati');
}
function exportCSV() {
  const list = buildItems(scopeTx());
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = list.map((it) => {
    const t = it.tx;
    if (t.transferId) return [t.date, t.description || 'Giroconto', (it.out ? accName(it.out.accountId) : '') + ' → ' + (it.in ? accName(it.in.accountId) : ''), '', 'Giroconto', amountToInput(toCents(t.amount))];
    return [t.date, t.description || '', accName(t.accountId), t.categoryId ? catName(t.categoryId) : '', t.type === 'income' ? 'Entrata' : 'Uscita', amountToInput(toCents(t.amount))];
  });
  const csv = '﻿' + [['Data', 'Descrizione', 'Conto', 'Categoria', 'Tipo', 'Importo']].concat(rows).map((r) => r.map(q).join(';')).join('\r\n');
  downloadFile('moneymanager_' + state.filterYear + (state.filterMonth !== null ? '-' + pad2(state.filterMonth + 1) : '') + '.csv', csv, 'text/csv;charset=utf-8');
  toast(rows.length + ' righe esportate');
}

/* ---------- avvio ---------- */
window.addEventListener('online', async () => {
  state.online = true; renderHeader();
  if (state.supabaseClient) { try { const { data } = await state.supabaseClient.auth.getSession(); state.session = data.session || state.session; } catch (e) { /* ignora */ } scheduleSync(300); }
});
window.addEventListener('offline', () => { state.online = false; renderHeader(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && canSync() && !state.syncing && (!state.lastSync || Date.now() - state.lastSync.getTime() > 120000)) scheduleSync(500);
});

async function boot() {
  try { await initDB(); }
  catch (e) { $('main').innerHTML = '<p class="p-6 text-red-400">Impossibile aprire il database locale (modalità privata?). Riapri l\'app in una scheda normale.</p>'; return; }
  await loadPrefs();
  histInit();
  await loadData();
  await initCloud();
  await autoColorsOnce();
}
if (typeof document !== 'undefined' && document.getElementById('main')) boot();
