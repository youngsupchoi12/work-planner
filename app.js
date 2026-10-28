/* =========================================================
   마이 워크플래너 - app.js
   섹션 구성
     1. 저장소              10. 휴가 화면 (+ 연휴 추천)
     2. 날짜 도우미          11. 리포트 화면
     3. 휴가 계산            12. 검색 화면
     4. 일정·행사 조회       13. 일정 팝업
     5. 공통 UI              14. 행사 팝업
     6. 홈 화면              15. 설정 · 화면 모드 · 백업
     7. 캘린더 (월간/주간)    16. 자동 저장 (PC 파일)
     8. 드래그로 옮기기       17. 이벤트 연결 & 시작
     9. 행사 화면
   새 기능은 관련 섹션에 함수를 추가하고 renderAll()에서 호출하면 됩니다.
   ========================================================= */

/* ===== 1. 저장소 ===== */
const STORAGE_KEY = 'workPlanner.v1';
const DEFAULT_SETTINGS = { name: '', joinDate: '', annualAdjust: 0, projectAdjust: 0, monthEndDays: 7, theme: 'system' };
/* 일정(event)
   { id, title, category: 'company'|'personal', date, endDate, time, endTime,
     leaveType, earn(주말근무 적립 0|0.5|1), projectId, repeat, repeatUntil, skip[],
     important, memo, createdAt }
   행사(project)
   { id, name, client, venue, color, setupStart, setupEnd, mainStart, mainEnd,
     teardownStart, teardownEnd, memo, todos: [{ id, text, done }] } */

const clone = (o) => JSON.parse(JSON.stringify(o));
function normalizeState(s = {}) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    events: Array.isArray(s.events) ? s.events : [],
    projects: Array.isArray(s.projects) ? s.projects : [],
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : {});
  } catch (e) {
    console.warn('데이터를 읽지 못했어요', e);
    return normalizeState();
  }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function saveState() {
  persist();
  scheduleFileSave();
  window.CloudSync?.schedule?.(); // PC·휴대폰 동기화 (cloud.js)
  renderAll();
}

let state = loadState();
const ui = {
  homeMonth: null,      // { y, m }
  calMonth: null,       // { y, m }
  calMode: 'month',     // 'month' | 'week'
  weekStart: null,      // 'YYYY-MM-DD' (일요일)
  projFilter: 'active',
  reportYear: null,
  search: '',
  currentView: 'home',
};

/* ===== 2. 날짜 도우미 ===== */
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => toKey(new Date());
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
function addMonths(k, n) {
  const d = fromKey(k);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toKey(d);
}
const diffDays = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000); // b - a
const isWeekend = (k) => { const w = fromKey(k).getDay(); return w === 0 || w === 6; };
const holidayName = (k) => (typeof HOLIDAYS !== 'undefined' && HOLIDAYS[k]) || '';
const isWorkday = (k) => !isWeekend(k) && !holidayName(k);
const weekStartOf = (k) => addDays(k, -fromKey(k).getDay());
function eachDay(start, end) {
  const out = [];
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDate = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; };
const fmtFull = (k) => { const d = fromKey(k); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const dday = (k) => { const n = diffDays(todayKey(), k); return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`; };
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/* ===== 3. 휴가 계산 ===== */
const LEAVE_TYPES = {
  none:         { label: '사용 안 함',    kind: null,      half: false },
  annual:       { label: '연차',          kind: 'annual',  half: false },
  half_am:      { label: '오전 반차',     kind: 'annual',  half: true },
  half_pm:      { label: '오후 반차',     kind: 'annual',  half: true },
  project:      { label: '프로젝트 휴가', kind: 'project', half: false },
  project_half: { label: '프로젝트 반차', kind: 'project', half: true },
};
const leaveKind = (ev) => (LEAVE_TYPES[ev.leaveType] || LEAVE_TYPES.none).kind;

/** 이 일정이 차감하는 휴가 일수 (주말·공휴일 제외) */
function leaveDays(ev) {
  const t = LEAVE_TYPES[ev.leaveType];
  if (!t || !t.kind) return 0;
  if (t.half) return isWorkday(ev.date) ? 0.5 : 0;
  return eachDay(ev.date, ev.endDate || ev.date).filter(isWorkday).length;
}

/** 연차 정보 (입사일 기준, 근로기준법 제60조) */
function annualInfo(ref = todayKey()) {
  const join = state.settings.joinDate;
  if (!join) return null;

  let years = 0;
  while (addMonths(join, 12 * (years + 1)) <= ref) years++;

  let periodStart, periodEnd, base, rule;
  if (years === 0) {
    periodStart = join;
    periodEnd = addDays(addMonths(join, 12), -1);
    let months = 0;
    while (months < 11 && addMonths(join, months + 1) <= ref) months++;
    base = months;
    rule = `입사 1년 미만 → 1개월 개근마다 1일 발생 (현재 ${months}개월 경과 = ${months}일, 최대 11일)`;
  } else {
    periodStart = addMonths(join, 12 * years);
    periodEnd = addDays(addMonths(join, 12 * (years + 1)), -1);
    base = Math.min(25, 15 + Math.floor((years - 1) / 2));
    rule = `근속 ${years}년 → 기본 15일${base > 15 ? ` + 가산 ${base - 15}일` : ''} (2년마다 1일 가산, 최대 25일)`;
  }
  const adjust = Number(state.settings.annualAdjust) || 0;
  const granted = base + adjust;

  const today = todayKey();
  const inPeriod = state.events.filter((e) => leaveKind(e) === 'annual' && e.date >= periodStart && e.date <= periodEnd);
  const usedDone = inPeriod.filter((e) => e.date <= today).reduce((s, e) => s + leaveDays(e), 0);
  const planned = inPeriod.filter((e) => e.date > today).reduce((s, e) => s + leaveDays(e), 0);
  const used = usedDone + planned;
  const nextAnniversary = addMonths(join, 12 * (years + 1));
  return { years, periodStart, periodEnd, base, adjust, granted, usedDone, planned, used, remaining: granted - used, rule, nextAnniversary };
}

/** 프로젝트 휴가 사용기한: 근무한 달 말일. 단, 말일로부터 N일 이내(월말 주말)면 다음 달 말일 */
function projectExpiry(dateKey) {
  const n = Math.max(0, Number(state.settings.monthEndDays) || 0);
  const d = fromKey(dateKey);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  if (last.getDate() - d.getDate() < n) return toKey(new Date(d.getFullYear(), d.getMonth() + 2, 0));
  return toKey(last);
}

/** 적립 출처: 일정의 '주말근무 적립' + 행사에 체크한 주말근무일 */
function earnSources(events = state.events) {
  const fromEvents = events.filter((e) => Number(e.earn) > 0).map((e) => ({ ev: e, amount: Number(e.earn) }));
  const fromProjects = state.projects.flatMap((p) => (p.earns || [])
    .filter((x) => Number(x.amount) > 0)
    .map((x) => ({ ev: { id: `${p.id}@${x.date}`, _pid: p.id, title: isWeekend(x.date) ? '주말근무' : holidayName(x.date) ? '공휴일 근무' : '휴일 근무', date: x.date, projectId: p.id }, amount: Number(x.amount) })));
  return [...fromEvents, ...fromProjects];
}

/** 프로젝트 휴가 장부: 적립분마다 기한을 두고, 사용 시 만료가 빠른 적립분부터 차감 */
function projectLedger(events = state.events, ref = todayKey()) {
  const earns = earnSources(events)
    .map(({ ev, amount }) => ({ ev, amount, left: amount, expiry: projectExpiry(ev.date) }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.ev.date.localeCompare(b.ev.date));
  const uses = events
    .filter((e) => leaveKind(e) === 'project')
    .map((e) => ({ ev: e, amount: leaveDays(e), left: leaveDays(e) }))
    .sort((a, b) => a.ev.date.localeCompare(b.ev.date));

  const adj = Number(state.settings.projectAdjust) || 0;
  let adjustPool = Math.max(0, adj); // 보정값(+)은 기한 없는 적립분으로 취급

  for (const u of uses) {
    for (const er of earns) {
      if (u.left <= 0) break;
      if (er.left <= 0 || er.expiry < u.ev.date) continue;
      const take = Math.min(er.left, u.left);
      er.left -= take;
      u.left -= take;
    }
    if (u.left > 0 && adjustPool > 0) {
      const take = Math.min(adjustPool, u.left);
      adjustPool -= take;
      u.left -= take;
    }
  }
  const active = earns.filter((e) => e.expiry >= ref);
  const expired = earns.filter((e) => e.expiry < ref);
  const available = active.reduce((s, e) => s + e.left, 0) + adjustPool + Math.min(0, adj);
  const shortage = uses.reduce((s, u) => s + u.left, 0);
  return {
    earns, uses,
    earned: earns.reduce((s, e) => s + e.amount, 0) + adj,
    used: uses.reduce((s, u) => s + u.amount, 0),
    expiredLeft: expired.reduce((s, e) => s + e.left, 0),
    shortage,
    remaining: available - shortage,
    soon: active.filter((e) => e.left > 0).sort((a, b) => a.expiry.localeCompare(b.expiry))[0] || null,
    adjust: adj,
  };
}

/* ===== 4. 일정·행사 조회 ===== */
const REPEAT_LABEL = { none: '', daily: '매일', weekdays: '평일마다', weekly: '매주', monthly: '매월' };

/** 일정이 특정 날짜에 있는지 (반복 포함) */
function occursOn(e, k) {
  const rep = e.repeat || 'none';
  if (rep === 'none') return e.date <= k && k <= (e.endDate || e.date);
  if (k < e.date || (e.repeatUntil && k > e.repeatUntil)) return false;
  if (e.skip && e.skip.includes(k)) return false;
  const d = fromKey(k), b = fromKey(e.date);
  if (rep === 'daily') return true;
  if (rep === 'weekdays') return d.getDay() >= 1 && d.getDay() <= 5;
  if (rep === 'weekly') return d.getDay() === b.getDay();
  if (rep === 'monthly') return d.getDate() === b.getDate();
  return false;
}
function eventsOn(k) {
  return state.events
    .filter((e) => occursOn(e, k))
    .sort((a, b) => (b.important - a.important) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title));
}

const PHASES = [['setup', '셋업', '🔧'], ['main', '본행사', '🎤'], ['teardown', '철수', '📦']];
const PROJECT_COLORS = ['#d6457a', '#e8812a', '#c9a227', '#1f9d6b', '#1d9bb5', '#4f6bed', '#8a4fe0', '#6b7280'];
const projectById = (id) => state.projects.find((p) => p.id === id);
/** 행사 색: 직접 고른 색이 없으면 설정의 '행사' 기본색 */
const projColor = (p) => p.color || 'var(--phase)';

function phaseRange(p, ph) {
  const s = p[ph + 'Start'];
  if (!s) return null;
  const e = p[ph + 'End'];
  return [s, e && e >= s ? e : s];
}
function projectSpan(p) {
  const rs = PHASES.map(([ph]) => phaseRange(p, ph)).filter(Boolean);
  if (!rs.length) return null;
  return [rs.map((r) => r[0]).sort()[0], rs.map((r) => r[1]).sort().pop()];
}
function projectStatus(p) {
  const span = projectSpan(p);
  const today = todayKey();
  if (!span) return 'none';
  if (span[1] < today) return 'done';
  if (span[0] > today) return 'upcoming';
  return 'ongoing';
}
function phasesOn(k) {
  const out = [];
  state.projects.forEach((p) => {
    PHASES.forEach(([ph, label, ico]) => {
      const r = phaseRange(p, ph);
      if (r && r[0] <= k && k <= r[1]) out.push({ p, ph, label, ico });
    });
  });
  return out;
}
const todoStats = (p) => { const t = p.todos || []; return { done: t.filter((x) => x.done).length, total: t.length }; };
const linkedEvents = (p) => state.events.filter((e) => e.projectId === p.id);

/* ===== 5. 공통 UI ===== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function colorClass(ev) {
  const k = leaveKind(ev);
  if (k === 'annual') return 'leave';
  if (k === 'project') return 'project';
  return ev.category;
}
function tagLabel(ev) {
  const k = leaveKind(ev);
  if (k) return LEAVE_TYPES[ev.leaveType].label;
  if (Number(ev.earn)) return `주말근무 +${ev.earn}`;
  return ev.category === 'company' ? '회사' : '개인';
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2000);
}
function switchView(view) {
  ui.currentView = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'settings') fillSettingsForm();
  if (view === 'search') { renderSearch(); setTimeout(() => $('#searchInput').focus(), 0); }
  if (view === 'calendar') renderCalendar();
  window.scrollTo(0, 0);
}
function kpiCard({ cls = '', label, value, unit = '', sub = '', badge = '', badgeCls = '' }) {
  return `<div class="kpi ${cls}">
    <div class="label">${label}</div>
    <div class="value">${value}${unit ? `<small> ${unit}</small>` : ''}</div>
    <div class="sub2">${sub}</div>
    ${badge ? `<span class="badge ${badgeCls}">${badge}</span>` : ''}
  </div>`;
}
/** 일정에 직접 지정한 색 (없으면 구분별 기본색) */
const EVENT_COLORS = ['#4f6bed', '#1d9bb5', '#1f9d6b', '#7cb342', '#c9a227', '#e8812a', '#e04f5f', '#d6457a', '#8a4fe0', '#6b7280'];
const evColor = (e) => (e.color ? { cls: 'custom', style: `--ec:${e.color};` } : { cls: '', style: '' });

/** 한 주(7일)에 걸친 일정·행사를 줄(lane)에 배치. 여러 날 일정은 하나의 막대로 */
function weekItems(startKey, { filter = () => true, showPhases = true, include = () => true } = {}) {
  const end = addDays(startKey, 6);
  let items = [];
  if (showPhases) {
    state.projects.forEach((p) => PHASES.forEach(([ph, label, ico]) => {
      const r = phaseRange(p, ph);
      if (r && r[0] <= end && r[1] >= startKey) items.push({ type: 'phase', p, label, ico, s: r[0], e: r[1] });
    }));
  }
  state.events.filter(filter).forEach((ev) => {
    if ((ev.repeat || 'none') !== 'none') {
      for (let i = 0; i < 7; i++) { const k = addDays(startKey, i); if (occursOn(ev, k)) items.push({ type: 'event', ev, s: k, e: k }); }
    } else {
      const s = ev.date, e = ev.endDate || ev.date;
      if (s <= end && e >= startKey) items.push({ type: 'event', ev, s, e });
    }
  });
  items = items.filter(include);
  items.forEach((it) => {
    it.cs = Math.max(0, diffDays(startKey, it.s));
    it.ce = Math.min(6, diffDays(startKey, it.e));
    it.len = diffDays(it.s, it.e);
    it.contL = it.s < startKey;
    it.contR = it.e > end;
  });
  // 여러 날 → 먼저 시작 → 긴 것 → 행사 → 중요 → 시간 순
  items.sort((a, b) => ((b.len > 0) - (a.len > 0)) || (a.cs - b.cs) || (b.len - a.len)
    || ((a.type === 'phase' ? 0 : 1) - (b.type === 'phase' ? 0 : 1))
    || ((b.ev?.important ? 1 : 0) - (a.ev?.important ? 1 : 0))
    || (a.ev?.time || '').localeCompare(b.ev?.time || ''));
  const lanes = [];
  items.forEach((it) => {
    for (let l = 0; ; l++) {
      lanes[l] = lanes[l] || Array(7).fill(false);
      let free = true;
      for (let c = it.cs; c <= it.ce; c++) if (lanes[l][c]) { free = false; break; }
      if (free) { for (let c = it.cs; c <= it.ce; c++) lanes[l][c] = true; it.lane = l; break; }
    }
  });
  return { items, laneCount: lanes.length };
}

/** 막대 하나 (colOffset: 주간 보기의 '종일' 칸만큼 밀기) */
function barHtml(it, weekStart, colOffset = 0) {
  const pos = `grid-column:${it.cs + 1 + colOffset}/${it.ce + 2 + colOffset};grid-row:${it.lane + 1};`;
  const cont = `${it.contL ? 'cl' : ''} ${it.contR ? 'cr' : ''}`;
  if (it.type === 'phase') {
    const { p, label, ico } = it;
    return `<span class="bar-item phase ${cont}" style="${pos}--pc:${projColor(p)}" data-pid="${p.id}" title="${esc(p.name)} · ${label}">${ico} ${esc(p.name)}</span>`;
  }
  const e = it.ev;
  const c = evColor(e);
  const p = e.projectId ? projectById(e.projectId) : null;
  const drag = (e.repeat || 'none') === 'none' ? 'draggable="true"' : '';
  const label = `${e.important ? '⭐' : ''}${(e.repeat || 'none') !== 'none' ? '🔁' : ''}${e.time && !leaveKind(e) && !it.len ? `${e.time} ` : ''}${esc(e.title || tagLabel(e))}`;
  return `<span class="bar-item ${colorClass(e)} ${c.cls} ${p && !e.color ? 'linked' : ''} ${cont}" style="${pos}${c.style}${p ? `--pc:${projColor(p)};` : ''}"
    data-id="${e.id}" data-date="${addDays(weekStart, it.cs)}" data-span="${it.ce - it.cs + 1}" ${drag} title="${esc(e.title)}">${label}</span>`;
}

function renderAll() {
  const name = state.settings.name.trim();
  $('#brandName').textContent = name ? `${name}의 워크플래너` : '마이 워크플래너';
  renderHome();
  renderCalendar();
  renderProjects();
  renderLeave();
  renderReport();
  if (ui.currentView === 'search') renderSearch();
  renderSyncStatus();
  renderCloudStatus();
  renderThemeToggle();
}

/* PC·휴대폰 동기화 상태 표시 (실제 동기화는 cloud.js) */
function renderCloudStatus() {
  // PC 파일(file:///)로 열면 브라우저가 cloud.js 를 막기 때문에 여기서 상태를 정함
  const C = window.CloudSync || {
    status: !window.FIREBASE_CONFIG ? 'unconfigured' : location.protocol === 'file:' ? 'needs-web' : 'loading',
    webUrl: window.PLANNER_WEB_URL || '',
  };
  const t = C.lastSynced ? `${pad(C.lastSynced.getHours())}:${pad(C.lastSynced.getMinutes())}` : '';
  const email = C.user ? esc(C.user.email || '') : '';
  const side = {
    unconfigured: '', loading: '☁️ 동기화 준비 중…', 'needs-web': '',
    'signed-out': '☁️ 로그인하고 동기화', syncing: '☁️ 동기화 중…',
    ok: `☁️ 동기화됨${t ? ` ${t}` : ''}`, offline: '☁️ 오프라인 · 연결되면 저장', error: '⚠️ 동기화 오류',
  }[C.status] ?? '';
  const btn = $('#cloudStatus');
  btn.textContent = side;
  btn.classList.toggle('hidden', !side);
  btn.classList.toggle('warn', C.status === 'error' || C.status === 'signed-out');

  const panel = {
    unconfigured: '<div class="muted">아직 Firebase 설정값이 없어요. <code>firebase-config.js</code>에 설정값을 넣으면 사용할 수 있어요.</div>',
    loading: '<div class="muted">불러오는 중…</div>',
    'needs-web': `<div class="muted">지금은 PC 파일(<code>file:///</code>)로 열려 있어서 로그인할 수 없어요.<br>온라인 주소${C.webUrl ? ` <a href="${esc(C.webUrl)}" target="_blank">${esc(C.webUrl)}</a>` : ''}로 열어서 로그인해 주세요.</div>`,
    'signed-out': '<div class="btn-row"><button class="btn primary" data-action="cloud-login">G 구글 계정으로 로그인</button></div>',
    syncing: `<p>⏳ <b>${email}</b> · 동기화 중…</p>`,
    ok: `<p>✅ <b>${email}</b>로 동기화 중${t ? ` · 마지막 동기화 ${t}` : ''}</p><div class="btn-row"><button class="btn" data-action="cloud-logout">로그아웃</button></div>`,
    offline: `<p>📴 <b>${email}</b> · 인터넷이 연결되면 자동으로 저장돼요.</p><div class="btn-row"><button class="btn" data-action="cloud-logout">로그아웃</button></div>`,
    error: `<p>⚠️ 동기화하지 못했어요${C.error ? `: <span class="muted">${esc(C.error)}</span>` : ''}</p><div class="btn-row"><button class="btn primary" data-action="cloud-login">다시 로그인</button><button class="btn" data-action="cloud-logout">로그아웃</button></div>`,
  }[C.status] || '';
  $('#cloudPanel').innerHTML = panel;
}

/** cloud.js 가 쓰는 연결 고리 */
window.WP = {
  getState: () => state,
  isEmpty: () => !state.events.length && !state.projects.length,
  normalize: (d) => normalizeState(d),
  /** 다른 기기에서 바뀐 데이터를 반영 (다시 업로드하지 않음) */
  replaceState(data) {
    state = normalizeState(data);
    persist();
    scheduleFileSave();
    applyTheme();
    fillSettingsForm();
    renderAll();
  },
  renderAll: () => renderAll(),
  toast: (m) => toast(m),
};

/* ===== 6. 홈 화면 ===== */
function buildAlerts() {
  const today = todayKey();
  const out = [];
  const a = annualInfo();
  if (!state.settings.joinDate) {
    out.push({ ico: '👋', text: '입사일을 설정하면 연차가 자동으로 계산돼요.', action: '<button class="btn small" data-goto="settings">설정하러 가기</button>' });
  }
  if (a) {
    const d = diffDays(today, a.periodEnd);
    if (a.remaining > 0 && d <= 60) {
      out.push({
        ico: '⚠️',
        text: `아직 계획하지 않은 연차 <b>${fmtNum(a.remaining)}일</b>이 있어요. <b>${fmtFull(a.periodEnd)}(D-${d})</b>까지 사용하지 않으면 소멸될 수 있어요.`,
        action: '<button class="btn small" data-action="goto-bridge">연휴 추천 보기</button>',
      });
    }
  }
  const L = projectLedger();
  const expiring = L.earns.filter((e) => e.left > 0 && e.expiry >= today && diffDays(today, e.expiry) <= 14);
  if (expiring.length) {
    const first = expiring[0].expiry;
    const sum = expiring.filter((e) => e.expiry === first).reduce((s, e) => s + e.left, 0);
    out.push({ ico: '⏰', text: `프로젝트 휴가 <b>${fmtNum(sum)}일</b>이 <b>${fmtFull(first)}(${dday(first)})</b>에 만료돼요.`, action: '<button class="btn small" data-goto="leave">확인하기</button>' });
  }
  if (L.shortage > 0) {
    out.push({ cls: 'danger', ico: '❗', text: `프로젝트 휴가 일정 중 <b>${fmtNum(L.shortage)}일</b>은 사용할 수 있는 적립분이 없어요. (기한이 지났거나 적립이 부족해요)`, action: '<button class="btn small" data-goto="leave">확인하기</button>' });
  }
  const cs = window.CloudSync?.status;
  if (cs === 'signed-out') {
    out.push({ ico: '☁️', text: '구글 계정으로 로그인하면 PC·휴대폰에서 같은 데이터를 볼 수 있어요.', action: '<button class="btn small" data-action="cloud-login">로그인</button>' });
  } else if (cs === 'error') {
    out.push({ cls: 'danger', ico: '☁️', text: '동기화하지 못했어요. 다시 로그인해 주세요.', action: '<button class="btn small" data-action="cloud-login">다시 로그인</button>' });
  }
  if (cs !== 'ok' && (FileSync.status === 'need-permission' || FileSync.status === 'error')) {
    out.push({ ico: '💾', text: '자동 저장이 멈춰 있어요. 브라우저를 다시 열면 파일 권한을 한 번 더 허용해야 해요.', action: '<button class="btn small" data-action="sync-reconnect">다시 연결</button>' });
  }
  return out;
}

function renderHome() {
  const today = todayKey();
  const a = annualInfo();
  const L = projectLedger();
  const todays = eventsOn(today);
  const todayPhases = phasesOn(today);
  const importantCount = todays.filter((e) => e.important).length;
  const nextLeave = state.events
    .filter((e) => leaveKind(e) && (e.endDate || e.date) >= today)
    .sort((x, y) => x.date.localeCompare(y.date))[0];

  $('#alerts').innerHTML = buildAlerts().map((al) => `<div class="alert ${al.cls || ''}"><span class="alert-ico">${al.ico}</span><span class="alert-text">${al.text}</span>${al.action || ''}</div>`).join('');

  let annualCard;
  if (a) {
    const toAnniv = diffDays(today, a.nextAnniversary);
    annualCard = kpiCard({
      cls: 'leave', label: '남은 연차', value: fmtNum(a.remaining), unit: `/ ${fmtNum(a.granted)}일`,
      sub: `사용 ${fmtNum(a.usedDone)}일 · 예정 ${fmtNum(a.planned)}일`,
      badge: toAnniv <= 60 ? `🎉 ${a.years + 1}주년까지 D-${toAnniv}` : '',
    });
  } else {
    annualCard = kpiCard({ cls: 'leave', label: '남은 연차', value: '–', sub: '입사일을 설정해 주세요' });
  }
  const soonDays = L.soon ? diffDays(today, L.soon.expiry) : null;

  $('#kpis').innerHTML = [
    annualCard,
    kpiCard({
      cls: 'project', label: '남은 프로젝트 휴가', value: fmtNum(L.remaining), unit: '일',
      sub: `적립 ${fmtNum(L.earned)} · 사용 ${fmtNum(L.used)}${L.expiredLeft ? ` · 소멸 ${fmtNum(L.expiredLeft)}` : ''}`,
      badge: L.soon ? `⏰ ${fmtDate(L.soon.expiry)}까지 ${fmtNum(L.soon.left)}일` : '',
      badgeCls: soonDays !== null && soonDays <= 14 ? 'warn' : '',
    }),
    kpiCard({ cls: 'company', label: '오늘 일정', value: todays.length + todayPhases.length, unit: '건', sub: importantCount ? `⭐ 중요 ${importantCount}건` : todayPhases.length ? `🎪 행사 ${todayPhases.length}건` : '중요 일정 없음' }),
    nextLeave
      ? kpiCard({ cls: 'personal', label: '다음 휴가', value: dday(nextLeave.date), sub: `${fmtDate(nextLeave.date)} · ${esc(LEAVE_TYPES[nextLeave.leaveType].label)}` })
      : kpiCard({ cls: 'personal', label: '다음 휴가', value: '–', sub: '예정된 휴가가 없어요' }),
  ].join('');

  $('#todayLabel').textContent = fmtFull(today) + ` (${DOW[new Date().getDay()]})`;
  const todayHtml = todayPhases.map(({ p, label, ico }) => `<li data-pid="${p.id}">
      <span class="dot" style="background:${projColor(p)}"></span><span class="time">${ico} ${label}</span>
      <span class="t">${esc(p.name)}</span><span class="tag phase">행사</span></li>`).join('') +
    todays.map((e) => listItem(e, false)).join('');
  $('#todayList').innerHTML = todayHtml || '<li class="empty">오늘은 일정이 없어요 🙌</li>';

  // 다가오는 7일
  const seen = new Set();
  const upcoming = [];
  for (let i = 1; i <= 7; i++) {
    const k = addDays(today, i);
    eventsOn(k).forEach((e) => {
      if (!seen.has(e.id)) { seen.add(e.id); upcoming.push({ ...e, _show: k }); }
    });
  }
  upcoming.sort((x, y) => x._show.localeCompare(y._show) || (x.time || '').localeCompare(y.time || ''));
  $('#upcomingList').innerHTML = upcoming.length
    ? upcoming.map((e) => listItem(e, true)).join('')
    : '<li class="empty">예정된 일정이 없어요</li>';

  // 진행 중 · 다가오는 행사
  const projs = state.projects
    .filter((p) => ['ongoing', 'upcoming'].includes(projectStatus(p)))
    .sort((x, y) => projectSpan(x)[0].localeCompare(projectSpan(y)[0]))
    .slice(0, 3);
  $('#homeProjects').innerHTML = projs.length
    ? projs.map(miniProject).join('')
    : '<div class="muted">등록된 행사가 없어요. <button class="link" data-action="add-project">행사 추가</button></div>';

  if (!ui.homeMonth) { const d = new Date(); ui.homeMonth = { y: d.getFullYear(), m: d.getMonth() }; }
  $('#homeMonthTitle').textContent = `${ui.homeMonth.y}년 ${ui.homeMonth.m + 1}월`;
  renderMonth($('#homeCalendar'), ui.homeMonth.y, ui.homeMonth.m, { compact: true });
}

function listItem(ev, showDate) {
  const when = showDate ? fmtDate(ev._show || ev.date) : (ev.time || '종일');
  const p = ev.projectId ? projectById(ev.projectId) : null;
  const c = evColor(ev);
  return `<li data-id="${ev.id}" data-date="${ev._show || todayKey()}" class="${ev.important ? 'important' : ''}" style="${c.style}">
    <span class="dot ${colorClass(ev)} ${c.cls}"></span>
    <span class="time">${when}</span>
    <span class="t">${ev.important ? '⭐ ' : ''}${(ev.repeat || 'none') !== 'none' ? '🔁 ' : ''}${esc(ev.title)}${p ? ` <span class="muted">· ${esc(p.name)}</span>` : ''}</span>
    <span class="tag ${colorClass(ev)}">${esc(tagLabel(ev))}</span>
  </li>`;
}
function projectStatusTag(p) {
  const st = projectStatus(p);
  const span = projectSpan(p);
  if (st === 'ongoing') return '<span class="tag phase">진행 중</span>';
  if (st === 'upcoming') return `<span class="tag company">${dday(span[0])}</span>`;
  if (st === 'done') return '<span class="tag gray">종료</span>';
  return '<span class="tag gray">날짜 미정</span>';
}
function miniProject(p) {
  const span = projectSpan(p);
  const { done, total } = todoStats(p);
  return `<div class="mini-proj" style="--pc:${projColor(p)}" data-pid="${p.id}">
    <div class="mp-top"><span>${esc(p.name)}</span>${projectStatusTag(p)}</div>
    <div class="mp-sub">${span ? `${fmtDate(span[0])}${span[1] !== span[0] ? ` ~ ${fmtDate(span[1])}` : ''}` : ''}${p.venue ? ` · ${esc(p.venue)}` : ''}</div>
    ${total ? `<div class="progress"><i style="width:${Math.round((done / total) * 100)}%"></i></div><div class="mp-sub">체크리스트 ${done}/${total}</div>` : ''}
  </div>`;
}

/* ===== 7. 캘린더 (월간/주간) ===== */
function calFilter() {
  const c = $('#fCompany').checked, pe = $('#fPersonal').checked;
  return (e) => (e.category === 'company' ? c : pe);
}

const LANE_PX = 19, BAR_TOP = 28;

function renderMonth(el, y, m, { compact = false, filter = () => true, showPhases = true, lanes = null } = {}) {
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const rows = Math.ceil((first.getDay() + daysInMonth) / 7);
  const startKey = toKey(new Date(y, m, 1 - first.getDay()));
  const today = todayKey();
  const fit = lanes ?? (compact ? 2 : 4); // 한 칸에 보이는 줄 수

  let html = '<div class="dow">' + DOW.map((d, i) => `<div class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('') + '</div><div class="grid">';
  for (let w = 0; w < rows; w++) {
    const ws = addDays(startKey, w * 7);
    const { items, laneCount } = weekItems(ws, { filter, showPhases });
    const visible = laneCount <= fit ? fit : Math.max(1, fit - 1);

    const cells = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const k = addDays(ws, i);
      const d = fromKey(k);
      const hol = holidayName(k);
      const cls = ['cell',
        d.getMonth() !== m ? 'other' : '',
        k === today ? 'today' : '',
        d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '',
        hol ? 'holiday' : ''].join(' ');
      return `<div class="${cls}" data-date="${k}" data-drop>
        <div class="cell-top"><span class="num">${d.getDate()}</span>${hol ? `<span class="hol">${esc(hol)}</span>` : ''}</div></div>`;
    }).join('');

    const bars = items.filter((it) => it.lane < visible).map((it) => barHtml(it, ws)).join('');
    let more = '';
    for (let c = 0; c < 7; c++) {
      const n = items.filter((it) => it.lane >= visible && it.cs <= c && c <= it.ce).length;
      if (n) more += `<span class="more" data-more="${addDays(ws, c)}" style="grid-column:${c + 1};grid-row:${visible + 1}">+${n}개 더보기</span>`;
    }
    html += `<div class="mweek">${cells}<div class="mbars">${bars}${more}</div></div>`;
  }
  el.innerHTML = html + '</div>';

  // 실제 칸 높이에 맞춰 보이는 줄 수를 다시 계산
  if (lanes === null) {
    const row = el.querySelector('.mweek');
    if (row && row.clientHeight) {
      const f = Math.max(1, Math.floor((row.clientHeight - BAR_TOP - 4) / LANE_PX));
      if (f !== fit) renderMonth(el, y, m, { compact, filter, showPhases, lanes: f });
    }
  }
}

const WEEK_START_HOUR = 7, WEEK_END_HOUR = 24, HOUR_PX = 48;

function renderWeek(el, startKey, { filter = () => true, showPhases = true } = {}) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(startKey, i));
  const today = todayKey();
  const prevScroll = el.querySelector('.week-body')?.scrollTop;

  const head = '<div class="week-row week-head"><div></div>' + days.map((k) => {
    const d = fromKey(k), hol = holidayName(k);
    const cls = [d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '', hol ? 'holiday' : '', k === today ? 'today' : ''].join(' ');
    return `<div class="${cls}" data-date="${k}" data-drop>${DOW[d.getDay()]}<span class="wd-num">${d.getDate()}</span>${hol ? `<span class="wd-hol">${esc(hol)}</span>` : ''}</div>`;
  }).join('') + '</div>';

  // 종일 줄: 행사, 여러 날 일정, 시간 없는 일정 (여러 날은 이어진 막대)
  const isTimedSingle = (e) => e.time && !(e.endDate && e.endDate > e.date);
  const ad = weekItems(startKey, { filter, showPhases, include: (it) => it.type === 'phase' || !isTimedSingle(it.ev) });
  const allday = `<div class="week-allday" style="grid-template-rows:repeat(${Math.max(1, ad.laneCount)}, 20px)">
    <div class="ad-label">종일</div>
    ${days.map((k, i) => `<div class="ad-cell" style="grid-column:${i + 2}" data-date="${k}" data-drop></div>`).join('')}
    ${ad.items.map((it) => barHtml(it, startKey, 1)).join('')}
  </div>`;

  const hours = '<div class="hours">' + Array.from({ length: WEEK_END_HOUR - WEEK_START_HOUR }, (_, i) => `<div>${WEEK_START_HOUR + i}:00</div>`).join('') + '</div>';
  const colHeight = (WEEK_END_HOUR - WEEK_START_HOUR) * HOUR_PX;
  const cols = days.map((k) => {
    const timed = eventsOn(k).filter(filter).filter(isTimedSingle)
      .map((e) => {
        const s = toMin(e.time);
        let en = e.endTime ? toMin(e.endTime) : s + 60;
        if (en <= s) en = s + 60;
        return { e, s, en };
      })
      .sort((a, b) => a.s - b.s);
    // 겹치는 일정은 나란히 배치
    const laneEnds = [];
    timed.forEach((t) => {
      let lane = laneEnds.findIndex((end) => end <= t.s);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(t.en); } else laneEnds[lane] = t.en;
      t.lane = lane;
    });
    const lanes = Math.max(1, laneEnds.length);
    const blocks = timed.map(({ e, s, en, lane }) => {
      const top = Math.max(0, (s - WEEK_START_HOUR * 60) / 60 * HOUR_PX);
      const bottom = Math.min(colHeight, (en - WEEK_START_HOUR * 60) / 60 * HOUR_PX);
      const h = Math.max(22, bottom - top);
      const w = 100 / lanes;
      const drag = (e.repeat || 'none') === 'none' ? 'draggable="true"' : '';
      return `<div class="wblock ${colorClass(e)} ${evColor(e).cls}" data-id="${e.id}" data-date="${k}" ${drag}
        style="${evColor(e).style}top:${top}px;height:${h}px;left:calc(${lane * w}% + 2px);width:calc(${w}% - 4px)">
        <b>${e.important ? '⭐' : ''}${esc(e.title)}</b>${e.time}${e.endTime ? `–${e.endTime}` : ''}</div>`;
    }).join('');
    let nowLine = '';
    if (k === today) {
      const m = toMin(nowHM()) - WEEK_START_HOUR * 60;
      if (m >= 0 && m <= colHeight / HOUR_PX * 60) nowLine = `<div class="now-line" style="top:${m / 60 * HOUR_PX}px"></div>`;
    }
    return `<div class="wcol ${k === today ? 'today' : ''}" data-date="${k}" data-drop style="height:${colHeight}px">${blocks}${nowLine}</div>`;
  }).join('');

  el.innerHTML = `<div class="week">${head}${allday}<div class="week-body"><div class="week-row">${hours}${cols}</div></div></div>`;
  const body = el.querySelector('.week-body');
  body.scrollTop = prevScroll ?? (9 - WEEK_START_HOUR) * HOUR_PX - 12;
}

function renderCalendar() {
  if (!ui.calMonth) { const d = new Date(); ui.calMonth = { y: d.getFullYear(), m: d.getMonth() }; }
  if (!ui.weekStart) ui.weekStart = weekStartOf(todayKey());
  const opts = { filter: calFilter(), showPhases: $('#fProject').checked };
  if (ui.calMode === 'week') {
    const s = fromKey(ui.weekStart), e = fromKey(addDays(ui.weekStart, 6));
    $('#calTitle').textContent = `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${s.getDate()}일 – ${s.getMonth() !== e.getMonth() ? `${e.getMonth() + 1}월 ` : ''}${e.getDate()}일`;
    renderWeek($('#bigCalendar'), ui.weekStart, opts);
  } else {
    $('#calTitle').textContent = `${ui.calMonth.y}년 ${ui.calMonth.m + 1}월`;
    renderMonth($('#bigCalendar'), ui.calMonth.y, ui.calMonth.m, opts);
  }
}

function setCalMode(mode) {
  if (mode === ui.calMode) return;
  if (mode === 'week') {
    const now = new Date();
    const inMonth = now.getFullYear() === ui.calMonth.y && now.getMonth() === ui.calMonth.m;
    ui.weekStart = weekStartOf(inMonth ? todayKey() : toKey(new Date(ui.calMonth.y, ui.calMonth.m, 1)));
  } else {
    const d = fromKey(addDays(ui.weekStart, 3));
    ui.calMonth = { y: d.getFullYear(), m: d.getMonth() };
  }
  ui.calMode = mode;
  renderCalendar();
}

function moveCalendar(which, dir) {
  if (which === 'cal' && ui.calMode === 'week') {
    ui.weekStart = dir === 0 ? weekStartOf(todayKey()) : addDays(ui.weekStart, dir * 7);
    return renderCalendar();
  }
  const key = which === 'home' ? 'homeMonth' : 'calMonth';
  if (dir === 0) { const d = new Date(); ui[key] = { y: d.getFullYear(), m: d.getMonth() }; }
  else { const d = new Date(ui[key].y, ui[key].m + dir, 1); ui[key] = { y: d.getFullYear(), m: d.getMonth() }; }
  which === 'home' ? renderHome() : renderCalendar();
}

/* ===== 8. 드래그로 옮기기 ===== */
let drag = null;
function bindDrag() {
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest('[data-id][draggable="true"]');
    if (!c) return;
    // 여러 날 막대는 잡은 위치의 날짜를 기준으로 옮김
    const span = Number(c.dataset.span) || 1;
    const r = c.getBoundingClientRect();
    const offset = Math.min(span - 1, Math.max(0, Math.floor((e.clientX - r.left) / (r.width / span))));
    drag = { id: c.dataset.id, from: addDays(c.dataset.date, offset) };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', c.dataset.id);
    setTimeout(() => c.classList.add('dragging'), 0);
  });
  document.addEventListener('dragend', () => {
    drag = null;
    $$('.dragging, .drop-over').forEach((x) => x.classList.remove('dragging', 'drop-over'));
  });
  document.addEventListener('dragover', (e) => {
    const t = e.target.closest('[data-drop]');
    if (!t || !drag) return;
    e.preventDefault();
    $$('.drop-over').forEach((x) => x !== t && x.classList.remove('drop-over'));
    t.classList.add('drop-over');
  });
  document.addEventListener('drop', (e) => {
    const t = e.target.closest('[data-drop]');
    if (!t || !drag) return;
    e.preventDefault();
    moveEvent(drag.id, drag.from, t.dataset.date);
  });
}
function moveEvent(id, from, to) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev || !from || !to) return;
  const diff = diffDays(from, to);
  if (diff === 0) return;
  ev.date = addDays(ev.date, diff);
  if (ev.endDate) ev.endDate = addDays(ev.endDate, diff);
  saveState();
  toast(`'${ev.title}' → ${fmtDate(ev.date)}로 옮겼어요`);
}

/* ===== 9. 행사 화면 ===== */
function renderProjects() {
  const f = ui.projFilter;
  const list = state.projects
    .filter((p) => f === 'all' || (f === 'done' ? projectStatus(p) === 'done' : projectStatus(p) !== 'done'))
    .sort((a, b) => {
      const sa = projectSpan(a)?.[0] || '9999', sb = projectSpan(b)?.[0] || '9999';
      return f === 'done' ? sb.localeCompare(sa) : sa.localeCompare(sb);
    });
  $('#projectGrid').innerHTML = list.length ? list.map(projectCard).join('') :
    `<div class="empty-box">${f === 'done' ? '종료된 행사가 없어요' : '등록된 행사가 없어요.<br><br><button class="btn primary" data-action="add-project">+ 첫 행사 추가하기</button>'}</div>`;
}
function projectCard(p) {
  const { done, total } = todoStats(p);
  const linked = linkedEvents(p);
  const weekend = linked.filter((e) => Number(e.earn) > 0).length + (p.earns || []).filter((x) => Number(x.amount) > 0).length;
  const phases = PHASES.map(([ph, label, ico]) => {
    const r = phaseRange(p, ph);
    return r ? `<div><span>${ico} ${label}</span>${fmtDate(r[0])}${r[1] !== r[0] ? ` ~ ${fmtDate(r[1])}` : ''}</div>` : '';
  }).join('');
  return `<div class="proj-card" style="--pc:${projColor(p)}" data-pid="${p.id}">
    <div class="pc-top"><h3>${esc(p.name)}</h3>${projectStatusTag(p)}</div>
    <div class="pc-meta">${[p.client, p.venue].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
    <div class="pc-phases">${phases}</div>
    ${total ? `<div class="progress"><i style="width:${Math.round((done / total) * 100)}%"></i></div>` : ''}
    <div class="pc-foot"><span>✅ 체크리스트 ${done}/${total}</span><span>연결 일정 ${linked.length}건${weekend ? ` · 주말근무 ${weekend}회` : ''}</span></div>
  </div>`;
}

/* ===== 10. 휴가 화면 (+ 연휴 추천) ===== */
function renderLeave() {
  const a = annualInfo();
  const L = projectLedger();
  const today = todayKey();

  $('#leaveKpis').innerHTML = [
    kpiCard({ cls: 'leave', label: '연차 발생', value: a ? fmtNum(a.granted) : '–', unit: a ? '일' : '', sub: a ? `${fmtFull(a.periodStart)} ~ ${fmtFull(a.periodEnd)}` : '입사일 미설정' }),
    kpiCard({ cls: 'leave', label: '연차 사용 / 예정', value: a ? `${fmtNum(a.usedDone)} / ${fmtNum(a.planned)}` : '–', unit: a ? '일' : '', sub: '오늘 이후 일정은 예정으로 집계' }),
    kpiCard({ cls: 'leave', label: '남은 연차', value: a ? fmtNum(a.remaining) : '–', unit: a ? '일' : '', sub: a ? `${fmtFull(a.periodEnd)}까지 사용 (D-${diffDays(today, a.periodEnd)})` : '' }),
    kpiCard({ cls: 'project', label: '남은 프로젝트 휴가', value: fmtNum(L.remaining), unit: '일', sub: `적립 ${fmtNum(L.earned)} · 사용 ${fmtNum(L.used)}${L.expiredLeft ? ` · 소멸 ${fmtNum(L.expiredLeft)}` : ''}` }),
  ].join('');

  if (a) {
    const d = diffDays(today, a.nextAnniversary);
    $('#leaveRule').innerHTML = `
      <div>입사일 <b>${fmtFull(state.settings.joinDate)}</b> · 현재 연차 기간 <b>${fmtFull(a.periodStart)} ~ ${fmtFull(a.periodEnd)}</b></div>
      <div>${esc(a.rule)}${a.adjust ? ` · 보정 ${a.adjust > 0 ? '+' : ''}${a.adjust}일` : ''}</div>
      <div>다음 기준일 <b>${fmtFull(a.nextAnniversary)}</b> (D-${d}) → 새 연차 <b>${Math.min(25, 15 + Math.floor(a.years / 2))}일</b> 발생 예정</div>
      ${a.years === 0 ? '<div class="note">※ 1년 미만 기간에 생긴 연차는 보통 입사 1주년에 소멸돼요 (회사의 사용촉진 여부에 따라 다를 수 있음).</div>' : ''}
      <div class="note">※ 법정 기준(입사일·80% 이상 출근 가정)으로 계산한 값이에요. 회사 기준이 다르면 설정의 보정값으로 맞춰 주세요.</div>`;
  } else {
    $('#leaveRule').innerHTML = '<div>설정에서 입사일을 입력하면 계산 근거가 표시돼요. <button class="link" data-goto="settings">설정하러 가기 →</button></div>';
  }

  const n = Number(state.settings.monthEndDays) || 0;
  $('#projectRule').innerHTML = `
    <div>주말근무로 적립한 프로젝트 휴가는 <b>근무한 달 말일까지</b> 사용해요.</div>
    <div>근무일이 <b>말일로부터 ${n}일 이내</b>(월말 주말)면 <b>다음 달 말일까지</b> 쓸 수 있어요.</div>
    <div>사용할 때는 <b>만료가 빠른 적립분부터</b> 자동으로 차감돼요.</div>
    <div class="note">예) 오늘 주말근무를 하면 → 사용기한 ${fmtFull(projectExpiry(today))}. 기준 일수는 설정에서 바꿀 수 있어요.</div>`;

  renderBridges();

  // 휴가 사용 내역
  const useMap = new Map(L.uses.map((u) => [u.ev.id, u]));
  const usage = state.events.filter((e) => leaveKind(e)).sort((x, y) => y.date.localeCompare(x.date));
  $('#usageTable').innerHTML = '<tr><th>날짜</th><th>종류</th><th>내용</th><th class="num-col">차감</th></tr>' +
    (usage.length
      ? usage.map((e) => {
          const u = useMap.get(e.id);
          const short = u && u.left > 0 ? ` <span class="tag danger">부족 ${fmtNum(u.left)}</span>` : '';
          return `<tr data-id="${e.id}" class="${e.date > today ? 'future' : ''}">
            <td>${fmtDate(e.date)}${e.endDate ? ` ~ ${fmtDate(e.endDate)}` : ''}${e.date > today ? ' · 예정' : ''}</td>
            <td><span class="tag ${colorClass(e)}">${LEAVE_TYPES[e.leaveType].label}</span>${short}</td>
            <td>${esc(e.title)}</td>
            <td class="num-col">${fmtNum(leaveDays(e))}일</td></tr>`;
        }).join('')
      : '<tr class="empty"><td colspan="4">아직 사용한 휴가가 없어요</td></tr>');

  // 적립 내역
  const earns = [...L.earns].sort((x, y) => y.ev.date.localeCompare(x.ev.date));
  $('#earnTable').innerHTML = '<tr><th>근무일</th><th>내용</th><th class="num-col">적립</th><th>사용기한</th><th>상태</th></tr>' +
    (earns.length
      ? earns.map((er) => {
          const expired = er.expiry < today;
          let status;
          if (er.left <= 0) status = '<span class="tag gray">사용 완료</span>';
          else if (expired) status = `<span class="tag danger">소멸 ${fmtNum(er.left)}일</span>`;
          else status = `<span class="tag project">남음 ${fmtNum(er.left)}일</span> <span class="muted">${dday(er.expiry)}</span>`;
          const p = er.ev.projectId ? projectById(er.ev.projectId) : null;
          return `<tr ${er.ev._pid ? `data-pid="${er.ev._pid}"` : `data-id="${er.ev.id}"`} class="${expired && er.left > 0 ? 'expired' : ''}">
            <td>${fmtDate(er.ev.date)}</td><td>${esc(er.ev.title)}${p ? ` <span class="muted">· ${esc(p.name)}</span>` : ''}</td>
            <td class="num-col">+${fmtNum(er.amount)}일</td><td>${fmtDate(er.expiry)}</td><td>${status}</td></tr>`;
        }).join('')
      : '<tr class="empty"><td colspan="5">주말근무 기록이 없어요</td></tr>');
}

/** 징검다리 연휴 찾기: 평일 공휴일 주변에 연차 1~2일을 붙여 가장 길게 쉬는 구간 */
function bridgeSuggestions() {
  const today = todayKey();
  const end = addDays(today, 365);
  const hols = Object.keys(typeof HOLIDAYS !== 'undefined' ? HOLIDAYS : {})
    .filter((k) => k > today && k <= end && !isWeekend(k)).sort();
  const out = [];
  const seen = new Set();
  for (const h of hols) {
    const best = {};
    for (const w of [1, 2]) {
      for (let s = addDays(h, -6); s <= h; s = addDays(s, 1)) {
        if (s <= today) continue;
        for (let e = h; e <= addDays(h, 6); e = addDays(e, 1)) {
          if (!isWorkday(addDays(s, -1)) || !isWorkday(addDays(e, 1))) continue; // 앞뒤로 더 늘릴 수 없는 구간만
          const days = eachDay(s, e);
          const work = days.filter(isWorkday);
          if (work.length !== w) continue;
          if (!best[w] || days.length > best[w].days.length) best[w] = { s, e, days, work, h };
        }
      }
    }
    const cands = [best[1], best[2] && (!best[1] || best[2].days.length > best[1].days.length) ? best[2] : null];
    cands.filter(Boolean).forEach((c) => {
      const key = c.s + c.e;
      if (c.days.length >= c.work.length + 3 && !seen.has(key)) { seen.add(key); out.push(c); }
    });
  }
  return out.sort((a, b) => a.s.localeCompare(b.s));
}
function isLeaveTaken(k) {
  return state.events.some((e) => leaveKind(e) && occursOn(e, k));
}
/** 겹치는 추천끼리 묶어 공휴일(연휴)별 카드 하나로 */
function bridgeGroups() {
  const groups = [];
  bridgeSuggestions().forEach((b) => {
    const g = groups.find((x) => b.s <= x.e && b.e >= x.s);
    if (g) { g.options.push(b); g.s = b.s < g.s ? b.s : g.s; g.e = b.e > g.e ? b.e : g.e; }
    else groups.push({ s: b.s, e: b.e, options: [b] });
  });
  groups.forEach((g) => {
    // 연차 일수별로 가장 긴 안만 남기고, 더 써도 길어지지 않는 안은 제외
    const byWork = {};
    g.options.forEach((o) => { const w = o.work.length; if (!byWork[w] || o.days.length > byWork[w].days.length) byWork[w] = o; });
    let bestLen = 0;
    g.options = Object.keys(byWork).sort().map((w) => byWork[w]).filter((o) => { if (o.days.length <= bestLen) return false; bestLen = o.days.length; return true; });
    g.names = [...new Set(g.options.flatMap((o) => o.days).map(holidayName).filter(Boolean).map((n) => n.replace(/ 연휴$/, '')))].join(' · ');
  });
  return groups;
}
function renderBridges() {
  const groups = bridgeGroups();
  const LIMIT = 6;
  const shown = ui.bridgeAll ? groups : groups.slice(0, LIMIT);
  $('#bridgeList').innerHTML = groups.length ? shown.map((g) => {
    const rows = g.options.map((b) => {
      const taken = b.work.every(isLeaveTaken);
      return `<div class="b-opt ${taken ? 'taken' : ''}">
        <div class="b-top"><span class="b-range">${fmtDate(b.s)} ~ ${fmtDate(b.e)}</span><span class="b-days">${b.days.length}일 휴무</span></div>
        <div class="b-strip">${b.days.map((k) => `<i class="${isWorkday(k) ? 'need' : ''}" title="${fmtDate(k)}${isWorkday(k) ? ' · 연차' : ''}"></i>`).join('')}</div>
        <div class="b-foot"><span class="b-sub">연차 ${b.work.length}일: ${b.work.map(fmtDate).join(', ')}</span>
        ${taken ? '<span class="tag personal">✔ 등록됨</span>' : `<button class="btn small" data-action="register-bridge" data-days="${b.work.join(',')}">등록</button>`}</div>
      </div>`;
    }).join('');
    return `<div class="bridge"><div class="b-name">${esc(g.names)} <span class="muted">${dday(g.s)}</span></div>${rows}</div>`;
  }).join('') + (groups.length > LIMIT ? `<div class="bridge-more"><button class="btn small" data-action="toggle-bridges">${ui.bridgeAll ? '접기' : `전체 보기 (${groups.length}개)`}</button></div>` : '')
    : '<div class="muted">앞으로 1년 안에 추천할 연휴가 없어요. (holidays.js에 공휴일을 추가하면 계산돼요)</div>';
}
function registerBridge(days) {
  const a = annualInfo(days[0]);
  if (a && a.remaining - days.length < 0 && !confirm(`잔여 연차가 부족해요 (등록 후 ${fmtNum(a.remaining - days.length)}일). 그래도 등록할까요?`)) return;
  if (!confirm(`${days.map(fmtDate).join(', ')} 에 연차를 등록할까요?`)) return;
  days.forEach((k) => state.events.push({ id: uid(), title: '연휴 연차', category: 'personal', date: k, endDate: '', time: '', endTime: '', leaveType: 'annual', earn: 0, projectId: '', repeat: 'none', repeatUntil: '', skip: [], important: false, memo: '', createdAt: Date.now() }));
  saveState();
  toast(`연차 ${days.length}일을 등록했어요`);
}

/* ===== 11. 리포트 화면 ===== */
function renderReport() {
  const thisYear = new Date().getFullYear();
  const years = new Set([thisYear]);
  state.events.forEach((e) => years.add(Number(e.date.slice(0, 4))));
  state.projects.forEach((p) => { const s = projectSpan(p); if (s) years.add(Number(s[0].slice(0, 4))); });
  const sorted = [...years].sort((a, b) => b - a);
  if (!ui.reportYear) ui.reportYear = thisYear;
  const sel = $('#reportYear');
  sel.innerHTML = sorted.map((y) => `<option value="${y}" ${y === ui.reportYear ? 'selected' : ''}>${y}년</option>`).join('');

  const y = ui.reportYear;
  const inYear = (k) => k && k.startsWith(`${y}-`);
  const monthOf = (k) => Number(k.slice(5, 7)) - 1;
  const annualM = Array(12).fill(0), projectM = Array(12).fill(0), earnM = Array(12).fill(0), busyM = Array(12).fill(0);

  state.events.forEach((e) => {
    const k = leaveKind(e);
    if (k) {
      eachDay(e.date, k && LEAVE_TYPES[e.leaveType].half ? e.date : (e.endDate || e.date)).forEach((d) => {
        if (!inYear(d) || !isWorkday(d)) return;
        const v = LEAVE_TYPES[e.leaveType].half ? 0.5 : 1;
        (k === 'annual' ? annualM : projectM)[monthOf(d)] += v;
      });
    }
    // (주말근무 적립은 아래에서 일정+행사 모두 합산)
    if (e.category === 'company' && (e.repeat || 'none') === 'none' && inYear(e.date)) busyM[monthOf(e.date)] += 1;
  });
  const yearProjects = state.projects.filter((p) => { const s = projectSpan(p); return s && s[0] <= `${y}-12-31` && s[1] >= `${y}-01-01`; });
  yearProjects.forEach((p) => {
    const s = projectSpan(p);
    eachDay(s[0], s[1]).filter(inYear).forEach((d) => { busyM[monthOf(d)] += 1; });
  });

  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  const yearEarns = earnSources().filter(({ ev }) => inYear(ev.date));
  yearEarns.forEach(({ ev, amount }) => { earnM[monthOf(ev.date)] += amount; });
  const weekendCount = yearEarns.length;
  const L = projectLedger();
  const expiredInYear = L.earns.filter((er) => inYear(er.expiry) && er.expiry < todayKey()).reduce((s, er) => s + er.left, 0);

  $('#reportKpis').innerHTML = [
    kpiCard({ cls: 'leave', label: '연차 사용', value: fmtNum(sum(annualM)), unit: '일', sub: `${y}년 1월 ~ 12월 (예정 포함)` }),
    kpiCard({ cls: 'project', label: '프로젝트 휴가 적립 / 사용', value: `${fmtNum(sum(earnM))} / ${fmtNum(sum(projectM))}`, unit: '일', sub: expiredInYear ? `소멸 ${fmtNum(expiredInYear)}일` : '소멸 없음' }),
    kpiCard({ cls: 'company', label: '주말근무', value: weekendCount, unit: '회', sub: weekendCount ? `월평균 ${(weekendCount / 12).toFixed(1)}회` : '' }),
    kpiCard({ cls: 'phase', label: '참여 행사', value: yearProjects.length, unit: '개', sub: `연결된 일정 ${state.events.filter((e) => e.projectId && inYear(e.date)).length}건` }),
  ].join('');

  const max = Math.max(1, ...annualM, ...projectM, ...earnM);
  $('#reportChart').innerHTML = annualM.map((_, i) => `<div class="bar-col" title="${i + 1}월 · 연차 ${fmtNum(annualM[i])} · 프로젝트 ${fmtNum(projectM[i])} · 주말근무 적립 ${fmtNum(earnM[i])}">
      <div class="bar-stack">
        <div class="bar leave" style="height:${(annualM[i] / max) * 100}%"></div>
        <div class="bar project" style="height:${(projectM[i] / max) * 100}%"></div>
        <div class="bar company" style="height:${(earnM[i] / max) * 100}%"></div>
      </div>
      <span class="bar-label">${i + 1}월</span>
    </div>`).join('');

  const busiest = busyM.indexOf(Math.max(...busyM));
  const clients = {};
  yearProjects.forEach((p) => { if (p.client) clients[p.client] = (clients[p.client] || 0) + 1; });
  const topClient = Object.entries(clients).sort((a, b) => b[1] - a[1])[0];
  const offDays = sum(annualM) + sum(projectM);
  $('#reportSummary').innerHTML = `
    <div>🌴 올해 휴가로 쉰 날 <b>${fmtNum(offDays)}일</b> (연차 ${fmtNum(sum(annualM))} + 프로젝트 ${fmtNum(sum(projectM))})</div>
    <div>🏃 가장 바빴던 달 <b>${Math.max(...busyM) > 0 ? `${busiest + 1}월` : '–'}</b>${Math.max(...busyM) > 0 ? ` (회사 일정·행사 ${busyM[busiest]}건/일)` : ''}</div>
    <div>📅 주말근무 <b>${weekendCount}회</b>${weekendCount ? ` · 적립 ${fmtNum(sum(earnM))}일` : ''}</div>
    <div>🤝 가장 많이 함께한 클라이언트 <b>${topClient ? `${esc(topClient[0])} (${topClient[1]}건)` : '–'}</b></div>
    <div class="note">평가·연봉 협상 때 근거 자료로 활용해 보세요.</div>`;

  $('#reportProjects').innerHTML = yearProjects.length
    ? yearProjects.sort((a, b) => projectSpan(a)[0].localeCompare(projectSpan(b)[0])).map((p) => {
        const s = projectSpan(p);
        return `<li data-pid="${p.id}"><span class="dot" style="background:${projColor(p)}"></span><span class="time">${fmtDate(s[0])}</span><span class="t">${esc(p.name)}${p.client ? ` <span class="muted">· ${esc(p.client)}</span>` : ''}</span>${projectStatusTag(p)}</li>`;
      }).join('')
    : '<li class="empty">이 해에 등록된 행사가 없어요</li>';
}

/* ===== 12. 검색 화면 ===== */
function highlight(text, q) {
  const t = esc(text);
  if (!q) return t;
  const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return t.replace(re, (m) => `<mark>${m}</mark>`);
}
function renderSearch() {
  const q = ui.search.trim();
  const box = $('#searchResults');
  if (!q) { box.innerHTML = '<div class="muted">검색어를 입력하세요.</div>'; return; }
  const ql = q.toLowerCase();
  const has = (...fields) => fields.some((f) => (f || '').toLowerCase().includes(ql));

  const projs = state.projects.filter((p) => has(p.name, p.client, p.venue, p.memo, ...(p.todos || []).map((t) => t.text)));
  const evs = state.events.filter((e) => has(e.title, e.memo)).sort((a, b) => b.date.localeCompare(a.date));

  let html = '';
  if (projs.length) {
    html += `<div class="search-group">행사 ${projs.length}건</div><ul class="list">` + projs.map((p) => {
      const s = projectSpan(p);
      return `<li data-pid="${p.id}"><span class="dot" style="background:${projColor(p)}"></span><span class="time">${s ? fmtFull(s[0]) : ''}</span>
        <span class="t">${highlight(p.name, q)}${p.client || p.venue ? ` <span class="muted">· ${highlight([p.client, p.venue].filter(Boolean).join(' · '), q)}</span>` : ''}</span>${projectStatusTag(p)}</li>`;
    }).join('') + '</ul>';
  }
  if (evs.length) {
    html += `<div class="search-group">일정 ${evs.length}건</div><ul class="list">` + evs.map((e) => `<li data-id="${e.id}" data-date="${e.date}">
        <span class="dot ${colorClass(e)}"></span><span class="time">${fmtFull(e.date)}</span>
        <span class="t">${highlight(e.title, q)}${(e.repeat || 'none') !== 'none' ? ` <span class="muted">🔁 ${REPEAT_LABEL[e.repeat]}</span>` : ''}${e.memo && e.memo.toLowerCase().includes(ql) ? ` <span class="muted">— ${highlight(e.memo, q)}</span>` : ''}</span>
        <span class="tag ${colorClass(e)}">${esc(tagLabel(e))}</span></li>`).join('') + '</ul>';
  }
  box.innerHTML = html || `<div class="muted">'${esc(q)}'에 대한 결과가 없어요.</div>`;
}

/* ===== 13. 일정 팝업 ===== */
let editingId = null;
let occDate = null; // 반복 일정에서 클릭한 날짜
const eventF = () => $('#eventForm').elements;

function projectOptions(selected) {
  const list = [...state.projects].sort((a, b) => {
    const da = projectStatus(a) === 'done' ? 1 : 0, db = projectStatus(b) === 'done' ? 1 : 0;
    return da - db || (projectSpan(a)?.[0] || '').localeCompare(projectSpan(b)?.[0] || '');
  });
  return '<option value="">연결 안 함</option>' + list.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${projectStatus(p) === 'done' ? ' (종료)' : ''}</option>`).join('');
}

function openEventDialog(opts = {}) {
  const f = $('#eventForm');
  f.reset();
  const ev = opts.id ? state.events.find((e) => e.id === opts.id) : null;
  if (opts.id && !ev) return;
  editingId = ev ? ev.id : null;
  occDate = opts.occ || null;
  $('#dlgTitle').textContent = ev ? '일정 수정' : '일정 추가';

  const d = ev || {
    title: opts.title || '', category: opts.category || 'company', date: opts.date || todayKey(), endDate: '',
    time: opts.time || '', endTime: opts.endTime || '', leaveType: 'none', earn: opts.earn || 0,
    projectId: opts.projectId || '', repeat: 'none', repeatUntil: '', important: false, memo: '',
  };
  const F = eventF();
  F.title.value = d.title;
  F.category.value = d.category;
  F.date.value = d.date;
  F.endDate.value = d.endDate || '';
  F.time.value = d.time || '';
  F.endTime.value = d.endTime || '';
  F.leaveType.value = d.leaveType || 'none';
  F.earn.value = String(d.earn || 0);
  F.projectId.innerHTML = projectOptions(d.projectId || '');
  F.repeat.value = d.repeat || 'none';
  F.repeatUntil.value = d.repeatUntil || '';
  F.important.checked = !!d.important;
  F.memo.value = d.memo || '';
  const cur = d.color || '';
  $('#evSwatches').innerHTML =
    `<label class="sw-default" title="구분별 기본 색"><input type="radio" name="color" value="" ${cur ? '' : 'checked'}/><i>기본</i></label>` +
    EVENT_COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === cur ? 'checked' : ''}/><i style="--c:${c}"></i></label>`).join('') +
    `<label class="sw-custom" title="직접 고르기"><input type="radio" name="color" value="${cur && !EVENT_COLORS.includes(cur) ? cur : '#000000'}" ${cur && !EVENT_COLORS.includes(cur) ? 'checked' : ''}/>
      <input type="color" id="evColorPicker" value="${cur && !EVENT_COLORS.includes(cur) ? cur : '#ff6b6b'}" /></label>`;
  $('#deleteBtn').classList.toggle('hidden', !ev);
  $('#deleteBtn').textContent = ev && (ev.repeat || 'none') !== 'none' ? '반복 전체 삭제' : '삭제';
  $('#skipBtn').classList.toggle('hidden', !(ev && (ev.repeat || 'none') !== 'none' && occDate));
  if (occDate) $('#skipBtn').textContent = `${fmtDate(occDate)}만 삭제`;

  syncEventDialog();
  $('#eventDialog').showModal();
  F.title.focus();
}

function readEventForm() {
  const F = eventF();
  const category = F.category.value;
  const leaveType = category === 'personal' ? F.leaveType.value : 'none';
  const half = LEAVE_TYPES[leaveType].half;
  const earn = category === 'company' ? Number(F.earn.value) : 0;
  const repeat = leaveType === 'none' && !earn ? F.repeat.value : 'none';
  const date = F.date.value;
  let endDate = half || repeat !== 'none' ? '' : F.endDate.value;
  if (endDate === date) endDate = '';
  return {
    title: F.title.value.trim(),
    category, date, endDate,
    time: F.time.value,
    endTime: F.time.value ? F.endTime.value : '',
    leaveType, earn,
    projectId: F.projectId.value,
    repeat,
    repeatUntil: repeat !== 'none' ? F.repeatUntil.value : '',
    important: F.important.checked,
    memo: F.memo.value.trim(),
    color: F.color.value || '',
  };
}

/** 이 일정을 반영했을 때의 프로젝트 휴가 장부 */
function ledgerWith(ev) {
  const events = state.events.filter((e) => e.id !== editingId).concat([{ ...ev, id: '__draft' }]);
  const L = projectLedger(events);
  return { L, use: L.uses.find((u) => u.ev.id === '__draft') };
}

function syncEventDialog() {
  const F = eventF();
  const isPersonal = F.category.value === 'personal';
  $('#leaveField').classList.toggle('hidden', !isPersonal);
  $('#earnField').classList.toggle('hidden', isPersonal);
  const lt = isPersonal ? F.leaveType.value : 'none';
  const half = LEAVE_TYPES[lt].half;
  const hasEarn = !isPersonal && Number(F.earn.value) > 0;
  const canRepeat = lt === 'none' && !hasEarn;
  $('#repeatRow').classList.toggle('hidden', !canRepeat);
  const repeating = canRepeat && F.repeat.value !== 'none';
  $('#repeatUntilField').classList.toggle('hidden', !repeating);
  F.endDate.disabled = half || repeating;
  if (F.endDate.disabled) F.endDate.value = '';
  F.endTime.disabled = !F.time.value;

  const hint = $('#leaveHint');
  hint.className = 'hint';
  hint.textContent = '';
  const ev = readEventForm();
  if (!ev.date) return;

  const kind = leaveKind(ev);
  if (kind === 'annual') {
    const days = leaveDays(ev);
    const info = annualInfo(ev.date);
    if (!info) { hint.textContent = `${fmtNum(days)}일 차감 예정 · 입사일을 설정하면 잔여 연차가 계산돼요`; return; }
    const orig = editingId ? state.events.find((e) => e.id === editingId) : null;
    let rem = info.remaining;
    if (orig && leaveKind(orig) === 'annual' && orig.date >= info.periodStart && orig.date <= info.periodEnd) rem += leaveDays(orig);
    const after = rem - days;
    hint.textContent = days === 0 ? '선택한 날이 주말·공휴일이라 차감되지 않아요'
      : `${LEAVE_TYPES[ev.leaveType].label} ${fmtNum(days)}일 차감 (주말·공휴일 제외) → 차감 후 잔여 ${fmtNum(after)}일`;
    hint.classList.add(after < 0 ? 'warn' : 'ok');
  } else if (kind === 'project') {
    const days = leaveDays(ev);
    const { L, use } = ledgerWith(ev);
    if (days === 0) { hint.textContent = '선택한 날이 주말·공휴일이라 차감되지 않아요'; return; }
    if (use && use.left > 0) {
      hint.textContent = `이 날짜에 쓸 수 있는 프로젝트 휴가가 ${fmtNum(use.left)}일 부족해요. (적립분은 근무한 달 말일까지, 월말 주말은 다음 달 말일까지 사용 가능)`;
      hint.classList.add('warn');
    } else {
      hint.textContent = `${LEAVE_TYPES[ev.leaveType].label} ${fmtNum(days)}일 사용 (만료가 빠른 적립분부터 차감) → 사용 후 잔여 ${fmtNum(L.remaining)}일`;
      hint.classList.add('ok');
    }
  } else if (ev.earn) {
    hint.textContent = `프로젝트 휴가 ${fmtNum(ev.earn)}일 적립 · 사용기한 ${fmtFull(projectExpiry(ev.date))}까지` + (isWorkday(ev.date) ? ' · 선택한 날짜가 평일이에요' : '');
    hint.classList.add('ok');
  } else if (repeating) {
    hint.textContent = '반복 일정은 끌어서 옮길 수 없고, 수정하면 반복 전체에 적용돼요.';
  }
}

function submitEvent(e) {
  e.preventDefault();
  const F = eventF();
  const ev = readEventForm();
  if (!ev.date) return toast('시작일을 입력해 주세요');
  if (F.endDate.value && !F.endDate.disabled && F.endDate.value < ev.date) return toast('종료일이 시작일보다 빨라요');
  if (ev.time && ev.endTime && ev.endTime <= ev.time) return toast('끝 시간이 시작 시간보다 빨라요');
  if (ev.repeatUntil && ev.repeatUntil < ev.date) return toast('반복 종료일이 시작일보다 빨라요');
  if (!ev.title) ev.title = ev.leaveType !== 'none' ? LEAVE_TYPES[ev.leaveType].label : ev.earn ? '주말근무' : '(제목 없음)';

  const kind = leaveKind(ev);
  if (kind) {
    const days = leaveDays(ev);
    if (days === 0 && !confirm('선택한 기간이 모두 주말·공휴일이라 차감되는 휴가가 없어요. 그래도 저장할까요?')) return;
    if (kind === 'annual') {
      const info = annualInfo(ev.date);
      if (info) {
        const orig = editingId ? state.events.find((x) => x.id === editingId) : null;
        let rem = info.remaining;
        if (orig && leaveKind(orig) === 'annual' && orig.date >= info.periodStart && orig.date <= info.periodEnd) rem += leaveDays(orig);
        if (rem - days < 0 && !confirm(`잔여 연차가 부족해요 (차감 후 ${fmtNum(rem - days)}일). 그래도 저장할까요?`)) return;
      }
    } else {
      const { use } = ledgerWith(ev);
      if (use && use.left > 0 && !confirm(`이 날짜에 쓸 수 있는 프로젝트 휴가가 ${fmtNum(use.left)}일 부족해요. 그래도 저장할까요?`)) return;
    }
  }

  if (editingId) {
    const target = state.events.find((x) => x.id === editingId);
    Object.assign(target, ev);
  } else {
    state.events.push({ id: uid(), skip: [], ...ev, createdAt: Date.now() });
  }
  const wasEdit = !!editingId;
  $('#eventDialog').close();
  saveState();
  toast(wasEdit ? '수정했어요' : '추가했어요');
}

function deleteEvent() {
  if (!editingId) return;
  const ev = state.events.find((e) => e.id === editingId);
  const msg = (ev.repeat || 'none') !== 'none' ? `'${ev.title}' 반복 일정을 모두 삭제할까요?` : `'${ev.title}' 일정을 삭제할까요?`;
  if (!confirm(msg)) return;
  state.events = state.events.filter((e) => e.id !== editingId);
  $('#eventDialog').close();
  saveState();
  toast('삭제했어요');
}
function skipOccurrence() {
  const ev = state.events.find((e) => e.id === editingId);
  if (!ev || !occDate) return;
  ev.skip = [...(ev.skip || []), occDate];
  $('#eventDialog').close();
  saveState();
  toast(`${fmtDate(occDate)} 일정만 삭제했어요`);
}

/* ===== 14. 행사 팝업 ===== */
let editingProjectId = null;
let todoDraft = [];
const projF = () => $('#projectForm').elements;

/** 일정 팝업에서 '행사'를 고르면 → 입력하던 내용을 들고 행사 팝업으로 */
let convertEventId = null;
function switchEventToProject() {
  const F = eventF();
  const orig = editingId ? state.events.find((e) => e.id === editingId) : null;
  if (orig && !confirm(`'${orig.title}' 일정을 행사로 바꿀까요?\n저장하면 일정이 행사로 옮겨지고, 행사 탭과 달력에 표시돼요.`)) {
    F.category.value = orig.category;
    syncEventDialog();
    return;
  }
  const date = F.date.value || todayKey();
  const end = F.endDate.value;
  const prefill = {
    name: F.title.value.trim(),
    mainStart: date,
    mainEnd: end && end > date ? end : '',
    memo: F.memo.value.trim(),
    color: F.color.value || '',
    // 주말근무 적립이 있던 일정이면 행사 적립으로 옮김
    earns: Number(F.earn.value) > 0 && F.category.value !== 'personal' ? [{ date, amount: Number(F.earn.value) }] : [],
  };
  const id = orig ? orig.id : null;
  $('#eventDialog').close();
  openProjectDialog(null, prefill);
  convertEventId = id;
}

function openProjectDialog(id, prefill = {}) {
  const f = $('#projectForm');
  f.reset();
  convertEventId = null;
  const p = id ? projectById(id) : null;
  editingProjectId = p ? p.id : null;
  $('#projDlgTitle').textContent = p ? '행사 수정' : '행사 추가';
  const color = p ? (p.color || '') : (prefill.color || ''); // '' = 설정의 행사 기본색
  const colorList = !color || PROJECT_COLORS.includes(color) ? PROJECT_COLORS : [...PROJECT_COLORS, color];
  $('#swatches').innerHTML =
    `<label class="sw-default" title="설정의 행사 기본색"><input type="radio" name="color" value="" ${color ? '' : 'checked'}/><i style="background:var(--phase);color:#fff">기본</i></label>` +
    colorList.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}/><i style="--c:${c}"></i></label>`).join('');

  const F = projF();
  ['name', 'client', 'venue', 'memo', 'setupStart', 'setupEnd', 'mainStart', 'mainEnd', 'teardownStart', 'teardownEnd']
    .forEach((k) => { F[k].value = p ? (p[k] || '') : (prefill[k] || ''); });
  todoDraft = p ? clone(p.todos || []) : [];
  renderTodos();
  earnDraft = Object.fromEntries(((p ? p.earns : prefill.earns) || []).map((x) => [x.date, Number(x.amount)]));
  renderEarnList();

  const linked = p ? linkedEvents(p) : [];
  $('#projLinked').innerHTML = linked.length
    ? `연결된 일정 ${linked.length}건: ${linked.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6).map((e) => `${fmtDate(e.date)} ${esc(e.title)}`).join(', ')}${linked.length > 6 ? ' …' : ''}`
    : (p ? '일정을 추가할 때 "행사 연결"을 고르면 여기에 표시돼요.' : '');
  $('#projDeleteBtn').classList.toggle('hidden', !p);
  $('#projectDialog').showModal();
  F.name.focus();
}
/* 행사 주말근무 적립: 행사 기간의 날짜마다 적립 일수 선택 */
let earnDraft = {}; // { 'YYYY-MM-DD': 1 | 0.5 }
function draftSpan() {
  const F = projF();
  const tmp = {};
  PHASES.forEach(([ph]) => { tmp[ph + 'Start'] = F[ph + 'Start'].value; tmp[ph + 'End'] = F[ph + 'End'].value; });
  return projectSpan(tmp);
}
function renderEarnList() {
  const span = draftSpan();
  const box = $('#earnList');
  if (!span) {
    box.innerHTML = '<div class="muted">행사 날짜를 입력하면 기간 중 날짜가 표시돼요.</div>';
    $('#earnSum').textContent = '';
    return;
  }
  let days = eachDay(span[0], span[1]);
  if (days.length > 31) days = days.filter((k) => !isWorkday(k)); // 긴 행사는 주말·공휴일만
  box.innerHTML = days.map((k) => {
    const off = !isWorkday(k);
    const v = earnDraft[k] || 0;
    const label = holidayName(k) || (isWeekend(k) ? '주말' : '');
    return `<div class="earn-row ${off ? 'off' : ''} ${v ? 'on' : ''}">
      <span class="er-date">${fmtDate(k)}</span>
      ${label ? `<span class="tag danger">${esc(label)}</span>` : ''}
      <span class="spacer"></span>
      ${v ? `<span class="muted">사용기한 ${fmtDate(projectExpiry(k))}</span>` : ''}
      <select data-ed="${k}">
        <option value="0">적립 안 함</option>
        <option value="1" ${v === 1 ? 'selected' : ''}>+1일</option>
        <option value="0.5" ${v === 0.5 ? 'selected' : ''}>+0.5일</option>
      </select>
    </div>`;
  }).join('');
  const total = days.reduce((s, k) => s + (earnDraft[k] || 0), 0);
  $('#earnSum').textContent = total ? `(프로젝트 휴가 ${fmtNum(total)}일 적립)` : '(주말·공휴일에 근무했다면 그 날짜에 선택하세요)';
}

function renderTodos() {
  const done = todoDraft.filter((t) => t.done).length;
  $('#todoProgress').textContent = todoDraft.length ? `(${done}/${todoDraft.length})` : '';
  $('#todoList').innerHTML = todoDraft.map((t, i) => `<li class="${t.done ? 'done' : ''}">
    <input type="checkbox" data-ti="${i}" ${t.done ? 'checked' : ''}/>
    <span class="todo-text">${esc(t.text)}</span>
    <button type="button" class="todo-del" data-tdel="${i}" title="삭제">✕</button></li>`).join('');
}
function addTodo() {
  const input = $('#todoInput');
  const text = input.value.trim();
  if (!text) return;
  todoDraft.push({ id: uid(), text, done: false });
  input.value = '';
  renderTodos();
  input.focus();
}
function submitProject(e) {
  e.preventDefault();
  if ($('#todoInput').value.trim()) addTodo(); // 입력 중이던 할 일도 저장
  const F = projF();
  const p = {
    name: F.name.value.trim(), client: F.client.value.trim(), venue: F.venue.value.trim(),
    color: F.color.value || '', memo: F.memo.value.trim(), todos: todoDraft,
  };
  PHASES.forEach(([ph]) => {
    const s = F[ph + 'Start'].value, en = F[ph + 'End'].value;
    p[ph + 'Start'] = s;
    p[ph + 'End'] = s && en && en > s ? en : '';
  });
  if (!p.name) return toast('행사명을 입력해 주세요');
  if (!p.mainStart) return toast('본행사 시작일을 입력해 주세요');
  const span = projectSpan(p);
  p.earns = Object.entries(earnDraft)
    .filter(([d, a]) => a > 0 && span && d >= span[0] && d <= span[1])
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const convertId = convertEventId;
  if (editingProjectId) Object.assign(projectById(editingProjectId), p);
  else state.projects.push({ id: uid(), ...p });
  if (convertId) state.events = state.events.filter((e) => e.id !== convertId); // 일정 → 행사로 옮김
  const wasEdit = !!editingProjectId;
  $('#projectDialog').close();
  saveState();
  toast(wasEdit ? '행사를 수정했어요' : convertId ? '일정을 행사로 옮겼어요 · 행사 탭에서 볼 수 있어요' : '행사를 추가했어요 · 행사 탭과 달력에 표시돼요');
}
function deleteProject() {
  const p = projectById(editingProjectId);
  if (!p || !confirm(`'${p.name}' 행사를 삭제할까요? (연결된 일정은 남고 연결만 해제돼요)`)) return;
  state.projects = state.projects.filter((x) => x.id !== p.id);
  state.events.forEach((e) => { if (e.projectId === p.id) e.projectId = ''; });
  $('#projectDialog').close();
  saveState();
  toast('행사를 삭제했어요');
}

/* ===== 15. 설정 · 화면 모드 · 백업 ===== */
function fillSettingsForm() {
  const F = $('#settingsForm').elements;
  const s = state.settings;
  F.name.value = s.name;
  F.joinDate.value = s.joinDate;
  F.annualAdjust.value = s.annualAdjust || 0;
  F.projectAdjust.value = s.projectAdjust || 0;
  F.monthEndDays.value = s.monthEndDays;
  F.theme.value = s.theme || 'system';
  Object.keys(DEFAULT_COLORS).forEach((k) => { F['c_' + k].value = (s.colors || {})[k] || DEFAULT_COLORS[k]; });
}

/* 구분별 기본 색상 (설정에서 바꾸면 CSS 변수에 덮어씀) */
const DEFAULT_COLORS = { company: '#4f6bed', personal: '#1f9d6b', leave: '#e8812a', project: '#8a4fe0', phase: '#d6457a' };
function applyColors(colors = state.settings.colors || {}) {
  const root = document.documentElement.style;
  Object.keys(DEFAULT_COLORS).forEach((k) => {
    const c = colors[k];
    if (c) {
      root.setProperty(`--${k}`, c);
      root.setProperty(`--${k}-bg`, `color-mix(in srgb, ${c} 17%, var(--card))`);
    } else {
      root.removeProperty(`--${k}`);
      root.removeProperty(`--${k}-bg`);
    }
  });
}
function colorsFromForm() {
  const F = $('#settingsForm').elements;
  const out = {};
  Object.keys(DEFAULT_COLORS).forEach((k) => {
    const v = F['c_' + k].value.toLowerCase();
    if (v !== DEFAULT_COLORS[k]) out[k] = v;
  });
  return out;
}
function submitSettings(e) {
  e.preventDefault();
  const F = $('#settingsForm').elements;
  state.settings = {
    ...state.settings,
    name: F.name.value.trim(),
    joinDate: F.joinDate.value,
    annualAdjust: Number(F.annualAdjust.value) || 0,
    projectAdjust: Number(F.projectAdjust.value) || 0,
    monthEndDays: F.monthEndDays.value === '' ? 7 : Math.max(0, Number(F.monthEndDays.value)),
    theme: F.theme.value,
    colors: colorsFromForm(),
  };
  applyTheme();
  applyColors();
  saveState();
  toast('설정을 저장했어요');
}

const THEME_LABEL = { system: '🖥 화면 모드: 시스템', light: '☀️ 화면 모드: 라이트', dark: '🌙 화면 모드: 다크' };
function applyTheme() {
  const t = state.settings.theme || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  if (typeof applyColors === 'function') applyColors(); // 백업 불러오기·초기화 때도 색상 반영
}
function renderThemeToggle() { $('#themeToggle').textContent = THEME_LABEL[state.settings.theme || 'system']; }
function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  state.settings.theme = order[(order.indexOf(state.settings.theme || 'system') + 1) % 3];
  applyTheme();
  saveState();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `workplanner-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.events)) throw new Error('형식 오류');
      if (!confirm(`일정 ${data.events.length}건, 행사 ${(data.projects || []).length}건이 담긴 백업이에요. 현재 데이터를 덮어쓸까요?`)) return;
      state = normalizeState(data);
      applyTheme();
      saveState();
      fillSettingsForm();
      toast('백업을 불러왔어요');
    } catch {
      alert('백업 파일을 읽을 수 없어요.');
    }
  };
  reader.readAsText(file);
}
function resetData() {
  if (!confirm('모든 일정·행사·설정이 삭제돼요. 먼저 백업하셨나요? 정말 초기화할까요?')) return;
  state = normalizeState();
  applyTheme();
  saveState();
  fillSettingsForm();
  toast('초기화했어요');
}

/* ===== 16. 자동 저장 (PC 파일) ===== */
const FileSync = { handle: null, status: 'off', lastSaved: null };
const fsSupported = () => typeof window.showSaveFilePicker === 'function';

function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('workPlanner', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbReq(mode, fn) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const req = fn(db.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const idbGet = (k) => idbReq('readonly', (s) => s.get(k));
const idbSet = (k, v) => idbReq('readwrite', (s) => s.put(v, k));
const idbDel = (k) => idbReq('readwrite', (s) => s.delete(k));

async function writeFile() {
  if (!FileSync.handle) return;
  try {
    const perm = await FileSync.handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { FileSync.status = 'need-permission'; renderSyncStatus(); return; }
    const w = await FileSync.handle.createWritable();
    await w.write(JSON.stringify(state, null, 2));
    await w.close();
    FileSync.status = 'ok';
    FileSync.lastSaved = new Date();
  } catch (e) {
    console.warn('자동 저장 실패', e);
    FileSync.status = 'error';
  }
  renderSyncStatus();
}
let fileSaveTimer;
function scheduleFileSave() {
  if (FileSync.status !== 'ok') return;
  clearTimeout(fileSaveTimer);
  fileSaveTimer = setTimeout(writeFile, 400);
}

/** 파일 내용과 브라우저 데이터를 맞춤 */
async function reconcileWithFile(h) {
  try {
    const text = await (await h.getFile()).text();
    if (text.trim()) {
      const data = normalizeState(JSON.parse(text));
      if (JSON.stringify(data) !== JSON.stringify(state)) {
        const localEmpty = !state.events.length && !state.projects.length;
        const useFile = localEmpty || confirm(
          `파일(${h.name})과 브라우저의 데이터가 달라요.\n\n` +
          `[확인] 파일 내용 불러오기 (일정 ${data.events.length}건 · 행사 ${data.projects.length}건)\n` +
          `[취소] 지금 브라우저 데이터로 파일 덮어쓰기 (일정 ${state.events.length}건 · 행사 ${state.projects.length}건)`);
        if (useFile) {
          state = data;
          persist();
          applyTheme();
          fillSettingsForm();
          renderAll();
        }
      }
    }
  } catch (e) {
    console.warn('파일을 읽지 못했어요', e);
  }
  await writeFile();
}
async function syncNew() {
  try {
    const h = await window.showSaveFilePicker({ suggestedName: 'my-planner-data.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
    FileSync.handle = h;
    await idbSet('fileHandle', h);
    await writeFile();
    toast(`'${h.name}'에 자동 저장을 시작해요`);
  } catch (e) { if (e.name !== 'AbortError') alert('파일을 연결하지 못했어요: ' + e.message); }
}
async function syncOpen() {
  try {
    const [h] = await window.showOpenFilePicker({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
    const perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return toast('쓰기 권한이 필요해요');
    FileSync.handle = h;
    await idbSet('fileHandle', h);
    await reconcileWithFile(h);
    toast(`'${h.name}'과 연결했어요`);
  } catch (e) { if (e.name !== 'AbortError') alert('파일을 연결하지 못했어요: ' + e.message); }
}
async function syncReconnect() {
  const h = FileSync.handle;
  if (!h) return switchView('settings');
  try {
    const perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return toast('권한이 허용되지 않았어요');
    await reconcileWithFile(h);
    renderAll();
    toast('자동 저장을 다시 시작했어요');
  } catch (e) { alert('다시 연결하지 못했어요: ' + e.message); }
}
async function syncOff() {
  if (!confirm('자동 저장 연결을 해제할까요? (파일은 지워지지 않아요)')) return;
  FileSync.handle = null;
  FileSync.status = 'off';
  try { await idbDel('fileHandle'); } catch {}
  renderAll();
}
async function initFileSync() {
  if (!fsSupported()) { FileSync.status = 'unsupported'; return renderSyncStatus(); }
  try {
    const h = await idbGet('fileHandle');
    if (!h) { FileSync.status = 'off'; return renderSyncStatus(); }
    FileSync.handle = h;
    const perm = await h.queryPermission({ mode: 'readwrite' });
    FileSync.status = perm === 'granted' ? 'ok' : 'need-permission';
  } catch (e) {
    console.warn(e);
    FileSync.status = 'off';
  }
  renderAll();
}
function renderSyncStatus() {
  const s = FileSync.status;
  const time = FileSync.lastSaved ? `${pad(FileSync.lastSaved.getHours())}:${pad(FileSync.lastSaved.getMinutes())}` : '';
  const btn = $('#syncStatus');
  const label = {
    ok: `💾 자동 저장됨${time ? ` ${time}` : ''}`,
    'need-permission': '⚠️ 자동 저장 다시 연결',
    error: '⚠️ 자동 저장 오류',
    off: '💾 자동 저장 꺼짐',
    unsupported: '💾 자동 저장 미지원',
  }[s];
  btn.textContent = label;
  btn.classList.toggle('warn', s === 'need-permission' || s === 'error');

  const name = FileSync.handle ? esc(FileSync.handle.name) : '';
  const panel = {
    unsupported: '<div class="muted">이 브라우저에서는 쓸 수 없어요. 크롬이나 엣지에서 열어 주세요.</div>',
    off: `<div class="btn-row">
        <button class="btn primary" data-action="sync-new">새 파일로 시작</button>
        <button class="btn" data-action="sync-open">기존 파일 연결</button></div>`,
    'need-permission': `<p>연결된 파일: <b>${name}</b><br><span class="muted">브라우저를 다시 열면 권한을 한 번 더 허용해야 해요.</span></p>
        <div class="btn-row"><button class="btn primary" data-action="sync-reconnect">다시 연결</button><button class="btn" data-action="sync-off">연결 해제</button></div>`,
    error: `<p>⚠️ <b>${name}</b>에 저장하지 못했어요. 파일이 옮겨졌거나 지워졌을 수 있어요.</p>
        <div class="btn-row"><button class="btn primary" data-action="sync-reconnect">다시 연결</button><button class="btn" data-action="sync-new">새 파일로 시작</button><button class="btn" data-action="sync-off">연결 해제</button></div>`,
    ok: `<p>✅ <b>${name}</b>에 자동 저장 중${time ? ` · 마지막 저장 ${time}` : ''}</p>
        <div class="btn-row"><button class="btn" data-action="sync-now">지금 저장</button><button class="btn" data-action="sync-off">연결 해제</button></div>`,
  }[s];
  $('#syncPanel').innerHTML = panel;
}

/* ===== 17. 이벤트 연결 & 시작 ===== */
const ACTIONS = {
  'add-project': () => openProjectDialog(),
  'goto-bridge': () => { switchView('leave'); setTimeout(() => $('#bridgeCard').scrollIntoView({ behavior: 'smooth' }), 50); },
  'register-bridge': (el) => registerBridge(el.dataset.days.split(',')),
  'toggle-bridges': () => { ui.bridgeAll = !ui.bridgeAll; renderBridges(); },
  'sync-new': syncNew,
  'sync-open': syncOpen,
  'sync-reconnect': syncReconnect,
  'sync-now': async () => { await writeFile(); toast('저장했어요'); },
  'sync-off': syncOff,
  'cloud-login': () => window.CloudSync?.login?.(),
  'cloud-logout': () => window.CloudSync?.logout?.(),
};

function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('dialog')) return;

    const act = t.closest('[data-action]');
    if (act) return ACTIONS[act.dataset.action]?.(act);

    const tab = t.closest('.tabs [data-view]');
    if (tab) return switchView(tab.dataset.view);

    const go = t.closest('[data-goto]');
    if (go) return switchView(go.dataset.goto);

    const nav = t.closest('[data-nav]');
    if (nav) return moveCalendar(nav.dataset.nav, Number(nav.dataset.dir));

    const more = t.closest('[data-more]');
    if (more) {
      const d = fromKey(more.dataset.more);
      ui.calMonth = { y: d.getFullYear(), m: d.getMonth() };
      ui.weekStart = weekStartOf(more.dataset.more);
      return switchView('calendar');
    }

    const proj = t.closest('[data-pid]');
    if (proj) return openProjectDialog(proj.dataset.pid);

    const item = t.closest('[data-id]');
    if (item) return openEventDialog({ id: item.dataset.id, occ: item.dataset.date });

    const col = t.closest('.wcol');
    if (col) {
      const r = col.getBoundingClientRect();
      const hour = Math.min(23, WEEK_START_HOUR + Math.floor((e.clientY - r.top) / HOUR_PX));
      return openEventDialog({ date: col.dataset.date, time: `${pad(hour)}:00`, endTime: hour < 23 ? `${pad(hour + 1)}:00` : '' });
    }

    const day = t.closest('[data-date]');
    if (day && day.closest('.calendar')) return openEventDialog({ date: day.dataset.date });
  });

  $('#quickAdd').addEventListener('click', () => openEventDialog());
  $('#addWeekend').addEventListener('click', () => openEventDialog({ category: 'company', earn: 1, title: '주말근무' }));
  $('#addProject').addEventListener('click', () => openProjectDialog());

  // 일정 팝업
  $('#eventForm').addEventListener('submit', submitEvent);
  $('#eventForm').addEventListener('input', syncEventDialog);
  $('#eventForm').addEventListener('change', (e) => {
    if (e.target.name === 'category' && e.target.value === 'project') return switchEventToProject();
    syncEventDialog();
  });
  $('#projectDialog').addEventListener('close', () => { convertEventId = null; });
  // 행사 날짜가 바뀌면 적립 목록 갱신, 날짜별 적립 선택
  $('#projectForm').addEventListener('change', (e) => {
    const k = e.target.dataset?.ed;
    if (k) {
      const v = Number(e.target.value);
      if (v > 0) earnDraft[k] = v; else delete earnDraft[k];
      return renderEarnList();
    }
    if (/(Start|End)$/.test(e.target.name || '')) renderEarnList();
  });
  $('#deleteBtn').addEventListener('click', deleteEvent);
  $('#skipBtn').addEventListener('click', skipOccurrence);

  // 행사 팝업
  $('#projectForm').addEventListener('submit', submitProject);
  $('#projDeleteBtn').addEventListener('click', deleteProject);
  $('#todoAddBtn').addEventListener('click', addTodo);
  $('#todoInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTodo(); } });
  $('#todoList').addEventListener('change', (e) => {
    const i = e.target.dataset.ti;
    if (i !== undefined) { todoDraft[i].done = e.target.checked; renderTodos(); }
  });
  $('#todoList').addEventListener('click', (e) => {
    const i = e.target.dataset.tdel;
    if (i !== undefined) { todoDraft.splice(Number(i), 1); renderTodos(); }
  });

  // 팝업 공통: 취소 버튼, 바깥 클릭 시 닫기
  $$('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  });

  // 캘린더
  $('#fCompany').addEventListener('change', renderCalendar);
  $('#fPersonal').addEventListener('change', renderCalendar);
  $('#fProject').addEventListener('change', renderCalendar);
  $('#calMode').addEventListener('change', (e) => setCalMode(e.target.value));

  // 행사 · 리포트 · 검색
  $('#projFilter').addEventListener('change', (e) => { ui.projFilter = e.target.value; renderProjects(); });
  $('#reportYear').addEventListener('change', (e) => { ui.reportYear = Number(e.target.value); renderReport(); });
  $('#searchInput').addEventListener('input', (e) => { ui.search = e.target.value; renderSearch(); });
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]');
    if (e.key === '/' && !typing) { e.preventDefault(); switchView('search'); }
  });

  // 설정
  $('#settingsForm').addEventListener('submit', submitSettings);
  $('#exportBtn').addEventListener('click', exportData);
  $('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('#resetBtn').addEventListener('click', resetData);
  $('#themeToggle').addEventListener('click', cycleTheme);
  // 기본 색상: 고르는 즉시 미리보기, 저장을 눌러야 확정
  $('#settingsForm').addEventListener('input', (e) => { if (e.target.name?.startsWith('c_')) applyColors(colorsFromForm()); });
  $('#resetColors').addEventListener('click', () => {
    const F = $('#settingsForm').elements;
    Object.keys(DEFAULT_COLORS).forEach((k) => { F['c_' + k].value = DEFAULT_COLORS[k]; });
    applyColors({});
    toast('기본 색상으로 되돌렸어요. 저장을 눌러 확정하세요');
  });
  // 일정 색상: 직접 고르기
  $('#evSwatches').addEventListener('input', (e) => {
    if (e.target.id !== 'evColorPicker') return;
    const radio = e.target.parentElement.querySelector('input[type="radio"]');
    radio.value = e.target.value;
    radio.checked = true;
  });
  // 창 크기가 바뀌면 달력 칸에 들어가는 줄 수를 다시 계산
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderHome(); renderCalendar(); }, 150); });
  $('#cloudStatus').addEventListener('click', () => {
    if (window.CloudSync?.status === 'signed-out') window.CloudSync.login();
    else switchView('settings');
  });
  $('#syncStatus').addEventListener('click', () => {
    if (FileSync.status === 'need-permission' || FileSync.status === 'error') syncReconnect();
    else switchView('settings');
  });

  bindDrag();

  // 자정이 지나면 '오늘' 기준 갱신, 주간 보기의 현재 시각 선 갱신
  let lastDay = todayKey();
  setInterval(() => {
    if (todayKey() !== lastDay) { lastDay = todayKey(); renderAll(); }
    else if (ui.currentView === 'calendar' && ui.calMode === 'week') renderCalendar();
  }, 60 * 1000);
}

applyTheme();
applyColors();
bindEvents();
fillSettingsForm();
renderAll();
initFileSync();
