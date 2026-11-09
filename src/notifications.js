const express = require('express');
const router  = express.Router();
const db      = require('./database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// Helper: aanmaken notificatie vanuit andere routers
function createNotification(userId, { type, title, body = null, url = null }) {
  try {
    db.prepare(
      'INSERT INTO notifications (user_id, type, title, body, url) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, type, title, body, url);
  } catch (_) {}
}

// GET /api/notifications/unread
router.get('/unread', requireAuth, (req, res) => {
  try {
    const row = db.prepare(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL'
    ).get(req.session.userId);
    res.json({ count: row?.count ?? 0 });
  } catch (_) { res.json({ count: 0 }); }
});

// GET /api/notifications
router.get('/', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, type, title, body, url, read_at, created_at
      FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 50
    `).all(req.session.userId);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notifications/:id/read
router.post('/:id/read', requireAuth, (req, res) => {
  db.prepare(
    'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// POST /api/notifications/read-all
router.post('/read-all', requireAuth, (req, res) => {
  db.prepare(
    'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL'
  ).run(req.session.userId);
  res.json({ success: true });
});

// DELETE /api/notifications/:id
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

module.exports = { router, createNotification };
