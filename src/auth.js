const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./database');

const router = express.Router();

// Registreren
router.post('/register', async (req, res) => {
  const { username, display_name, password, level } = req.body;

  if (!username || !display_name || !password) {
    return res.status(400).json({ error: 'Vul alle velden in' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Wachtwoord moet minimaal 6 tekens zijn' });
  }

  const lvl = parseInt(level, 10);
  if (!lvl || lvl < 1 || lvl > 9) {
    return res.status(400).json({ error: 'Kies een niveau tussen 1 en 9' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Gebruikersnaam is al in gebruik' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username, display_name, password_hash, level) VALUES (?, ?, ?, ?)'
    ).run(username.toLowerCase(), display_name, hash, lvl);

    req.session.userId = result.lastInsertRowid;
    req.session.displayName = display_name;
    req.session.level = lvl;

    res.json({ success: true, userId: result.lastInsertRowid, display_name, level: lvl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server fout bij registreren' });
  }
});

// Inloggen
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Vul gebruikersnaam en wachtwoord in' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Verkeerde gebruikersnaam of wachtwoord' });
  }

  try {
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Verkeerde gebruikersnaam of wachtwoord' });
    }

    req.session.userId = user.id;
    req.session.displayName = user.display_name;
    req.session.level = user.level;

    res.json({ success: true, userId: user.id, display_name: user.display_name, level: user.level });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server fout bij inloggen' });
  }
});

// Uitloggen
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Huidige gebruiker ophalen
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }
  res.json({
    userId: req.session.userId,
    display_name: req.session.displayName,
    level: req.session.level || null,
  });
});

module.exports = router;
