// db.js
// SQLite-backed user store using Node's BUILT-IN sqlite module (node:sqlite,
// available since Node 22.5+). This ships inside Node itself - no separate
// package, no native compilation step, so it doesn't need Visual Studio
// Build Tools on Windows (or Xcode/gcc elsewhere) the way better-sqlite3
// did. It's still marked "experimental" by Node and may warn on startup;
// the API is stable enough for this app's simple needs.
//
// Replaces the old JSON-file store, which had no protection against two
// writes racing each other.
//
// If a legacy server/users.json exists from an older version of this app,
// it's imported into the DB once on first boot, then left alone (renamed
// to users.json.migrated so it's obvious the migration happened).

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = path.join(__dirname, 'users.db');
const LEGACY_JSON_FILE = path.join(__dirname, 'users.json');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;'); // safe concurrent reads while a write is in flight

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_username ON users (username COLLATE NOCASE);
`);

// ---- One-time migration from the old JSON-file store, if present ----
if (fs.existsSync(LEGACY_JSON_FILE)) {
  try {
    const legacyUsers = JSON.parse(fs.readFileSync(LEGACY_JSON_FILE, 'utf-8'));
    const insert = db.prepare(
      'INSERT OR IGNORE INTO users (id, username, passwordHash, createdAt) VALUES (@id, @username, @passwordHash, @createdAt)'
    );
    if (Array.isArray(legacyUsers) && legacyUsers.length > 0) {
      db.exec('BEGIN');
      try {
        for (const u of legacyUsers) insert.run(u);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      console.log(`Migrated ${legacyUsers.length} user(s) from users.json into users.db.`);
    }
    fs.renameSync(LEGACY_JSON_FILE, `${LEGACY_JSON_FILE}.migrated`);
  } catch (err) {
    console.warn('Found users.json but could not migrate it automatically:', err.message);
  }
}

const findUserByUsernameStmt = db.prepare(
  'SELECT * FROM users WHERE username = ? COLLATE NOCASE'
);
const insertUserStmt = db.prepare(
  'INSERT INTO users (id, username, passwordHash, createdAt) VALUES (@id, @username, @passwordHash, @createdAt)'
);

function findUserByUsername(username) {
  if (!username) return undefined;
  return findUserByUsernameStmt.get(username);
}

function createUser(user) {
  // Unique index on username means a race between two simultaneous
  // registrations for the same name is resolved by SQLite itself, not by
  // a read-then-write gap in application code.
  insertUserStmt.run(user);
  return user;
}

module.exports = { db, findUserByUsername, createUser };
