'use strict';
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS classrooms (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      teacher_id  TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_at  TEXT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS classroom_students (
      classroom_id TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      joined_at    TEXT NOT NULL,
      PRIMARY KEY (classroom_id, student_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS progress (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      unit_id           TEXT NOT NULL,
      lessons_completed TEXT NOT NULL DEFAULT '[]',
      xp                INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, unit_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS test_scores (
      id       TEXT PRIMARY KEY,
      user_id  TEXT NOT NULL,
      unit_id  TEXT NOT NULL,
      score    INTEGER NOT NULL,
      taken_at TEXT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS assignments (
      id           TEXT PRIMARY KEY,
      classroom_id TEXT NOT NULL,
      unit_id      TEXT NOT NULL,
      title        TEXT NOT NULL,
      due_date     TEXT NOT NULL,
      created_at   TEXT NOT NULL
    )`;
}

module.exports = { sql, initSchema };
