const express = require('express');
const router = express.Router();
const db = require('./database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// GET /api/availability?year=YYYY&month=M
// Geeft beschikbaarheid terug voor alle gebruikers in de opgegeven maand
router.get('/', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const year  = parseInt(req.query.year,  10);
  const month = parseInt(req.query.month, 10);

  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Ongeldige jaar/maand' });
  }

  const pad   = (n) => String(n).padStart(2, '0');
  const from  = `${year}-${pad(month)}-01`;
  const toDay = new Date(year, month, 0).getDate(); // laatste dag van de maand
  const to    = `${year}-${pad(month)}-${pad(toDay)}`;

  const rows = db.prepare(`
    SELECT a.date, a.user_id,
           u.display_name, u.avatar, u.level
    FROM availability a
    JOIN users u ON u.id = a.user_id
    WHERE a.date >= ? AND a.date <= ?
    ORDER BY a.date, u.display_name
  `).all(from, to);

  // Groepeer per datum
  const dates = {};
  for (const row of rows) {
    if (!dates[row.date]) {
      dates[row.date] = { count: 0, me: false, users: [] };
    }
    dates[row.date].count++;
    dates[row.date].users.push({
      id:           row.user_id,
      display_name: row.display_name,
      avatar:       row.avatar,
      level:        row.level,
    });
    if (row.user_id === userId) {
      dates[row.date].me = true;
    }
  }

  res.json({ dates });
});

// POST /api/availability/:date  → zet beschikbaar
router.post('/:date', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const date   = req.params.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Ongeldige datum (verwacht YYYY-MM-DD)' });
  }

  db.prepare(`
    INSERT OR IGNORE INTO availability (user_id, date) VALUES (?, ?)
  `).run(userId, date);

  res.json({ available: true });
});

// DELETE /api/availability/:date  → verwijder beschikbaarheid
router.delete('/:date', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const date   = req.params.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Ongeldige datum (verwacht YYYY-MM-DD)' });
  }

  db.prepare(`
    DELETE FROM availability WHERE user_id = ? AND date = ?
  `).run(userId, date);

  res.json({ available: false });
});

module.exports = router;
