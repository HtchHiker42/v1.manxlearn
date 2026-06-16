/* ── API client — all communication with the backend ──────────────────────── */
'use strict';

const API = (() => {
  async function req(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  return {
    // Auth
    me:       ()          => req('GET',  '/api/auth/me').catch(() => null),
    login:    (u, p)      => req('POST', '/api/auth/login',    { username: u, password: p }),
    register: (u, p, r)   => req('POST', '/api/auth/register', { username: u, password: p, role: r }),
    logout:   ()          => req('POST', '/api/auth/logout'),

    // Curriculum
    curriculum: () => req('GET', '/api/curriculum'),

    // Progress
    getProgress:     ()           => req('GET',  '/api/progress'),
    completeLesson:  (uid, lid)   => req('POST', '/api/progress/lesson', { unitId: uid, lessonId: lid }),
    recordTestScore: (uid, score) => req('POST', '/api/progress/test',   { unitId: uid, score }),

    // Student classroom
    studentClassroom: () => req('GET', '/api/student/classroom').catch(() => null),
    joinClassroom:    (code) => req('POST', '/api/classrooms/join', { inviteCode: code }),

    // Teacher
    getClassrooms:        ()           => req('GET',  '/api/classrooms'),
    createClassroom:      (name)       => req('POST', '/api/classrooms', { name }),
    getClassroomDetail:   (id)         => req('GET',  `/api/classrooms/${id}`),
    getClassroomProgress: (id)         => req('GET',  `/api/classrooms/${id}/progress`),
    getAssignments:       ()           => req('GET',  '/api/assignments'),
    createAssignment:     (data)       => req('POST', '/api/assignments', data),
    teacherOverview:      ()           => req('GET',  '/api/teacher/overview'),
  };
})();

/* ── Shared nav — shows @username when logged in ──────────────────────────── */
async function initNav(expectRole) {
  const data = await API.me();
  const navRight = document.getElementById('nav-right');
  if (!navRight) return data;

  if (data?.user) {
    const { username, role } = data.user;
    const dash = role === 'teacher' ? '/teacher.html' : '/student.html';
    navRight.innerHTML = `
      <div class="user-chip">
        <div class="avatar">${username[0].toUpperCase()}</div>
        <span class="uname">@${username}</span>
      </div>
      ${window.location.pathname.includes('index') || window.location.pathname === '/'
        ? `<a class="btn btn-outline btn-sm" href="${dash}">My Portal →</a>` : ''}
    `;
    // If on wrong portal redirect
    if (expectRole && role !== expectRole) {
      const target = role === 'teacher' ? '/teacher.html' : '/student.html';
      window.location.href = target;
      return null;
    }
  } else if (expectRole) {
    // Not logged in but on a portal page — redirect to index
    // (portals handle their own login screen so we don't redirect)
  }
  return data;
}

/* ── Toast ────────────────────────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

/* ── Confetti ─────────────────────────────────────────────────────────────── */
function launchConfetti() {
  const colors = ['#2563EB','#F59E0B','#EC4899','#10B981','#a855f7'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `left:${Math.random()*100}vw;top:0;background:${colors[Math.floor(Math.random()*colors.length)]};border-radius:${Math.random()>.5?'50%':'2px'};animation-delay:${Math.random()}s;animation-duration:${1.5+Math.random()*1.5}s`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}
