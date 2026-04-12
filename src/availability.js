const express = require('express');
const router = express.Router();
const db = require('./database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// GET /api/availability?year=YYYY&month=M
router.get('/', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const year  = parseInt(req.query.year,  10);
  const month = parseInt(req.query.month, 10);

  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Ongeldige jaar/maand' });
  }

  const pad   = (n) => String(n).padStart(2, '0');
  const from  = `${year}-${pad(month)}-01`;
  const toDay = new Date(year, month, 0).getDate();
  const to    = `${year}-${pad(month)}-${pad(toDay)}`;

  const rows = db.prepare(`
    SELECT a.date, a.user_id, a.start_time, a.end_time,
           u.display_name, u.avatar, u.level
    FROM availability a
    JOIN users u ON u.id = a.user_id
    WHERE a.date >= ? AND a.date <= ?
    ORDER BY a.date, a.start_time, u.display_name
  `).all(from, to);

  const dates = {};
  for (const row of rows) {
    if (!dates[row.date]) {
      dates[row.date] = { count: 0, me: false, myTimes: null, users: [] };
    }
    const userEntry = {
      id:           row.user_id,
      display_name: row.display_name,
      avatar:       row.avatar,
      level:        row.level,
      start_time:   row.start_time,
      end_time:     row.end_time,
    };
    dates[row.date].count++;
    dates[row.date].users.push(userEntry);
    if (row.user_id === userId) {
      dates[row.date].me = true;
      dates[row.date].myTimes = { start_time: row.start_time, end_time: row.end_time };
    }
  }

  res.json({ dates });
});

// POST /api/availability/:date  — zet beschikbaar (upsert met tijden)
router.post('/:date', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const date   = req.params.date;
  const { start_time = null, end_time = null } = req.body || {};

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Ongeldige datum (verwacht YYYY-MM-DD)' });
  }

  db.prepare(`
    INSERT INTO availability (user_id, date, start_time, end_time)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time
  `).run(userId, date, start_time, end_time);

  res.json({ available: true, start_time, end_time });
});

// DELETE /api/availability/:date  — verwijder beschikbaarheid
router.delete('/:date', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const date   = req.params.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Ongeldige datum (verwacht YYYY-MM-DD)' });
  }

  db.prepare(`DELETE FROM availability WHERE user_id = ? AND date = ?`).run(userId, date);

  res.json({ available: false });
});

module.exports = router;
