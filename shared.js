// ============================================================
// ManxLearn – Shared Utilities
// Crypto: SubtleCrypto SHA-256 with random salt (Web Crypto API)
// Storage: localStorage with JSON serialisation
// EU-compliant: no email, no PII beyond chosen username
// ============================================================

const DB_KEY = 'manxlearn_db';

// ── Crypto ────────────────────────────────────────────────
async function generateSalt() {
  const arr = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, salt, storedHash) {
  const hash = await hashPassword(password, salt);
  return hash === storedHash;
}

// ── Database ──────────────────────────────────────────────
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : { users: [], classrooms: [], progress: [], assignments: [] };
  } catch {
    return { users: [], classrooms: [], progress: [], assignments: [] };
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

// Returns a Promise that resolves once the DB (and demo seed) is ready.
let _dbReadyPromise = null;
function ensureReady() {
  if (_dbReadyPromise) return _dbReadyPromise;
  _dbReadyPromise = (async () => {
    const raw = localStorage.getItem(DB_KEY);
    const db = raw ? JSON.parse(raw) : null;
    // Re-seed if missing or if users weren't seeded yet (async race on first load)
    if (!db || !db.users || db.users.length === 0) {
      const freshDb = { users: [], classrooms: [], progress: [], assignments: [] };
      await seedDemoData(freshDb);
    }
  })();
  return _dbReadyPromise;
}

async function seedDemoData(db) {
  // Demo teacher
  const tSalt = await generateSalt();
  const tHash = await hashPassword('demo123', tSalt);
  db.users.push({
    id: 'u_teacher1', username: 'ms_kermode', passwordHash: tHash,
    salt: tSalt, role: 'teacher', displayName: 'Ms. Kermode', createdAt: new Date().toISOString()
  });

  // Demo students
  const names = [
    ['Finn', 'finn_mac'], ['Isla', 'isla_v'], ['Cian', 'cian_b'],
    ['Niamh', 'niamh_r'], ['Oisín', 'oisin_k']
  ];
  for (let i = 0; i < names.length; i++) {
    const [display, uname] = names[i];
    const sSalt = await generateSalt();
    const sHash = await hashPassword('student123', sSalt);
    db.users.push({
      id: `u_s${i}`, username: uname, passwordHash: sHash,
      salt: sSalt, role: 'student', displayName: display,
      createdAt: new Date().toISOString()
    });
    // Some progress data
    if (i < 3) {
      db.progress.push({
        userId: `u_s${i}`, unitId: 'unit1',
        lessonsCompleted: ['l1_1', 'l1_2', 'milestone_1'],
        testScores: [{ score: 60 + i * 10, date: '2025-11-10' }, { score: 75 + i * 5, date: '2025-11-12' }],
        xp: 120 + i * 40
      });
    }
  }

  // Demo classroom — students NOT pre-joined so the invite code flow is testable.
  // Demo students join via invite code MANX4B from the student portal.
  db.classrooms.push({
    id: 'cls1', name: 'Manx Class 4B', teacherId: 'u_teacher1',
    studentIds: [],
    inviteCode: 'MANX4B', createdAt: new Date().toISOString()
  });

  // Demo assignment
  db.assignments.push({
    id: 'asgn1', classroomId: 'cls1', unitId: 'unit1',
    title: 'Complete Unit 1 Test', dueDate: '2025-12-01', createdAt: new Date().toISOString()
  });

  saveDB(db);
}

// ── User helpers ──────────────────────────────────────────
async function registerUser({ username, password, role, displayName }) {
  await ensureReady();
  const db = loadDB();
  if (db.users.find(u => u.username === username)) return { error: 'Username already taken' };
  const salt = await generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const user = {
    id: 'u_' + Date.now(), username, passwordHash, salt,
    role, displayName: displayName || username, createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);
  return { user };
}

async function loginUser({ username, password }) {
  await ensureReady();
  const db = loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return { error: 'Username not found' };
  const ok = await verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) return { error: 'Incorrect password' };
  sessionStorage.setItem('manxlearn_session', JSON.stringify({ userId: user.id, role: user.role }));
  return { user };
}

function logoutUser() {
  sessionStorage.removeItem('manxlearn_session');
}

function currentSession() {
  try { return JSON.parse(sessionStorage.getItem('manxlearn_session')); } catch { return null; }
}

function getUser(userId) {
  return loadDB().users.find(u => u.id === userId);
}

// ── Progress helpers ──────────────────────────────────────
function getProgress(userId, unitId) {
  const db = loadDB();
  return db.progress.find(p => p.userId === userId && p.unitId === unitId)
    || { userId, unitId, lessonsCompleted: [], testScores: [], xp: 0 };
}

function saveProgress(prog) {
  const db = loadDB();
  const idx = db.progress.findIndex(p => p.userId === prog.userId && p.unitId === prog.unitId);
  if (idx >= 0) db.progress[idx] = prog;
  else db.progress.push(prog);
  saveDB(db);
}

function addTestScore(userId, unitId, score) {
  const prog = getProgress(userId, unitId);
  prog.testScores = prog.testScores || [];
  prog.testScores.push({ score, date: new Date().toISOString().split('T')[0] });
  prog.xp = (prog.xp || 0) + Math.floor(score / 10) * 5;
  saveProgress(prog);
}

function markLessonComplete(userId, unitId, lessonId) {
  const prog = getProgress(userId, unitId);
  if (!prog.lessonsCompleted.includes(lessonId)) {
    prog.lessonsCompleted.push(lessonId);
    prog.xp = (prog.xp || 0) + 20;
    saveProgress(prog);
  }
}

// ── Classroom helpers ─────────────────────────────────────
function getClassroomsForTeacher(teacherId) {
  return loadDB().classrooms.filter(c => c.teacherId === teacherId);
}

function getClassroom(classroomId) {
  return loadDB().classrooms.find(c => c.id === classroomId);
}

function createClassroom({ name, teacherId }) {
  const db = loadDB();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const cls = { id: 'cls_' + Date.now(), name, teacherId, studentIds: [], inviteCode: code, createdAt: new Date().toISOString() };
  db.classrooms.push(cls);
  saveDB(db);
  return cls;
}

function joinClassroom({ inviteCode, studentId }) {
  const db = loadDB();
  const cls = db.classrooms.find(c => c.inviteCode === inviteCode.toUpperCase());
  if (!cls) return { error: 'Invalid invite code' };
  if (!cls.studentIds.includes(studentId)) cls.studentIds.push(studentId);
  saveDB(db);
  return { classroom: cls };
}

function getAssignmentsForClassroom(classroomId) {
  return loadDB().assignments.filter(a => a.classroomId === classroomId);
}

function createAssignment({ classroomId, unitId, title, dueDate }) {
  const db = loadDB();
  const asgn = { id: 'asgn_' + Date.now(), classroomId, unitId, title, dueDate, createdAt: new Date().toISOString() };
  db.assignments.push(asgn);
  saveDB(db);
  return asgn;
}

function getStudentClassroom(studentId) {
  const db = loadDB();
  return db.classrooms.find(c => c.studentIds.includes(studentId));
}

function getUsersProgress(userIds) {
  const db = loadDB();
  return db.progress.filter(p => userIds.includes(p.userId));
}

// ── Curriculum Data ──────────────────────────────────────
const CURRICULUM = [
  {
    id: 'unit1', title: 'Moylley — Greetings', emoji: '👋',
    color: '#2563EB', colorLight: '#dbeafe', xpReward: 100,
    lessons: [
      {
        id: 'l1_1', title: 'Hello & Goodbye', type: 'matchup',
        pairs: [
          { manx: 'Moghrey mie', english: 'Good morning' },
          { manx: 'Fastyr mie', english: 'Good afternoon' },
          { manx: 'Oie vie', english: 'Good night' },
          { manx: 'Slane lhiat', english: 'Goodbye' }
        ]
      },
      {
        id: 'l1_2', title: 'How are you?', type: 'pattern',
        sentences: [
          { template: "Cre'n aght t'ou?", answer: 'Mie', options: ['Mie', 'Moghrey', 'Slane', 'Oie'], translation: 'How are you? — Good' },
          { template: 'Ta mee ___', answer: 'braew', options: ['braew', 'vie', 'lhiat', 'mie'], translation: 'I am fine' },
          { template: '___ mie', answer: 'Moghrey', options: ['Moghrey', 'Fastyr', 'Oie', 'Slane'], translation: 'Good morning' }
        ]
      },
      {
        id: 'milestone_1', title: 'Grammar Milestone', type: 'milestone',
        concept: 'Manx Greetings & Time of Day',
        explanation: `In Manx, greetings change based on the time of day — just like in English!
          "Moghrey" means "morning", "Fastyr" means "afternoon/evening", and "Oie" means "night".
          You combine these with "mie" (good) to make greetings.
          When you say goodbye, you say "Slane lhiat" — which actually means "Health be with you!" Isn't that lovely?`,
        teacherNote: 'Students often mix up "Fastyr mie" (afternoon) and "Oie vie" (night). Try role-play greetings at different times of day.'
      }
    ],
    test: {
      questions: [
        { q: 'What does "Moghrey mie" mean?', options: ['Good night', 'Good morning', 'Good afternoon', 'Goodbye'], answer: 1 },
        { q: 'How do you say "Goodbye" in Manx?', options: ['Oie vie', 'Ta mee mie', 'Slane lhiat', 'Fastyr mie'], answer: 2 },
        { q: 'What does "mie" mean?', options: ['Hello', 'Night', 'Good', 'Morning'], answer: 2 },
        { q: '"Cre\'n aght t\'ou?" means…', options: ['What time is it?', 'How are you?', 'Where are you?', 'Who are you?'], answer: 1 },
        { q: 'Which greeting would you use in the evening?', options: ['Moghrey mie', 'Slane lhiat', 'Fastyr mie', 'Cre\'n aght'], answer: 2 }
      ]
    }
  },
  {
    id: 'unit2', title: 'Earrooyn — Numbers', emoji: '🔢',
    color: '#F59E0B', colorLight: '#fef3c7', xpReward: 120,
    lessons: [
      {
        id: 'l2_1', title: 'Numbers 1–5', type: 'matchup',
        pairs: [
          { manx: 'Nane', english: 'One' },
          { manx: 'Jees', english: 'Two' },
          { manx: 'Tree', english: 'Three' },
          { manx: 'Kiare', english: 'Four' },
          { manx: 'Queig', english: 'Five' }
        ]
      },
      {
        id: 'l2_2', title: 'Numbers 6–10', type: 'matchup',
        pairs: [
          { manx: 'Shey', english: 'Six' },
          { manx: 'Shiaght', english: 'Seven' },
          { manx: 'Hoght', english: 'Eight' },
          { manx: 'Nuy', english: 'Nine' },
          { manx: 'Jeih', english: 'Ten' }
        ]
      },
      {
        id: 'milestone_2', title: 'Grammar Milestone', type: 'milestone',
        concept: 'How Manx Counting Works',
        explanation: `Manx uses a traditional Celtic counting system. Notice how "Tree" (three) sounds a bit like the English word — that's because both come from the same ancient language roots!
          In old Manx, people counted in groups of twenty (like French still does).
          So 40 would be "daa feed" — meaning "two twenties"! This is called a vigesimal system.
          For now, just focus on learning 1–10. You're doing brilliantly!`,
        teacherNote: 'The vigesimal system can fascinate older learners. Stick to 1-10 for this age group but mention it as a fun fact.'
      }
    ],
    test: {
      questions: [
        { q: 'What is "Jees" in English?', options: ['One', 'Two', 'Three', 'Four'], answer: 1 },
        { q: 'How do you say "Seven" in Manx?', options: ['Shey', 'Hoght', 'Shiaght', 'Nuy'], answer: 2 },
        { q: 'What number is "Queig"?', options: ['3', '4', '5', '6'], answer: 2 },
        { q: '"Jeih" means…', options: ['Eight', 'Nine', 'Ten', 'Seven'], answer: 2 },
        { q: 'Which of these is NOT a Manx number?', options: ['Nane', 'Kiare', 'Moghrey', 'Nuy'], answer: 2 }
      ]
    }
  },
  {
    id: 'unit3', title: 'Daahyn — Colours', emoji: '🎨',
    color: '#EC4899', colorLight: '#fce7f3', xpReward: 130,
    lessons: [
      {
        id: 'l3_1', title: 'Basic Colours', type: 'matchup',
        pairs: [
          { manx: 'Jiarg', english: 'Red' },
          { manx: 'Buigh', english: 'Yellow' },
          { manx: 'Gorrym', english: 'Blue' },
          { manx: 'Uiney', english: 'Green' },
          { manx: 'Doo', english: 'Black' }
        ]
      },
      {
        id: 'l3_2', title: 'Colours in Sentences', type: 'pattern',
        sentences: [
          { template: 'Ta\'n aer ___', answer: 'gorrym', options: ['gorrym', 'jiarg', 'buigh', 'doo'], translation: 'The sky is blue' },
          { template: 'Ta\'n geay ___', answer: 'feayr', options: ['feayr', 'cheh', 'braew', 'mie'], translation: 'The wind is cold' },
          { template: 'Ta\'n baa ___', answer: 'bane', options: ['bane', 'jiarg', 'uiney', 'gorrym'], translation: 'The cow is white' }
        ]
      },
      {
        id: 'milestone_3', title: 'Grammar Milestone', type: 'milestone',
        concept: 'Adjectives & Lenition in Manx',
        explanation: `In Manx, adjectives usually come AFTER the noun — the opposite of English!
          So "red car" becomes "gleashtan jiarg" (literally: "car red").
          There's also a special Manx grammar rule called LENITION (or "softening").
          Sometimes the first letter of a word changes sound after certain words. For example,
          "mooar" (big) can become "vooar" after the word "ta".
          Don't worry — you'll learn this gradually. Your brain is amazing at spotting patterns!`,
        teacherNote: 'Lenition is a key Celtic grammar feature. Introduce it gently — recognition before production. Use flashcards with before/after pairs.'
      }
    ],
    test: {
      questions: [
        { q: 'What colour is "Jiarg"?', options: ['Blue', 'Green', 'Red', 'Yellow'], answer: 2 },
        { q: '"Gorrym" means…', options: ['Green', 'Blue', 'Black', 'White'], answer: 1 },
        { q: 'In Manx, where does the adjective go?', options: ['Before the noun', 'After the noun', 'At the start', 'Anywhere'], answer: 1 },
        { q: 'How do you say "Yellow" in Manx?', options: ['Uiney', 'Doo', 'Buigh', 'Bane'], answer: 2 },
        { q: '"Ta\'n aer gorrym" means…', options: ['The sea is green', 'The sky is blue', 'The sun is yellow', 'The grass is red'], answer: 1 }
      ]
    }
  }
];

window.ML = {
  generateSalt, hashPassword, verifyPassword,
  ensureReady, loadDB, saveDB, registerUser, loginUser, logoutUser, currentSession, getUser,
  getProgress, saveProgress, addTestScore, markLessonComplete,
  getClassroomsForTeacher, getClassroom, createClassroom, joinClassroom,
  getAssignmentsForClassroom, createAssignment, getStudentClassroom, getUsersProgress,
  CURRICULUM
};
