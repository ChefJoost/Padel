const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./database');

const router = express.Router();

function validatePassword(pw) {
  if (pw.length < 8)          return 'Wachtwoord moet minimaal 8 tekens zijn';
  if (!/[A-Z]/.test(pw))      return 'Wachtwoord moet minimaal 1 hoofdletter bevatten';
  if (!/[a-z]/.test(pw))      return 'Wachtwoord moet minimaal 1 kleine letter bevatten';
  if (!/[0-9]/.test(pw))      return 'Wachtwoord moet minimaal 1 cijfer bevatten';
  return null;
}

// Registreren
router.post('/register', async (req, res) => {
  const { username, display_name, password, level } = req.body;

  if (!username || !display_name || !password) {
    return res.status(400).json({ error: 'Vul alle velden in' });
  }

  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Gebruikersnaam is al in gebruik' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username, display_name, password_hash, level) VALUES (?, ?, ?, ?)'
    ).run(username.toLowerCase(), display_name, hash, null);

    req.session.userId = result.lastInsertRowid;
    req.session.displayName = display_name;
    req.session.username = username.toLowerCase();
    req.session.level = null;

    res.json({ success: true, userId: result.lastInsertRowid, display_name, username: username.toLowerCase(), level: null });
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
    req.session.username = user.username;
    req.session.level = user.level;

    res.json({ success: true, userId: user.id, display_name: user.display_name, username: user.username, level: user.level });
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
  const user = db.prepare('SELECT avatar, is_admin FROM users WHERE id = ?').get(req.session.userId);
  res.json({
    userId:       req.session.userId,
    display_name: req.session.displayName,
    username:     req.session.username || null,
    level:        req.session.level || null,
    avatar:       user?.avatar || null,
    is_admin:     !!user?.is_admin,
  });
});

// Profiel bijwerken
router.put('/profile', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });

  const { display_name, username, level, current_password, new_password, avatar } = req.body;
  const userId = req.session.userId;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });

  // Wachtwoord wijzigen vereist huidig wachtwoord
  if (new_password) {
    if (!current_password) return res.status(400).json({ error: 'Voer je huidige wachtwoord in' });
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Huidig wachtwoord is onjuist' });
    const pwError = validatePassword(new_password);
    if (pwError) return res.status(400).json({ error: pwError });
  }

  // Gebruikersnaam uniekheidscheck
  if (username && username.toLowerCase() !== user.username) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.toLowerCase(), userId);
    if (existing) return res.status(409).json({ error: 'Gebruikersnaam is al in gebruik' });
  }

  const lvl = level ? parseInt(level, 10) : user.level;
  if (lvl && (lvl < 1 || lvl > 9)) return res.status(400).json({ error: 'Niveau moet tussen 1 en 9 zijn' });

  try {
    let hash = user.password_hash;
    if (new_password) hash = await bcrypt.hash(new_password, 12);

    db.prepare(`
      UPDATE users SET
        display_name  = ?,
        username      = ?,
        level         = ?,
        password_hash = ?,
        avatar        = ?
      WHERE id = ?
    `).run(
      display_name || user.display_name,
      username ? username.toLowerCase() : user.username,
      lvl || null,
      hash,
      avatar !== undefined ? avatar : user.avatar,
      userId
    );

    // Sessie bijwerken
    req.session.displayName = display_name || user.display_name;
    req.session.username = username ? username.toLowerCase() : user.username;
    req.session.level = lvl || null;

    res.json({
      success: true,
      display_name: req.session.displayName,
      username: username ? username.toLowerCase() : user.username,
      level: req.session.level,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server fout bij opslaan' });
  }
});

// Wachtwoord resetten (zonder ingelogd te zijn, via gebruikersnaam + weergavenaam)
router.post('/reset-password', async (req, res) => {
  const { username, display_name, new_password } = req.body;

  if (!username || !display_name || !new_password) {
    return res.status(400).json({ error: 'Vul alle velden in' });
  }
  const pwError = validatePassword(new_password);
  if (pwError) return res.status(400).json({ error: pwError });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());

  if (!user || user.display_name.toLowerCase() !== display_name.trim().toLowerCase()) {
    return res.status(401).json({ error: 'Gebruikersnaam en weergavenaam komen niet overeen' });
  }

  try {
    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server fout bij opslaan' });
  }
});

module.exports = router;
