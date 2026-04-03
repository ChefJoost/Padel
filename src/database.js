const Database = require('better-sqlite3');
const path = require('path');

// DATA_DIR env var voor cloud deployments (bijv. Railway persistent volume)
const fs = require('fs');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(dataDir, 'padel.db');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// WAL mode voor betere performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema aanmaken
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    is_extra INTEGER NOT NULL DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(booking_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migraties: nieuwe kolommen toevoegen aan bestaande tabellen
const migrate = (sql) => { try { db.exec(sql); } catch (_) {} };
migrate('ALTER TABLE users ADD COLUMN level INTEGER');
migrate('ALTER TABLE users ADD COLUMN avatar TEXT');
migrate('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
migrate('ALTER TABLE bookings ADD COLUMN payment_url TEXT');
migrate('ALTER TABLE participants ADD COLUMN paid_at DATETIME');
migrate('ALTER TABLE bookings ADD COLUMN is_private INTEGER DEFAULT 0');
migrate('ALTER TABLE bookings ADD COLUMN invite_token TEXT');
migrate('ALTER TABLE bookings ADD COLUMN series_id TEXT');
migrate(`CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,
  target_id  INTEGER,
  details    TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
migrate('ALTER TABLE bookings ADD COLUMN level INTEGER');
migrate(`CREATE TABLE IF NOT EXISTS booking_guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  added_by INTEGER REFERENCES users(id),
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

migrate(`CREATE TABLE IF NOT EXISTS buddy_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(from_user_id, to_user_id)
)`);
migrate(`CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  read_at      DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Stel standaard admin in — alleen als er nog helemaal geen admin bestaat
// Gebruik ADMIN_USERNAME env-variabele of val terug op 'joosts'
const adminUsername = process.env.ADMIN_USERNAME || 'joosts';
db.prepare(`
  UPDATE users SET is_admin = 1
  WHERE username = ?
    AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)
`).run(adminUsername);

module.exports = db;
