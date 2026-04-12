const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();

// DATA_DIR env var voor cloud deployments (bijv. Railway persistent volume)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const SqliteStore = require('connect-sqlite3')(session);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  store: new SqliteStore({
    db: 'sessions.db',
    dir: dataDir,
  }),
  secret: process.env.SESSION_SECRET || 'padel-geheim-sleutel-verander-dit',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dagen
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Routes
app.use('/api/auth', require('./auth'));
app.use('/api/bookings', require('./bookings'));
app.use('/api/push', require('./push').router);
app.use('/api/admin', require('./admin'));

// Alle andere routes → index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Padel booking app draait op http://localhost:${PORT}`);
});
