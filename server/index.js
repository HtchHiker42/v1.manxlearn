'use strict';
const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path       = require('path');
const { getDb }  = require('./db');

const app = express();
const PORT = process.env.PORT || 4325;
// Change JWT_SECRET via environment variable in production
const JWT_SECRET = process.env.JWT_SECRET || 'manxlearn-demo-change-this-in-production-32chars';

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── Helpers ──────────────────────────────────────────────────────────────────
function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function setToken(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('ml_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    // secure: true  // Uncomment when serving over HTTPS
  });
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies.ml_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('ml_token');
    res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

function teacherOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    next();
  });
}

function studentOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
    next();
  });
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–30 alphanumeric characters or underscores' });
  if (password.length < 6 || password.length > 128) return res.status(400).json({ error: 'Password must be 6–128 characters' });
  if (!['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = uid('u');
  db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, username, passwordHash, role, new Date().toISOString());

  setToken(res, { userId: id, username, role });
  res.json({ user: { id, username, role } });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Username not found' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password' });

  setToken(res, { userId: user.id, username: user.username, role: user.role });
  res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('ml_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: { userId: req.user.userId, username: req.user.username, role: req.user.role } });
});

// ── Curriculum (served from server so codes cannot be tampered client-side) ──
app.get('/api/curriculum', auth, (req, res) => res.json(CURRICULUM));

// ── Progress ──────────────────────────────────────────────────────────────────
app.get('/api/progress', auth, (req, res) => {
  const db = getDb();
  const rows  = db.prepare('SELECT * FROM progress WHERE user_id = ?').all(req.user.userId);
  const scores = db.prepare('SELECT * FROM test_scores WHERE user_id = ?').all(req.user.userId);
  const data  = rows.map(r => ({
    unitId: r.unit_id,
    lessonsCompleted: JSON.parse(r.lessons_completed),
    xp: r.xp,
    testScores: scores
      .filter(s => s.unit_id === r.unit_id)
      .map(s => ({ score: s.score, date: s.taken_at.split('T')[0] }))
  }));
  res.json(data);
});

app.post('/api/progress/lesson', auth, (req, res) => {
  const { unitId, lessonId } = req.body || {};
  if (!unitId || !lessonId) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  let row = db.prepare('SELECT * FROM progress WHERE user_id = ? AND unit_id = ?').get(req.user.userId, unitId);
  if (!row) {
    db.prepare('INSERT INTO progress (id,user_id,unit_id,lessons_completed,xp) VALUES (?,?,?,?,?)').run(uid('p'), req.user.userId, unitId, '[]', 0);
    row = db.prepare('SELECT * FROM progress WHERE user_id = ? AND unit_id = ?').get(req.user.userId, unitId);
  }
  const lessons = JSON.parse(row.lessons_completed);
  if (!lessons.includes(lessonId)) {
    lessons.push(lessonId);
    db.prepare('UPDATE progress SET lessons_completed=?, xp=xp+20 WHERE user_id=? AND unit_id=?').run(JSON.stringify(lessons), req.user.userId, unitId);
  }
  res.json({ ok: true });
});

app.post('/api/progress/test', auth, (req, res) => {
  const { unitId, score } = req.body || {};
  if (!unitId || score == null || score < 0 || score > 100) return res.status(400).json({ error: 'Invalid data' });
  const db = getDb();
  const xpGain = Math.floor(score / 10) * 5;
  db.prepare('INSERT INTO test_scores (id,user_id,unit_id,score,taken_at) VALUES (?,?,?,?,?)').run(uid('ts'), req.user.userId, unitId, score, new Date().toISOString());
  const row = db.prepare('SELECT id FROM progress WHERE user_id=? AND unit_id=?').get(req.user.userId, unitId);
  if (row) {
    db.prepare('UPDATE progress SET xp=xp+? WHERE user_id=? AND unit_id=?').run(xpGain, req.user.userId, unitId);
  } else {
    db.prepare('INSERT INTO progress (id,user_id,unit_id,lessons_completed,xp) VALUES (?,?,?,?,?)').run(uid('p'), req.user.userId, unitId, '[]', xpGain);
  }
  res.json({ ok: true });
});

// ── Classrooms ────────────────────────────────────────────────────────────────
app.get('/api/classrooms', teacherOnly, (req, res) => {
  const db = getDb();
  const cls = db.prepare('SELECT * FROM classrooms WHERE teacher_id=?').all(req.user.userId);
  const result = cls.map(c => {
    const students = db.prepare('SELECT student_id FROM classroom_students WHERE classroom_id=?').all(c.id);
    return { ...c, studentIds: students.map(s => s.student_id) };
  });
  res.json(result);
});

app.post('/api/classrooms', teacherOnly, (req, res) => {
  const { name } = req.body || {};
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Classroom name required (min 2 chars)' });
  const db = getDb();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const id = uid('cls');
  db.prepare('INSERT INTO classrooms (id,name,teacher_id,invite_code,created_at) VALUES (?,?,?,?,?)').run(id, name.trim(), req.user.userId, code, new Date().toISOString());
  res.json({ id, name: name.trim(), teacherId: req.user.userId, inviteCode: code, studentIds: [] });
});

app.post('/api/classrooms/join', studentOnly, (req, res) => {
  const raw = (req.body?.inviteCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw) return res.status(400).json({ error: 'Invite code required' });
  const db = getDb();
  const cls = db.prepare('SELECT * FROM classrooms WHERE invite_code=?').get(raw);
  if (!cls) return res.status(404).json({ error: 'Invalid invite code — check with your teacher' });
  const already = db.prepare('SELECT 1 FROM classroom_students WHERE classroom_id=? AND student_id=?').get(cls.id, req.user.userId);
  if (!already) {
    db.prepare('INSERT INTO classroom_students (classroom_id,student_id,joined_at) VALUES (?,?,?)').run(cls.id, req.user.userId, new Date().toISOString());
  }
  res.json({ classroom: { id: cls.id, name: cls.name, inviteCode: cls.invite_code } });
});

app.get('/api/classrooms/:id', teacherOnly, (req, res) => {
  const db = getDb();
  const cls = db.prepare('SELECT * FROM classrooms WHERE id=? AND teacher_id=?').get(req.params.id, req.user.userId);
  if (!cls) return res.status(404).json({ error: 'Classroom not found' });
  const students = db.prepare(`SELECT u.id, u.username, u.created_at FROM users u JOIN classroom_students cs ON cs.student_id=u.id WHERE cs.classroom_id=?`).all(cls.id);
  const assignments = db.prepare('SELECT * FROM assignments WHERE classroom_id=?').all(cls.id);
  res.json({ ...cls, students, assignments });
});

app.get('/api/classrooms/:id/progress', teacherOnly, (req, res) => {
  const db = getDb();
  const cls = db.prepare('SELECT id FROM classrooms WHERE id=? AND teacher_id=?').get(req.params.id, req.user.userId);
  if (!cls) return res.status(403).json({ error: 'Not your classroom' });
  const students = db.prepare(`SELECT u.id, u.username FROM users u JOIN classroom_students cs ON cs.student_id=u.id WHERE cs.classroom_id=?`).all(req.params.id);
  const result = students.map(s => {
    const prog  = db.prepare('SELECT * FROM progress WHERE user_id=?').all(s.id);
    const scores = db.prepare('SELECT * FROM test_scores WHERE user_id=? ORDER BY taken_at DESC').all(s.id);
    return {
      id: s.id, username: s.username,
      totalXP: prog.reduce((n, p) => n + p.xp, 0),
      progress: prog.map(p => ({ unitId: p.unit_id, lessonsCompleted: JSON.parse(p.lessons_completed), xp: p.xp })),
      testScores: scores.map(sc => ({ unitId: sc.unit_id, score: sc.score, date: sc.taken_at.split('T')[0] }))
    };
  });
  res.json(result);
});

// ── Assignments ───────────────────────────────────────────────────────────────
app.get('/api/assignments', auth, (req, res) => {
  const db = getDb();
  if (req.user.role === 'teacher') {
    const ids = db.prepare('SELECT id FROM classrooms WHERE teacher_id=?').all(req.user.userId).map(c => c.id);
    if (!ids.length) return res.json([]);
    const ph = ids.map(() => '?').join(',');
    return res.json(db.prepare(`SELECT * FROM assignments WHERE classroom_id IN (${ph})`).all(...ids));
  }
  const mem = db.prepare('SELECT classroom_id FROM classroom_students WHERE student_id=?').get(req.user.userId);
  if (!mem) return res.json([]);
  res.json(db.prepare('SELECT * FROM assignments WHERE classroom_id=?').all(mem.classroom_id));
});

app.post('/api/assignments', teacherOnly, (req, res) => {
  const { classroomId, unitId, title, dueDate } = req.body || {};
  if (!classroomId || !unitId || !title || !dueDate) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  if (!db.prepare('SELECT id FROM classrooms WHERE id=? AND teacher_id=?').get(classroomId, req.user.userId)) {
    return res.status(403).json({ error: 'Not your classroom' });
  }
  const id = uid('asgn');
  db.prepare('INSERT INTO assignments (id,classroom_id,unit_id,title,due_date,created_at) VALUES (?,?,?,?,?,?)').run(id, classroomId, unitId, title, dueDate, new Date().toISOString());
  res.json({ id, classroomId, unitId, title, dueDate });
});

// ── Teacher overview (dashboard stats) ────────────────────────────────────────
app.get('/api/teacher/overview', teacherOnly, (req, res) => {
  const db = getDb();
  const classrooms = db.prepare('SELECT * FROM classrooms WHERE teacher_id=?').all(req.user.userId);
  const result = classrooms.map(cls => {
    const students = db.prepare(`SELECT u.id, u.username FROM users u JOIN classroom_students cs ON cs.student_id=u.id WHERE cs.classroom_id=?`).all(cls.id);
    const studentData = students.map(s => {
      const prog   = db.prepare('SELECT * FROM progress WHERE user_id=?').all(s.id);
      const scores = db.prepare('SELECT * FROM test_scores WHERE user_id=? ORDER BY taken_at DESC').all(s.id);
      return {
        id: s.id, username: s.username,
        totalXP: prog.reduce((n, p) => n + p.xp, 0),
        progress: prog.map(p => ({ unitId: p.unit_id, lessonsCompleted: JSON.parse(p.lessons_completed), xp: p.xp })),
        testScores: scores.map(sc => ({ unitId: sc.unit_id, score: sc.score, date: sc.taken_at.split('T')[0] }))
      };
    });
    const allScores = studentData.flatMap(s => s.testScores);
    return {
      id: cls.id, name: cls.name, inviteCode: cls.invite_code, createdAt: cls.created_at,
      studentCount: students.length,
      testsTaken: allScores.length,
      students: studentData
    };
  });
  res.json(result);
});

// Student: get their classroom info
app.get('/api/student/classroom', studentOnly, (req, res) => {
  const db = getDb();
  const mem = db.prepare('SELECT classroom_id FROM classroom_students WHERE student_id=?').get(req.user.userId);
  if (!mem) return res.json(null);
  const cls = db.prepare('SELECT id, name, invite_code FROM classrooms WHERE id=?').get(mem.classroom_id);
  const asgns = db.prepare('SELECT * FROM assignments WHERE classroom_id=?').all(mem.classroom_id);
  res.json({ id: cls.id, name: cls.name, inviteCode: cls.invite_code, assignments: asgns });
});

// SPA fallback for clean URLs
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, '../public/teacher.html')));

app.listen(PORT, () => {
  console.log(`\n🦤 ManxLearn server running → http://localhost:${PORT}`);
  console.log(`   Student portal → http://localhost:${PORT}/student.html`);
  console.log(`   Teacher portal → http://localhost:${PORT}/teacher.html\n`);
});

// ── Curriculum data ────────────────────────────────────────────────────────────
const CURRICULUM = [
  {
    id:'unit1', title:'Moylley — Greetings', emoji:'👋',
    color:'#2563EB', colorLight:'#dbeafe',
    lessons:[
      { id:'l1_1', title:'Hello & Goodbye', type:'matchup',
        pairs:[
          {manx:'Moghrey mie',english:'Good morning'},{manx:'Fastyr mie',english:'Good afternoon'},
          {manx:'Oie vie',english:'Good night'},{manx:'Slane lhiat',english:'Goodbye'}
        ]
      },
      { id:'l1_2', title:'How are you?', type:'pattern',
        sentences:[
          {template:"Cre'n aght t'ou?", answer:'Mie', options:['Mie','Moghrey','Slane','Oie'], translation:"How are you? — Good"},
          {template:'Ta mee ___', answer:'braew', options:['braew','vie','lhiat','mie'], translation:'I am fine'},
          {template:'___ mie', answer:'Moghrey', options:['Moghrey','Fastyr','Oie','Slane'], translation:'Good morning'}
        ]
      },
      { id:'milestone_1', title:'Grammar Milestone', type:'milestone',
        concept:'Manx Greetings & Time of Day',
        explanation:`In Manx, greetings change based on the time of day — just like in English! "Moghrey" means morning, "Fastyr" means afternoon/evening, and "Oie" means night. Combine these with "mie" (good) to make greetings. When you say goodbye, "Slane lhiat" literally means "Health be with you!"`,
        teacherNote:'Students often mix up Fastyr mie (afternoon) and Oie vie (night). Try role-play greetings at different times of day.'
      }
    ],
    test:{ questions:[
      {q:'What does "Moghrey mie" mean?', options:['Good night','Good morning','Good afternoon','Goodbye'], answer:1},
      {q:'How do you say "Goodbye" in Manx?', options:['Oie vie','Ta mee mie','Slane lhiat','Fastyr mie'], answer:2},
      {q:'What does "mie" mean?', options:['Hello','Night','Good','Morning'], answer:2},
      {q:'"Cre\'n aght t\'ou?" means…', options:['What time is it?','How are you?','Where are you?','Who are you?'], answer:1},
      {q:'Which greeting would you use in the evening?', options:['Moghrey mie','Slane lhiat','Fastyr mie','Cre\'n aght'], answer:2}
    ]}
  },
  {
    id:'unit2', title:'Earrooyn — Numbers', emoji:'🔢',
    color:'#F59E0B', colorLight:'#fef3c7',
    lessons:[
      { id:'l2_1', title:'Numbers 1–5', type:'matchup',
        pairs:[{manx:'Nane',english:'One'},{manx:'Jees',english:'Two'},{manx:'Tree',english:'Three'},{manx:'Kiare',english:'Four'},{manx:'Queig',english:'Five'}]
      },
      { id:'l2_2', title:'Numbers 6–10', type:'matchup',
        pairs:[{manx:'Shey',english:'Six'},{manx:'Shiaght',english:'Seven'},{manx:'Hoght',english:'Eight'},{manx:'Nuy',english:'Nine'},{manx:'Jeih',english:'Ten'}]
      },
      { id:'milestone_2', title:'Grammar Milestone', type:'milestone',
        concept:'How Manx Counting Works',
        explanation:`Manx uses a traditional Celtic counting system. "Tree" (three) sounds similar to English — both come from the same ancient roots! Old Manx counted in groups of twenty (like French), so 40 is "daa feed" meaning "two twenties". This vigesimal system is fascinating. For now, master 1–10 and you're doing brilliantly!`,
        teacherNote:'The vigesimal system fascinates older learners. Stick to 1-10 for this age group but mention it as a fun fact.'
      }
    ],
    test:{ questions:[
      {q:'What is "Jees" in English?', options:['One','Two','Three','Four'], answer:1},
      {q:'How do you say "Seven" in Manx?', options:['Shey','Hoght','Shiaght','Nuy'], answer:2},
      {q:'What number is "Queig"?', options:['3','4','5','6'], answer:2},
      {q:'"Jeih" means…', options:['Eight','Nine','Ten','Seven'], answer:2},
      {q:'Which of these is NOT a Manx number?', options:['Nane','Kiare','Moghrey','Nuy'], answer:2}
    ]}
  },
  {
    id:'unit3', title:'Daahyn — Colours', emoji:'🎨',
    color:'#EC4899', colorLight:'#fce7f3',
    lessons:[
      { id:'l3_1', title:'Basic Colours', type:'matchup',
        pairs:[{manx:'Jiarg',english:'Red'},{manx:'Buigh',english:'Yellow'},{manx:'Gorrym',english:'Blue'},{manx:'Uiney',english:'Green'},{manx:'Doo',english:'Black'}]
      },
      { id:'l3_2', title:'Colours in Sentences', type:'pattern',
        sentences:[
          {template:"Ta'n aer ___", answer:'gorrym', options:['gorrym','jiarg','buigh','doo'], translation:'The sky is blue'},
          {template:"Ta'n geay ___", answer:'feayr', options:['feayr','cheh','braew','mie'], translation:'The wind is cold'},
          {template:"Ta'n baa ___", answer:'bane', options:['bane','jiarg','uiney','gorrym'], translation:'The cow is white'}
        ]
      },
      { id:'milestone_3', title:'Grammar Milestone', type:'milestone',
        concept:'Adjectives & Lenition in Manx',
        explanation:`In Manx, adjectives come AFTER the noun — opposite to English! "Red car" becomes "gleashtan jiarg" (literally "car red"). There is also LENITION, a softening rule where the first letter of a word changes sound after certain words. For example "mooar" (big) can become "vooar". You will learn this gradually — your brain is amazing at spotting patterns!`,
        teacherNote:'Lenition is a key Celtic grammar feature. Introduce gently — recognition before production. Use flashcards with before/after pairs.'
      }
    ],
    test:{ questions:[
      {q:'What colour is "Jiarg"?', options:['Blue','Green','Red','Yellow'], answer:2},
      {q:'"Gorrym" means…', options:['Green','Blue','Black','White'], answer:1},
      {q:'In Manx, where does the adjective go?', options:['Before the noun','After the noun','At the start','Anywhere'], answer:1},
      {q:'How do you say "Yellow" in Manx?', options:['Uiney','Doo','Buigh','Bane'], answer:2},
      {q:'"Ta\'n aer gorrym" means…', options:['The sea is green','The sky is blue','The sun is yellow','The grass is red'], answer:1}
    ]}
  }
];
