const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();

// DATA_DIR env var voor cloud deployments (bijv. Railway persistent volume)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const SqliteStore = require('connect-sqlite3')(session);

app.use(express.json({ limit: '2mb' }));

// Rate limiting op auth-endpoints: max 20 pogingen per 15 minuten per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel pogingen. Probeer het over 15 minuten opnieuw.' },
});

// Statische bestanden: JS/CSS mogen gecached worden, HTML nooit
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

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
    secure: process.env.NODE_ENV === 'production',
  },
}));

// Versie-check (helpt bevestigen welke deploy actief is)
app.get('/api/version', (req, res) => res.json({ version: 'e892201', ts: new Date().toISOString() }));

// Routes
app.use('/api/auth', authLimiter, require('./auth'));
app.use('/api/bookings', require('./bookings'));
app.use('/api/buddies', require('./buddies'));
app.use('/api/push', require('./push').router);
app.use('/api/admin', require('./admin'));
app.use('/api/ical',  require('./ical'));
app.use('/api/groups', require('./groups'));
app.use('/api/communities', require('./communities'));

// Alle andere routes → index.html (SPA) – nooit cachen zodat nieuwe JS altijd geladen wordt
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Padel booking app draait op http://localhost:${PORT}`);
});
