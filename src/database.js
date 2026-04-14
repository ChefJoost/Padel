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

  CREATE TABLE IF NOT EXISTS buddies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    buddy_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, buddy_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS booking_guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    guest_name TEXT NOT NULL,
    added_by INTEGER REFERENCES users(id),
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
  );
`);

// Migraties: ALTER TABLE heeft try/catch nodig (mislukt als kolom al bestaat)
// CREATE TABLE IF NOT EXISTS zit hierboven in db.exec – geen try/catch nodig
const migrate = (sql) => { try { db.exec(sql); } catch (_) {} };
migrate('ALTER TABLE users ADD COLUMN level INTEGER');
migrate('ALTER TABLE users ADD COLUMN avatar TEXT');
migrate('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
migrate('ALTER TABLE bookings ADD COLUMN payment_url TEXT');
migrate('ALTER TABLE participants ADD COLUMN paid_at DATETIME');
migrate('ALTER TABLE bookings ADD COLUMN is_private INTEGER DEFAULT 0');
migrate('ALTER TABLE bookings ADD COLUMN invite_token TEXT');
migrate('ALTER TABLE availability ADD COLUMN start_time TEXT');
migrate('ALTER TABLE availability ADD COLUMN end_time TEXT');

// Stel standaard admin in
migrate("UPDATE users SET is_admin = 1 WHERE username = 'joosts'");

module.exports = db;

// Controleer messages tabel schema bij opstarten (kan verkeerd schema hebben van oude deploy)
{
  const cols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  if (cols.length > 0 && !cols.includes('sender_id')) {
    console.log('[database] messages tabel heeft verkeerd schema, opnieuw aanmaken. Kolommen:', cols);
    db.exec('DROP TABLE messages');
    db.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME
    )`);
    console.log('[database] messages tabel opnieuw aangemaakt');
  }
}

// Log welke tabellen aanwezig zijn bij opstarten
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('[database] tabellen bij opstarten:', tables.map(t => t.name).join(', '));
