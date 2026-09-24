// Tijdzone instellen vóór alles, zodat SQLite datetime('now','localtime') klopt (#8)
process.env.TZ = process.env.TZ || 'Europe/Amsterdam';

const express = require('express');
const helmet  = require('helmet');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();

// Beveiligingsheaders (#12)
app.use(helmet({ contentSecurityPolicy: false }));

// Waarschuw bij ontbrekende SESSION_SECRET in productie (#1)
if (!process.env.SESSION_SECRET) {
  console.warn('[server] WAARSCHUWING: SESSION_SECRET niet ingesteld – gebruik een veilig geheim in productie!');
}

// DATA_DIR env var voor cloud deployments (bijv. Railway persistent volume)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const SqliteStore = require('connect-sqlite3')(session);

app.use(express.json({ limit: '4mb' }));

// Profielfoto's worden opgeslagen in DATA_DIR/avatars/ en geserveerd als /avatars/*
const avatarsDir = path.join(dataDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
app.use('/avatars', express.static(avatarsDir));

// Rate limiting (#13)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel pogingen. Probeer het over 15 minuten opnieuw.' },
});

// Chat en boeking-aanmaken: max 60 per minuut per IP
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel verzoeken. Wacht even.' },
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

// Versie-check
const { version } = require('../package.json');
app.get('/api/version', (req, res) => res.json({
  version,
  commit: process.env.GIT_COMMIT || 'dev',
  ts: new Date().toISOString(),
}));

// Routes
app.use('/api/auth', authLimiter, require('./auth'));
app.use('/api/bookings', writeLimiter, require('./bookings'));
app.use('/api/buddies', writeLimiter, require('./buddies'));
app.use('/api/push', require('./push').router);
app.use('/api/admin', require('./admin'));
app.use('/api/ical',  require('./ical'));
app.use('/api/groups', writeLimiter, require('./groups'));
app.use('/api/communities', require('./communities'));
app.use('/api/notifications', require('./notifications').router);

// SPA catch-all – alleen voor niet-API routes (#5 audit)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler (#11)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] onverwachte fout:', err.message);
  res.status(500).json({ error: 'Er is een serverfout opgetreden' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Padel booking app draait op http://localhost:${PORT}`);
});

// Graceful shutdown (#16)
function shutdown() {
  server.close(() => {
    const db = require('./database');
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
