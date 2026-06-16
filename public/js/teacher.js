'use strict';
/* ── State ──────────────────────────────────────────────────────────────────*/
let T = { user: null, overview: [], activeClsId: null };

/* ── Boot ───────────────────────────────────────────────────────────────────*/
window.addEventListener('DOMContentLoaded', async () => {
  const nav = await initNav('teacher');
  if (nav?.user) {
    T.user = nav.user;
    await loadOverview();
    enterTeacher();
  }
  // else: login form is already visible
});

async function loadOverview() {
  T.overview = await API.teacherOverview().catch(() => []);
}

/* ── Auth ────────────────────────────────────────────────────────────────────*/
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === (tab === 'login' ? 0 : 1)));
  document.getElementById('form-login-t').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-reg-t').classList.toggle('hidden', tab !== 'register');
  document.getElementById('t-err').classList.remove('show');
}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-tlogin');
  const u = document.getElementById('tl-user').value.trim();
  const p = document.getElementById('tl-pass').value;
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    const res = await API.login(u, p);
    if (res.user.role !== 'teacher') throw new Error('This account is not a teacher account');
    T.user = res.user;
    await loadOverview();
    enterTeacher();
  } catch (err) {
    showErr('t-err', err.message);
    btn.disabled = false; btn.textContent = 'Log In as Teacher';
  }
}

async function doRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-treg');
  const u = document.getElementById('tr-user').value.trim();
  const p = document.getElementById('tr-pass').value;
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const res = await API.register(u, p, 'teacher');
    T.user = res.user;
    T.overview = [];
    enterTeacher();
  } catch (err) {
    showErr('t-err', err.message);
    btn.disabled = false; btn.textContent = 'Create Teacher Account';
  }
}

async function doLogout() {
  await API.logout();
  window.location.reload();
}

/* ── Shell ───────────────────────────────────────────────────────────────────*/
function enterTeacher() {
  document.getElementById('view-login-t').classList.add('hidden');
  document.getElementById('t-shell').classList.remove('hidden');
  // Update sidebar user info
  document.getElementById('t-sidebar-user').textContent = '@' + T.user.username;
  // Update nav chip
  const navRight = document.getElementById('nav-right');
  if (navRight && !navRight.querySelector('.user-chip')) {
    navRight.innerHTML = `<div class="user-chip"><div class="avatar">${T.user.username[0].toUpperCase()}</div><span class="uname">@${T.user.username}</span></div>`;
  }
  showPage('dashboard');
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'dashboard') renderDashboard();
  if (name === 'classrooms') renderClassrooms();
  if (name === 'assignments') renderAssignments();
  if (name === 'progress') renderProgressSetup();
}

/* ── Dashboard ───────────────────────────────────────────────────────────────*/
function renderDashboard() {
  const h = new Date().getHours();
  document.getElementById('dash-greeting').textContent =
    (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', @' + T.user.username + '!';

  const allStudents = new Set(T.overview.flatMap(cls => cls.students.map(s => s.id)));
  const allScores   = T.overview.flatMap(cls => cls.students.flatMap(s => s.testScores));

  document.getElementById('stat-row').innerHTML = [
    { icon:'🏫', label:'Classrooms', num: T.overview.length, cls:'blue' },
    { icon:'👩‍🎓', label:'Students',   num: allStudents.size, cls:'yellow' },
    { icon:'📝', label:'Tests Taken', num: allScores.length, cls:'green' }
  ].map(s => `
    <div class="stat-card">
      <div class="stat-icon ${s.cls}">${s.icon}</div>
      <div class="stat-body"><div class="num">${s.num}</div><div class="lbl">${s.label}</div></div>
    </div>`).join('');

  // Classrooms quick list
  const dcls = document.getElementById('dash-classrooms');
  if (!T.overview.length) {
    dcls.innerHTML = `<div class="card"><div class="empty-state"><span class="ei">🏫</span><h3>No classrooms yet</h3><p>Create one on the Classrooms page!</p></div></div>`;
  } else {
    dcls.innerHTML = T.overview.map(cls => `
      <div class="card" style="margin-bottom:10px;cursor:pointer" onclick="openClassDetail('${cls.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-family:var(--font-h);font-weight:800;font-size:.95rem">${cls.name}</div>
            <div style="font-size:.8rem;color:#64748b">${cls.studentCount} students · Code: <strong style="letter-spacing:.05em">${cls.inviteCode}</strong></div>
          </div>
          <span style="font-size:1.1rem;color:#94a3b8">→</span>
        </div>
      </div>`).join('');
  }

  // Recent test activity
  const acts = T.overview.flatMap(cls =>
    cls.students.flatMap(s => s.testScores.map(t => ({ ...t, username: s.username })))
  ).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  const actEl = document.getElementById('dash-activity');
  if (!acts.length) {
    actEl.innerHTML = '<div class="empty-state" style="padding:20px"><span class="ei">📊</span><p>No test activity yet</p></div>';
  } else {
    actEl.innerHTML = `<table class="data-table" style="width:100%">
      <thead><tr><th>Student</th><th>Unit</th><th>Score</th><th>Date</th></tr></thead>
      <tbody>${acts.map(a => {
        const pillCls = a.score >= 80 ? 'high' : a.score >= 60 ? 'mid' : 'low';
        const unit = UNIT_LABELS[a.unitId] || a.unitId;
        return `<tr>
          <td style="font-family:var(--font-h);font-weight:700">@${a.username}</td>
          <td>${unit}</td>
          <td><span class="score-pill ${pillCls}">${a.score}%</span></td>
          <td style="color:#94a3b8;font-size:.8rem">${a.date}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }
}

const UNIT_LABELS = { unit1:'👋 Greetings', unit2:'🔢 Numbers', unit3:'🎨 Colours' };

/* ── Classrooms ──────────────────────────────────────────────────────────────*/
function renderClassrooms() {
  const grid = document.getElementById('classrooms-grid');
  if (!T.overview.length) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="empty-state"><span class="ei">🏫</span><h3>No classrooms yet</h3><p>Create your first classroom!</p></div></div>`;
    return;
  }
  grid.innerHTML = T.overview.map(cls => `
    <div class="classroom-card" onclick="openClassDetail('${cls.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
        <div class="cls-card-icon">🏫</div>
        <span class="invite-badge">${cls.inviteCode}</span>
      </div>
      <h3 style="font-family:var(--font-h);font-size:1.05rem;font-weight:800;margin-bottom:5px">${cls.name}</h3>
      <p style="font-size:.82rem;color:#64748b;margin-bottom:14px">👩‍🎓 ${cls.studentCount} students</p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openClassDetail('${cls.id}')">View Class</button>
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();copyCode('${cls.inviteCode}')">📋 Copy Code</button>
      </div>
    </div>`).join('');
}

async function openClassDetail(clsId) {
  T.activeClsId = clsId;
  const cls = T.overview.find(c => c.id === clsId);
  if (!cls) return;

  document.getElementById('cls-detail-name').textContent = cls.name;
  document.getElementById('cls-invite-code').textContent = cls.inviteCode;

  // Students
  const stuList = document.getElementById('cls-students-list');
  if (!cls.students.length) {
    stuList.innerHTML = `<div class="empty-state" style="padding:18px"><span class="ei">👩‍🎓</span><h3>No students yet</h3><p>Share code <strong>${cls.inviteCode}</strong></p></div>`;
  } else {
    stuList.innerHTML = cls.students.map(s => {
      const xp = s.totalXP;
      return `<div class="student-row" onclick="openStuDetail('${s.id}','${clsId}')">
        <div class="stu-avatar">${s.username[0].toUpperCase()}</div>
        <div style="flex:1"><div style="font-family:var(--font-h);font-weight:700;font-size:.92rem">@${s.username}</div></div>
        <span class="score-pill mid">⭐ ${xp} XP</span>
      </div>`;
    }).join('');
  }

  // Assignments
  const cls2 = await API.getClassroomDetail(clsId);
  const asgnEl = document.getElementById('cls-assignments-list');
  if (!cls2.assignments?.length) {
    asgnEl.innerHTML = `<div class="empty-state" style="padding:18px"><span class="ei">📋</span><h3>No assignments yet</h3></div>`;
  } else {
    asgnEl.innerHTML = `<table class="data-table" style="width:100%">
      <thead><tr><th>Title</th><th>Unit</th><th>Due</th></tr></thead>
      <tbody>${cls2.assignments.map(a => `<tr>
        <td style="font-family:var(--font-h);font-weight:700">${a.title}</td>
        <td>${UNIT_LABELS[a.unit_id] || a.unit_id}</td>
        <td style="color:#64748b">${a.due_date}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  // Pre-fill assignment modal with this classroom
  const sel = document.getElementById('nasgn-cls');
  if (sel) sel.value = clsId;

  showPage('cls-detail');
}

function openStuDetail(stuId, clsId) {
  const cls = T.overview.find(c => c.id === clsId);
  const stu = cls?.students.find(s => s.id === stuId);
  if (!stu) return;

  document.getElementById('stu-detail-name').textContent = '@' + stu.username;
  document.getElementById('stu-back-btn').onclick = () => openClassDetail(clsId);

  document.getElementById('stu-stats-row').innerHTML = [
    { num: stu.totalXP + ' XP', lbl:'Total XP', icon:'⭐', cls:'yellow' },
    { num: stu.testScores.length, lbl:'Tests Taken', icon:'📝', cls:'green' }
  ].map(s => `
    <div class="stat-card">
      <div class="stat-icon ${s.cls}">${s.icon}</div>
      <div class="stat-body"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>
    </div>`).join('');

  document.getElementById('stu-unit-progress').innerHTML = Object.entries(UNIT_LABELS).map(([uid, label]) => {
    const prog = stu.progress.find(p => p.unitId === uid);
    const done = prog?.lessonsCompleted.length || 0;
    const total = { unit1:3, unit2:3, unit3:3 }[uid] || 3;
    const pct = Math.round(done / total * 100);
    return `<div class="unit-progress-row">
      <span style="font-size:1.1rem;width:24px;text-align:center;flex-shrink:0">${label.split(' ')[0]}</span>
      <span style="font-family:var(--font-h);font-weight:700;font-size:.86rem;flex:1">${label.split(' ').slice(1).join(' ')}</span>
      <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="unit-pct">${pct}%</span>
    </div>`;
  }).join('');

  document.getElementById('stu-test-tbody').innerHTML = Object.entries(UNIT_LABELS).map(([uid, label]) => {
    const scores = stu.testScores.filter(s => s.unitId === uid);
    const best = scores.length ? Math.max(...scores.map(s => s.score)) : null;
    const last = scores.length ? scores[0].score : null;
    const pill = s => s >= 80 ? 'high' : s >= 60 ? 'mid' : 'low';
    return `<tr>
      <td>${label}</td>
      <td>${scores.length}</td>
      <td>${best !== null ? `<span class="score-pill ${pill(best)}">${best}%</span>` : '<span class="score-pill none">—</span>'}</td>
      <td>${last !== null ? `<span class="score-pill ${pill(last)}">${last}%</span>` : '<span class="score-pill none">—</span>'}</td>
    </tr>`;
  }).join('');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-stu-detail').classList.add('active');
  window.scrollTo(0, 0);
}

/* ── Assignments ─────────────────────────────────────────────────────────────*/
function renderAssignments() {
  const allAsgns = T.overview.flatMap(cls =>
    (cls.assignments || []).map(a => ({ ...a, clsName: cls.name }))
  );
  const tbody = document.getElementById('assignments-tbody');
  if (!allAsgns.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:28px;font-family:var(--font-h)">No assignments yet</td></tr>`;
    return;
  }
  tbody.innerHTML = allAsgns.map(a => `<tr>
    <td style="font-family:var(--font-h);font-weight:700">${a.title}</td>
    <td>${a.clsName}</td>
    <td>${UNIT_LABELS[a.unit_id] || a.unit_id}</td>
    <td style="color:#64748b">${a.due_date}</td>
  </tr>`).join('');
}

/* ── Progress overview ───────────────────────────────────────────────────────*/
function renderProgressSetup() {
  const sel = document.getElementById('prog-cls-select');
  sel.innerHTML = '<option value="">— Choose a classroom —</option>';
  T.overview.forEach(cls => {
    const opt = document.createElement('option'); opt.value = cls.id; opt.textContent = cls.name; sel.appendChild(opt);
  });
}

function renderProgressTable() {
  const clsId = document.getElementById('prog-cls-select').value;
  const wrap = document.getElementById('progress-table-wrap');
  if (!clsId) { wrap.innerHTML = '<div class="empty-state"><span class="ei">📊</span><h3>Select a classroom</h3></div>'; return; }
  const cls = T.overview.find(c => c.id === clsId);
  if (!cls?.students.length) { wrap.innerHTML = '<div class="empty-state"><span class="ei">👩‍🎓</span><h3>No students yet</h3><p>Share code <strong>' + cls.inviteCode + '</strong></p></div>'; return; }

  const unitCols = Object.entries(UNIT_LABELS).map(([, l]) => `<th>${l}</th>`).join('');
  const rows = cls.students.map(s => {
    const unitCells = Object.keys(UNIT_LABELS).map(uid => {
      const prog = s.progress.find(p => p.unitId === uid);
      const scores = s.testScores.filter(t => t.unitId === uid);
      const best = scores.length ? Math.max(...scores.map(t => t.score)) : null;
      const done = prog?.lessonsCompleted.length || 0;
      const pct = Math.round(done / 3 * 100);
      const pillCls = best === null ? 'none' : best >= 80 ? 'high' : best >= 60 ? 'mid' : 'low';
      return `<td><div style="display:flex;align-items:center;gap:6px">
        <div class="progress-mini"><div class="progress-mini-fill" style="width:${pct}%"></div></div>
        ${best !== null ? `<span class="score-pill ${pillCls}" style="font-size:.73rem;padding:2px 6px">${best}%</span>` : '<span style="color:#cbd5e1;font-size:.78rem">—</span>'}
      </div></td>`;
    }).join('');
    return `<tr onclick="openStuDetail('${s.id}','${clsId}')">
      <td><div style="display:flex;align-items:center;gap:8px">
        <div class="stu-avatar" style="width:28px;height:28px;font-size:.75rem">${s.username[0].toUpperCase()}</div>
        <span style="font-family:var(--font-h);font-weight:700;font-size:.88rem">@${s.username}</span>
      </div></td>
      <td><span class="score-pill mid" style="font-size:.78rem">⭐ ${s.totalXP}</span></td>
      ${unitCells}
    </tr>`;
  }).join('');

  wrap.innerHTML = `<div style="overflow-x:auto"><table class="data-table" style="width:100%;min-width:540px">
    <thead><tr><th>Student</th><th>XP</th>${unitCols}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/* ── Modals ──────────────────────────────────────────────────────────────────*/
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeBd(e, id) { if (e.target.id === id) closeModal(id); }

async function submitNewClass(e) {
  e.preventDefault();
  const name = document.getElementById('ncls-name').value.trim();
  if (!name) return;
  try {
    await API.createClassroom(name);
    await loadOverview();
    closeModal('modal-new-class');
    document.getElementById('ncls-name').value = '';
    populateClsSelects();
    renderClassrooms();
    showToast('🏫 Classroom created!');
  } catch (err) { showErr('ncls-err', err.message); }
}

async function submitNewAsgn(e) {
  e.preventDefault();
  const title = document.getElementById('nasgn-title').value.trim();
  const classroomId = document.getElementById('nasgn-cls').value;
  const unitId = document.getElementById('nasgn-unit').value;
  const dueDate = document.getElementById('nasgn-due').value;
  if (!title || !classroomId || !unitId || !dueDate) return;
  try {
    await API.createAssignment({ classroomId, unitId, title, dueDate });
    await loadOverview();
    closeModal('modal-new-asgn');
    document.getElementById('nasgn-title').value = '';
    document.getElementById('nasgn-due').value = '';
    if (T.activeClsId) openClassDetail(T.activeClsId);
    renderAssignments();
    showToast('📋 Assignment set!');
  } catch (err) { showErr('nasgn-err', err.message); }
}

function populateClsSelects() {
  const sels = [document.getElementById('nasgn-cls')].filter(Boolean);
  sels.forEach(sel => {
    sel.innerHTML = '<option value="">— Choose classroom —</option>';
    T.overview.forEach(c => {
      const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; sel.appendChild(opt);
    });
  });
}

function copyCode(code) {
  navigator.clipboard.writeText(code).then(() => showToast('✅ Code copied!')).catch(() => showToast('Code: ' + code));
}

/* ── Helpers ─────────────────────────────────────────────────────────────────*/
function showErr(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('show'); } }
