'use strict';
const Database = require('better-sqlite3');
const path = require('path');

let _db;

function getDb() {
  if (_db) return _db;
  // Vercel's filesystem is read-only except /tmp
  const dbPath = process.env.VERCEL
    ? '/tmp/manxlearn.db'
    : path.join(__dirname, '../manxlearn.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role         TEXT NOT NULL CHECK(role IN ('student','teacher')),
      created_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classrooms (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      teacher_id   TEXT NOT NULL,
      invite_code  TEXT UNIQUE NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classroom_students (
      classroom_id TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      joined_at    TEXT NOT NULL,
      PRIMARY KEY (classroom_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS progress (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL,
      unit_id             TEXT NOT NULL,
      lessons_completed   TEXT NOT NULL DEFAULT '[]',
      xp                  INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, unit_id)
    );
    CREATE TABLE IF NOT EXISTS test_scores (
      id        TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      unit_id   TEXT NOT NULL,
      score     INTEGER NOT NULL,
      taken_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id           TEXT PRIMARY KEY,
      classroom_id TEXT NOT NULL,
      unit_id      TEXT NOT NULL,
      title        TEXT NOT NULL,
      due_date     TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  `);
  return _db;
}

module.exports = { getDb };
