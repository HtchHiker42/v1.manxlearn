'use strict';
const express      = require('express');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path         = require('path');
const { sql, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 4325;
const JWT_SECRET = process.env.JWT_SECRET || 'manxlearn-demo-change-this-in-production-32chars';

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Run schema once at cold-start; all routes await this promise
const ready = initSchema().catch(err => { console.error('Schema init failed:', err); process.exit(1); });

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function setToken(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('ml_token', token, {
    httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies.ml_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.clearCookie('ml_token'); res.status(401).json({ error: 'Session expired — please log in again' }); }
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

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  await ready;
  const { username, password, role } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username: 3–30 letters, numbers or underscores' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const [existing] = await sql`SELECT id FROM users WHERE username = ${username}`;
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    const passwordHash = await bcrypt.hash(password, 12);
    const id = uid('u');
    await sql`INSERT INTO users (id, username, password_hash, role, created_at) VALUES (${id}, ${username}, ${passwordHash}, ${role}, ${new Date().toISOString()})`;
    setToken(res, { userId: id, username, role });
    res.json({ user: { id, username, role } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/login', async (req, res) => {
  await ready;
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const [user] = await sql`SELECT * FROM users WHERE username = ${username}`;
    if (!user) return res.status(401).json({ error: 'Username not found' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });
    setToken(res, { userId: user.id, username: user.username, role: user.role });
    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('ml_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: { userId: req.user.userId, username: req.user.username, role: req.user.role } });
});

// ── Curriculum ────────────────────────────────────────────────────────────────
app.get('/api/curriculum', auth, (req, res) => res.json(CURRICULUM));

// ── Progress ──────────────────────────────────────────────────────────────────
app.get('/api/progress', auth, async (req, res) => {
  await ready;
  try {
    const rows   = await sql`SELECT * FROM progress WHERE user_id = ${req.user.userId}`;
    const scores = await sql`SELECT * FROM test_scores WHERE user_id = ${req.user.userId}`;
    res.json(rows.map(r => ({
      unitId: r.unit_id,
      lessonsCompleted: JSON.parse(r.lessons_completed),
      xp: r.xp,
      testScores: scores.filter(s => s.unit_id === r.unit_id).map(s => ({ score: s.score, date: s.taken_at.split('T')[0] }))
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/progress/lesson', auth, async (req, res) => {
  await ready;
  const { unitId, lessonId } = req.body || {};
  if (!unitId || !lessonId) return res.status(400).json({ error: 'Missing fields' });
  try {
    const [row] = await sql`SELECT * FROM progress WHERE user_id = ${req.user.userId} AND unit_id = ${unitId}`;
    if (!row) {
      await sql`INSERT INTO progress (id, user_id, unit_id, lessons_completed, xp) VALUES (${uid('p')}, ${req.user.userId}, ${unitId}, ${JSON.stringify([lessonId])}, 20)`;
    } else {
      const lessons = JSON.parse(row.lessons_completed);
      if (!lessons.includes(lessonId)) {
        lessons.push(lessonId);
        await sql`UPDATE progress SET lessons_completed = ${JSON.stringify(lessons)}, xp = xp + 20 WHERE user_id = ${req.user.userId} AND unit_id = ${unitId}`;
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/progress/test', auth, async (req, res) => {
  await ready;
  const { unitId, score } = req.body || {};
  if (!unitId || score == null || score < 0 || score > 100) return res.status(400).json({ error: 'Invalid data' });
  const xpGain = Math.floor(score / 10) * 5;
  try {
    await sql`INSERT INTO test_scores (id, user_id, unit_id, score, taken_at) VALUES (${uid('ts')}, ${req.user.userId}, ${unitId}, ${score}, ${new Date().toISOString()})`;
    const [row] = await sql`SELECT id FROM progress WHERE user_id = ${req.user.userId} AND unit_id = ${unitId}`;
    if (row) {
      await sql`UPDATE progress SET xp = xp + ${xpGain} WHERE user_id = ${req.user.userId} AND unit_id = ${unitId}`;
    } else {
      await sql`INSERT INTO progress (id, user_id, unit_id, lessons_completed, xp) VALUES (${uid('p')}, ${req.user.userId}, ${unitId}, '[]', ${xpGain})`;
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Classrooms ────────────────────────────────────────────────────────────────
app.get('/api/classrooms', teacherOnly, async (req, res) => {
  await ready;
  try {
    const cls = await sql`SELECT * FROM classrooms WHERE teacher_id = ${req.user.userId}`;
    const result = await Promise.all(cls.map(async c => {
      const students = await sql`SELECT student_id FROM classroom_students WHERE classroom_id = ${c.id}`;
      return { ...c, studentIds: students.map(s => s.student_id) };
    }));
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/classrooms', teacherOnly, async (req, res) => {
  await ready;
  const { name } = req.body || {};
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Classroom name required' });
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const id = uid('cls');
    await sql`INSERT INTO classrooms (id, name, teacher_id, invite_code, created_at) VALUES (${id}, ${name.trim()}, ${req.user.userId}, ${code}, ${new Date().toISOString()})`;
    res.json({ id, name: name.trim(), teacherId: req.user.userId, inviteCode: code, studentIds: [] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/classrooms/join', studentOnly, async (req, res) => {
  await ready;
  const raw = ((req.body?.inviteCode) || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw) return res.status(400).json({ error: 'Invite code required' });
  try {
    const [cls] = await sql`SELECT * FROM classrooms WHERE invite_code = ${raw}`;
    if (!cls) return res.status(404).json({ error: 'Invalid invite code — check with your teacher' });
    const [already] = await sql`SELECT 1 FROM classroom_students WHERE classroom_id = ${cls.id} AND student_id = ${req.user.userId}`;
    if (!already) {
      await sql`INSERT INTO classroom_students (classroom_id, student_id, joined_at) VALUES (${cls.id}, ${req.user.userId}, ${new Date().toISOString()})`;
    }
    res.json({ classroom: { id: cls.id, name: cls.name, inviteCode: cls.invite_code } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/classrooms/:id', teacherOnly, async (req, res) => {
  await ready;
  try {
    const [cls] = await sql`SELECT * FROM classrooms WHERE id = ${req.params.id} AND teacher_id = ${req.user.userId}`;
    if (!cls) return res.status(404).json({ error: 'Classroom not found' });
    const students = await sql`SELECT u.id, u.username, u.created_at FROM users u JOIN classroom_students cs ON cs.student_id = u.id WHERE cs.classroom_id = ${cls.id}`;
    const assignments = await sql`SELECT * FROM assignments WHERE classroom_id = ${cls.id}`;
    res.json({ ...cls, students, assignments });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/classrooms/:id/progress', teacherOnly, async (req, res) => {
  await ready;
  try {
    const [cls] = await sql`SELECT id FROM classrooms WHERE id = ${req.params.id} AND teacher_id = ${req.user.userId}`;
    if (!cls) return res.status(403).json({ error: 'Not your classroom' });
    const students = await sql`SELECT u.id, u.username FROM users u JOIN classroom_students cs ON cs.student_id = u.id WHERE cs.classroom_id = ${req.params.id}`;
    const result = await Promise.all(students.map(async s => {
      const prog   = await sql`SELECT * FROM progress WHERE user_id = ${s.id}`;
      const scores = await sql`SELECT * FROM test_scores WHERE user_id = ${s.id} ORDER BY taken_at DESC`;
      return {
        id: s.id, username: s.username,
        totalXP: prog.reduce((n, p) => n + p.xp, 0),
        progress: prog.map(p => ({ unitId: p.unit_id, lessonsCompleted: JSON.parse(p.lessons_completed), xp: p.xp })),
        testScores: scores.map(sc => ({ unitId: sc.unit_id, score: sc.score, date: sc.taken_at.split('T')[0] }))
      };
    }));
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Assignments ───────────────────────────────────────────────────────────────
app.get('/api/assignments', auth, async (req, res) => {
  await ready;
  try {
    if (req.user.role === 'teacher') {
      const ids = (await sql`SELECT id FROM classrooms WHERE teacher_id = ${req.user.userId}`).map(c => c.id);
      if (!ids.length) return res.json([]);
      return res.json(await sql`SELECT * FROM assignments WHERE classroom_id = ANY(${ids})`);
    }
    const [mem] = await sql`SELECT classroom_id FROM classroom_students WHERE student_id = ${req.user.userId}`;
    if (!mem) return res.json([]);
    res.json(await sql`SELECT * FROM assignments WHERE classroom_id = ${mem.classroom_id}`);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/assignments', teacherOnly, async (req, res) => {
  await ready;
  const { classroomId, unitId, title, dueDate } = req.body || {};
  if (!classroomId || !unitId || !title || !dueDate) return res.status(400).json({ error: 'Missing fields' });
  try {
    const [cls] = await sql`SELECT id FROM classrooms WHERE id = ${classroomId} AND teacher_id = ${req.user.userId}`;
    if (!cls) return res.status(403).json({ error: 'Not your classroom' });
    const id = uid('asgn');
    await sql`INSERT INTO assignments (id, classroom_id, unit_id, title, due_date, created_at) VALUES (${id}, ${classroomId}, ${unitId}, ${title}, ${dueDate}, ${new Date().toISOString()})`;
    res.json({ id, classroomId, unitId, title, dueDate });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Teacher overview ──────────────────────────────────────────────────────────
app.get('/api/teacher/overview', teacherOnly, async (req, res) => {
  await ready;
  try {
    const classrooms = await sql`SELECT * FROM classrooms WHERE teacher_id = ${req.user.userId}`;
    const result = await Promise.all(classrooms.map(async cls => {
      const students = await sql`SELECT u.id, u.username FROM users u JOIN classroom_students cs ON cs.student_id = u.id WHERE cs.classroom_id = ${cls.id}`;
      const studentData = await Promise.all(students.map(async s => {
        const prog   = await sql`SELECT * FROM progress WHERE user_id = ${s.id}`;
        const scores = await sql`SELECT * FROM test_scores WHERE user_id = ${s.id} ORDER BY taken_at DESC`;
        return {
          id: s.id, username: s.username,
          totalXP: prog.reduce((n, p) => n + p.xp, 0),
          progress: prog.map(p => ({ unitId: p.unit_id, lessonsCompleted: JSON.parse(p.lessons_completed), xp: p.xp })),
          testScores: scores.map(sc => ({ unitId: sc.unit_id, score: sc.score, date: sc.taken_at.split('T')[0] }))
        };
      }));
      return { id: cls.id, name: cls.name, inviteCode: cls.invite_code, createdAt: cls.created_at, studentCount: students.length, testsTaken: studentData.flatMap(s => s.testScores).length, students: studentData };
    }));
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Student classroom ─────────────────────────────────────────────────────────
app.get('/api/student/classroom', studentOnly, async (req, res) => {
  await ready;
  try {
    const [mem] = await sql`SELECT classroom_id FROM classroom_students WHERE student_id = ${req.user.userId}`;
    if (!mem) return res.json(null);
    const [cls] = await sql`SELECT id, name, invite_code FROM classrooms WHERE id = ${mem.classroom_id}`;
    const asgns = await sql`SELECT * FROM assignments WHERE classroom_id = ${mem.classroom_id}`;
    res.json({ id: cls.id, name: cls.name, inviteCode: cls.invite_code, assignments: asgns });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── SPA clean URLs ────────────────────────────────────────────────────────────
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, '../public/teacher.html')));

// Export for Vercel; only listen locally
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`\n🦤 ManxLearn → http://localhost:${PORT}\n`));
}
module.exports = app;

// ── Curriculum ────────────────────────────────────────────────────────────────
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
        explanation:`In Manx, greetings change based on the time of day. "Moghrey" means morning, "Fastyr" means afternoon/evening, and "Oie" means night. Combine these with "mie" (good) to make greetings. "Slane lhiat" literally means "Health be with you!"`,
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
        explanation:`Manx uses a traditional Celtic counting system. Old Manx counted in groups of twenty (like French), so 40 is "daa feed" meaning "two twenties". This vigesimal system is fascinating — master 1–10 first and you are doing brilliantly!`,
        teacherNote:'Mention the vigesimal system as a fun fact for curious learners.'
      }
    ],
    test:{ questions:[
      {q:'What is "Jees" in English?', options:['One','Two','Three','Four'], answer:1},
      {q:'How do you say "Seven" in Manx?', options:['Shey','Hoght','Shiaght','Nuy'], answer:2},
      {q:'What number is "Queig"?', options:['3','4','5','6'], answer:2},
      {q:'"Jeih" means…', options:['Eight','Nine','Ten','Seven'], answer:2},
      {q:'Which is NOT a Manx number?', options:['Nane','Kiare','Moghrey','Nuy'], answer:2}
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
        explanation:`In Manx, adjectives come AFTER the noun — the opposite of English! "Red car" becomes "gleashtan jiarg" (literally "car red"). There is also LENITION where the first letter of a word softens after certain words. You will learn this gradually — your brain is great at spotting patterns!`,
        teacherNote:'Introduce lenition gently — recognition before production. Use flashcards with before/after pairs.'
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
