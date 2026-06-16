'use strict';
/* ── State ──────────────────────────────────────────────────────────────────*/
let S = {
  user: null, curriculum: null, progress: [], classroom: null,
  activeUnit: null, activeLesson: null,
  matchSel: { left: null, right: null }, matchPairs: [], matchDone: [],
  patternIdx: 0, patternAnswered: false,
  testQuestions: [], testIdx: 0, testAnswers: [], testUnitId: null
};

/* ── Boot ───────────────────────────────────────────────────────────────────*/
window.addEventListener('DOMContentLoaded', async () => {
  const nav = await initNav('student');
  if (nav?.user) {
    S.user = nav.user;
    await loadData();
    enterApp();
  } else {
    showView('login');
  }
});

async function loadData() {
  [S.curriculum, S.progress, S.classroom] = await Promise.all([
    API.curriculum(),
    API.getProgress(),
    API.studentClassroom()
  ]);
}

function getProgress(unitId) {
  return S.progress.find(p => p.unitId === unitId) || { unitId, lessonsCompleted: [], testScores: [], xp: 0 };
}

/* ── Auth ───────────────────────────────────────────────────────────────────*/
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === (tab === 'login' ? 0 : 1)));
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('auth-err').classList.remove('show');
}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-login');
  const u = document.getElementById('l-username').value.trim();
  const p = document.getElementById('l-password').value;
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    const res = await API.login(u, p);
    S.user = res.user;
    await loadData();
    enterApp();
  } catch (err) {
    showErr('auth-err', err.message);
    btn.disabled = false; btn.textContent = 'Log In';
  }
}

async function doRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-register');
  const u = document.getElementById('r-username').value.trim();
  const p = document.getElementById('r-password').value;
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const res = await API.register(u, p, 'student');
    S.user = res.user;
    S.curriculum = await API.curriculum();
    S.progress = []; S.classroom = null;
    enterApp();
  } catch (err) {
    showErr('auth-err', err.message);
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

async function doLogout() {
  await API.logout();
  window.location.reload();
}

/* ── App shell ──────────────────────────────────────────────────────────────*/
function enterApp() {
  document.getElementById('s-topbar').classList.remove('hidden');
  renderXPDisplay();
  renderHome();
  showView('home');
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

function renderXPDisplay() {
  const total = S.progress.reduce((n, p) => n + (p.xp || 0), 0);
  const xpEl = document.getElementById('xp-display');
  if (xpEl) xpEl.textContent = `⭐ ${total} XP`;
}

/* ── Home ───────────────────────────────────────────────────────────────────*/
function renderHome() {
  // Greeting
  const h = new Date().getHours();
  const greet = h < 12 ? 'Moghrey mie' : h < 18 ? 'Fastyr mie' : 'Oie vie';
  document.getElementById('home-greeting').textContent = `${greet}, @${S.user.username}!`;

  // XP
  const total = S.progress.reduce((n, p) => n + (p.xp || 0), 0);
  document.getElementById('xp-display').textContent = `⭐ ${total} XP`;
  document.getElementById('xp-bar').style.width = Math.min(100, (total % 300) / 3) + '%';
  document.getElementById('xp-label').textContent = `${total % 300} / 300 XP to next level`;

  // Classroom banner / join form
  const clsBanner = document.getElementById('classroom-banner');
  const joinBanner = document.getElementById('join-banner');
  if (S.classroom) {
    clsBanner.classList.remove('hidden');
    document.getElementById('cls-name-banner').textContent = S.classroom.name;
    joinBanner.style.display = 'none';
    // Assignments
    const asgnStrip = document.getElementById('asgn-strip');
    if (S.classroom.assignments?.length) {
      asgnStrip.classList.remove('hidden');
      document.getElementById('asgn-content').innerHTML = S.classroom.assignments
        .map(a => `<p>📝 <strong>${a.title}</strong> — due ${a.due_date}</p>`).join('');
    } else {
      asgnStrip.classList.add('hidden');
    }
  } else {
    clsBanner.classList.add('hidden');
    joinBanner.style.display = 'block';
  }

  // Journey
  const journey = document.getElementById('unit-journey');
  journey.innerHTML = '';
  S.curriculum.forEach((unit, idx) => {
    const prog = getProgress(unit.id);
    const done = prog.lessonsCompleted.length;
    const total = unit.lessons.length;
    const pct = Math.round((done / total) * 100);
    const hasTest = prog.testScores?.length > 0;
    const isComplete = done >= total && hasTest;
    const isUnlocked = idx === 0 || (() => {
      const prev = getProgress(S.curriculum[idx - 1].id);
      return (prev.lessonsCompleted || []).length >= S.curriculum[idx - 1].lessons.length;
    })();

    if (idx > 0) journey.insertAdjacentHTML('beforeend', '<div class="journey-connector"></div>');

    const dots = unit.lessons.map((l, li) => {
      const d = prog.lessonsCompleted.includes(l.id);
      const cur = !d && li === done;
      return `<div class="dot ${d ? 'done' : cur ? 'current' : ''}"></div>`;
    }).join('');

    journey.insertAdjacentHTML('beforeend', `
      <div class="unit-node">
        <div class="unit-card ${!isUnlocked ? 'locked' : ''} ${isUnlocked && !isComplete ? 'active-unit' : ''}"
             onclick="${isUnlocked ? `openUnit('${unit.id}')` : ''}">
          ${isComplete ? '<div class="unit-badge">✓ Complete</div>' : ''}
          <span class="unit-emoji">${!isUnlocked ? '🔒' : unit.emoji}</span>
          <div class="unit-title">${unit.title}</div>
          <div class="unit-sub">${isUnlocked ? `${pct}% complete` : 'Finish the previous unit first'}</div>
          <div class="unit-progress-dots">${dots}</div>
          ${isUnlocked ? `<span class="btn btn-primary" style="width:100%;justify-content:center">${isComplete ? 'Review' : 'Continue'}</span>` : ''}
        </div>
      </div>`);
  });
}

/* ── Join classroom ─────────────────────────────────────────────────────────*/
async function doJoinClass() {
  if (!S.user) return;
  const raw = document.getElementById('invite-code-input').value;
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const errEl = document.getElementById('join-error');
  if (!code) { errEl.textContent = 'Enter an invite code'; errEl.classList.add('show'); return; }
  const btn = document.getElementById('btn-join');
  btn.disabled = true; btn.textContent = 'Joining…';
  try {
    const res = await API.joinClassroom(code);
    S.classroom = await API.studentClassroom();
    errEl.classList.remove('show');
    document.getElementById('invite-code-input').value = '';
    renderHome();
    showToast('🏫 Joined ' + res.classroom.name + '!');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Join';
  }
}

/* ── Unit detail ─────────────────────────────────────────────────────────────*/
function openUnit(unitId) {
  S.activeUnit = S.curriculum.find(u => u.id === unitId);
  const prog = getProgress(unitId);
  const done = prog.lessonsCompleted;

  document.getElementById('unit-detail-header').innerHTML = `
    <span class="unit-detail-emoji">${S.activeUnit.emoji}</span>
    <h2>${S.activeUnit.title}</h2>
    <p style="color:#64748b;font-size:.88rem">${done.length} of ${S.activeUnit.lessons.length} lessons complete</p>`;

  const list = document.getElementById('lesson-list');
  list.innerHTML = '';
  const icons = { matchup: '🔗', pattern: '🧩', milestone: '📖' };
  const labels = { matchup: 'Match-Up', pattern: 'Fill the Gap', milestone: 'Grammar Milestone' };

  S.activeUnit.lessons.forEach((lesson, idx) => {
    const isDone = done.includes(lesson.id);
    const isLocked = !isDone && idx > done.length;
    list.insertAdjacentHTML('beforeend', `
      <div class="lesson-row ${isDone ? 'completed' : ''} ${isLocked ? 'locked-row' : ''}"
           onclick="${isLocked ? '' : `openLesson('${lesson.id}')`}">
        <div class="lesson-icon type-${lesson.type}">${icons[lesson.type]}</div>
        <div class="lesson-info"><h4>${lesson.title}</h4><p>${labels[lesson.type]}</p></div>
        <div class="lesson-check ${isDone ? 'done' : ''}">${isDone ? '✓' : isLocked ? '🔒' : ''}</div>
      </div>`);
  });

  const best = prog.testScores?.length ? Math.max(...prog.testScores.map(s => s.score)) : null;
  list.insertAdjacentHTML('beforeend', `
    <div class="unit-test-row" onclick="openUnitTest('${unitId}')">
      <div style="font-size:1.7rem">📝</div>
      <div><h4>Unit Test</h4><p>${best !== null ? `Best: ${best}% — tap to improve!` : 'Test yourself on this unit'}</p></div>
      ${best !== null ? `<span class="best-score">Best: ${best}%</span>` : ''}
    </div>`);

  showView('unit');
}

function openLesson(lessonId) {
  S.activeLesson = S.activeUnit.lessons.find(l => l.id === lessonId);
  if (S.activeLesson.type === 'milestone') { openMilestone(S.activeLesson); return; }
  if (S.activeLesson.type === 'matchup') startMatchup(S.activeLesson);
  else startPattern(S.activeLesson);
  showView('exercise');
}

function exitLesson() { openUnit(S.activeUnit.id); }

/* ── Matchup ─────────────────────────────────────────────────────────────────*/
function startMatchup(lesson) {
  document.getElementById('ex-prog').textContent = lesson.title;
  document.getElementById('ex-title').textContent = 'Match the pairs!';
  document.getElementById('ex-subtitle').textContent = 'Tap a Manx word, then its English meaning';
  document.getElementById('btn-next-ex').classList.add('hidden');
  hideFeedback();
  S.matchPairs = [...lesson.pairs].sort(() => Math.random() - .5);
  S.matchSel = { left: null, right: null };
  S.matchDone = [];
  const right = [...lesson.pairs].sort(() => Math.random() - .5);
  document.getElementById('ex-prog-bar').style.width = '0%';
  document.getElementById('exercise-body').innerHTML = `
    <div class="matchup-cols">
      <div class="match-col">
        <div class="match-col-label">Manx</div>
        ${S.matchPairs.map((p, i) => `<div class="match-item" data-idx="${i}" data-side="left" onclick="selectMatch(this)">${p.manx}</div>`).join('')}
      </div>
      <div class="match-col">
        <div class="match-col-label">English</div>
        ${right.map((p, i) => `<div class="match-item" data-val="${p.english}" data-side="right" onclick="selectMatch(this)">${p.english}</div>`).join('')}
      </div>
    </div>`;
}

function selectMatch(el) {
  if (el.classList.contains('matched-correct')) return;
  const side = el.dataset.side;
  document.querySelectorAll(`.match-item.selected[data-side="${side}"]`).forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  if (side === 'left') S.matchSel.left = el;
  else S.matchSel.right = el;

  if (S.matchSel.left && S.matchSel.right) {
    const idx = parseInt(S.matchSel.left.dataset.idx);
    const correct = S.matchPairs[idx].english === S.matchSel.right.dataset.val;
    if (correct) {
      S.matchSel.left.classList.remove('selected'); S.matchSel.left.classList.add('matched-correct');
      S.matchSel.right.classList.remove('selected'); S.matchSel.right.classList.add('matched-correct');
      S.matchDone.push(idx);
      document.getElementById('ex-prog-bar').style.width = (S.matchDone.length / S.matchPairs.length * 100) + '%';
      if (S.matchDone.length === S.matchPairs.length) {
        showFeedback(true, 'Perfect!', 'All pairs matched!');
        document.getElementById('btn-next-ex').classList.remove('hidden');
        document.getElementById('btn-next-ex').onclick = finishLesson;
        document.getElementById('btn-next-ex').textContent = 'Continue →';
      }
    } else {
      S.matchSel.left.classList.add('matched-wrong'); S.matchSel.right.classList.add('matched-wrong');
      setTimeout(() => {
        S.matchSel.left.classList.remove('selected','matched-wrong');
        S.matchSel.right.classList.remove('selected','matched-wrong');
      }, 600);
    }
    S.matchSel = { left: null, right: null };
  }
}

/* ── Pattern ─────────────────────────────────────────────────────────────────*/
function startPattern(lesson) {
  document.getElementById('ex-title').textContent = 'Fill the gap!';
  document.getElementById('ex-subtitle').textContent = 'Choose the missing Manx word';
  S.patternIdx = 0; S.patternAnswered = false;
  renderPatternQ(lesson);
}

function renderPatternQ(lesson) {
  const q = lesson.sentences[S.patternIdx];
  const total = lesson.sentences.length;
  document.getElementById('ex-prog').textContent = `${S.activeLesson.title} — ${S.patternIdx + 1} of ${total}`;
  document.getElementById('ex-prog-bar').style.width = (S.patternIdx / total * 100) + '%';
  hideFeedback();
  document.getElementById('btn-next-ex').classList.add('hidden');
  S.patternAnswered = false;
  const shuffled = [...q.options].sort(() => Math.random() - .5);
  document.getElementById('exercise-body').innerHTML = `
    <div class="pattern-card">
      <div class="pattern-sentence">${q.template.replace(q.answer, `<span style="border-bottom:3px solid var(--primary);padding:0 8px">___</span>`)}</div>
      <div class="pattern-translation">${q.translation}</div>
      <div class="pattern-options">
        ${shuffled.map(o => `<button class="opt-btn" onclick="checkPattern('${o}','${q.answer}',this)">${o}</button>`).join('')}
      </div>
    </div>`;
}

function checkPattern(chosen, answer, btn) {
  if (S.patternAnswered) return;
  S.patternAnswered = true;
  document.querySelectorAll('.opt-btn').forEach(b => b.disabled = true);
  if (chosen === answer) {
    btn.classList.add('correct');
    showFeedback(true, 'Correct! 🎉', `"${answer}" is right!`);
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.opt-btn').forEach(b => { if (b.textContent === answer) b.classList.add('correct'); });
    showFeedback(false, 'Not quite', `The answer was "${answer}"`);
  }
  const isLast = S.patternIdx >= S.activeLesson.sentences.length - 1;
  document.getElementById('btn-next-ex').classList.remove('hidden');
  document.getElementById('btn-next-ex').textContent = isLast ? 'Finish ✓' : 'Next →';
  document.getElementById('btn-next-ex').onclick = nextPatternStep;
}

function nextPatternStep() {
  S.patternIdx++;
  if (S.patternIdx < S.activeLesson.sentences.length) renderPatternQ(S.activeLesson);
  else finishLesson();
}

async function finishLesson() {
  await API.completeLesson(S.activeUnit.id, S.activeLesson.id);
  S.progress = await API.getProgress();
  renderXPDisplay();
  showToast('🌟 Lesson complete! +20 XP');
  exitLesson();
}

/* ── Milestone ───────────────────────────────────────────────────────────────*/
function openMilestone(lesson) {
  document.getElementById('ms-title').textContent = lesson.title;
  document.getElementById('ms-concept').textContent = lesson.concept;
  document.getElementById('ms-explanation').innerHTML = lesson.explanation.split('\n').map(l => `<p>${l.trim()}</p>`).join('');
  showView('milestone');
}

async function completeMilestone() {
  await API.completeLesson(S.activeUnit.id, S.activeLesson.id);
  S.progress = await API.getProgress();
  renderXPDisplay();
  showToast('📖 Milestone complete! +20 XP');
  openUnit(S.activeUnit.id);
}

/* ── Unit test ───────────────────────────────────────────────────────────────*/
function openUnitTest(unitId) {
  S.activeUnit = S.curriculum.find(u => u.id === unitId);
  S.testUnitId = unitId;
  S.testQuestions = [...S.activeUnit.test.questions].sort(() => Math.random() - .5);
  S.testIdx = 0; S.testAnswers = [];
  renderTestQ();
  showView('test');
}

function renderTestQ() {
  const q = S.testQuestions[S.testIdx];
  const total = S.testQuestions.length;
  document.getElementById('test-q-count').textContent = `Question ${S.testIdx + 1} of ${total}`;
  document.getElementById('test-prog-bar').style.width = (S.testIdx / total * 100) + '%';
  document.getElementById('test-q-text').textContent = q.q;
  document.getElementById('btn-next-test').classList.add('hidden');
  document.getElementById('feedback-bar-test').classList.remove('show', 'correct', 'wrong');
  const letters = ['A', 'B', 'C', 'D'];
  document.getElementById('test-options').innerHTML = q.options.map((o, i) => `
    <button class="test-opt" onclick="answerTest(${i},${q.answer},this)">
      <span class="test-opt-letter">${letters[i]}</span>${o}
    </button>`).join('');
}

function answerTest(chosen, correct, btn) {
  document.querySelectorAll('.test-opt').forEach(b => b.disabled = true);
  const ok = chosen === correct;
  S.testAnswers.push(ok);
  btn.classList.add(ok ? 'correct' : 'wrong');
  if (!ok) document.querySelectorAll('.test-opt')[correct].classList.add('correct');
  const fb = document.getElementById('feedback-bar-test');
  fb.className = `feedback-bar show ${ok ? 'correct' : 'wrong'}`;
  fb.innerHTML = `<div class="fb-icon">${ok ? '✅' : '❌'}</div><div class="fb-text"><h4>${ok ? 'Correct!' : 'Not quite'}</h4></div>`;
  document.getElementById('btn-next-test').classList.remove('hidden');
  document.getElementById('btn-next-test').textContent = S.testIdx >= S.testQuestions.length - 1 ? 'See Results →' : 'Next →';
}

function nextTestQ() {
  S.testIdx++;
  if (S.testIdx < S.testQuestions.length) renderTestQ();
  else showResults();
}

async function showResults() {
  const correct = S.testAnswers.filter(Boolean).length;
  const total = S.testAnswers.length;
  const pct = Math.round(correct / total * 100);
  await API.recordTestScore(S.testUnitId, pct);
  S.progress = await API.getProgress();

  const msgs = pct === 100 ? ['🏆','Perfect score!',`All ${total} correct — incredible!`]
    : pct >= 80 ? ['🎉','Brilliant!',`${correct} out of ${total} — amazing!`]
    : pct >= 60 ? ['😊','Good effort!',`${correct} out of ${total} — keep practising!`]
    : ['💪','Keep going!',`${correct} out of ${total} — review and try again!`];

  document.getElementById('results-emoji').textContent = msgs[0];
  document.getElementById('results-msg').textContent = msgs[1];
  document.getElementById('results-sub').textContent = msgs[2];
  document.getElementById('score-pct').textContent = pct + '%';
  const circ = Math.PI * 2 * 60;
  const ring = document.getElementById('score-ring');
  ring.style.strokeDashoffset = circ - circ * pct / 100;
  ring.style.stroke = pct >= 80 ? '#10B981' : pct >= 60 ? '#F59E0B' : '#EC4899';

  const prog = S.progress.find(p => p.unitId === S.testUnitId);
  const hist = (prog?.testScores || []).slice().reverse().slice(0, 5);
  document.getElementById('results-history').innerHTML = `
    <h4>📊 Your attempts</h4>
    ${hist.map((s, i) => `<div class="history-item"><span>Attempt ${hist.length - i}</span><span>${s.date}</span><span class="h-score" style="color:${s.score>=80?'var(--success)':s.score>=60?'var(--secondary-dark)':'var(--danger)'}">${s.score}%</span></div>`).join('')}`;

  if (pct >= 80) launchConfetti();
  renderXPDisplay();
  showView('results');
}

function retakeTest() { openUnitTest(S.testUnitId); }

/* ── Helpers ─────────────────────────────────────────────────────────────────*/
function showErr(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.classList.add('show'); }
function showFeedback(ok, h, b) {
  const fb = document.getElementById('feedback-bar');
  fb.className = `feedback-bar show ${ok ? 'correct' : 'wrong'}`;
  fb.innerHTML = `<div class="fb-icon">${ok ? '✅' : '❌'}</div><div class="fb-text"><h4>${h}</h4><p>${b}</p></div>`;
}
function hideFeedback() { document.getElementById('feedback-bar').classList.remove('show', 'correct', 'wrong'); }
function nextExerciseStep() { /* triggered by btn-next-ex — overridden per exercise */ }
