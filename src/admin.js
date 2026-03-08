const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./database');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Geen admin rechten' });
  }
  next();
}

// Dashboard stats
router.get('/stats', requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const totalBookings = db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count;
  const pastBookings = db.prepare(
    "SELECT COUNT(*) AS count FROM bookings WHERE datetime(date || ' ' || end_time) < datetime('now', 'localtime')"
  ).get().count;
  const upcomingBookings = db.prepare(
    "SELECT COUNT(*) AS count FROM bookings WHERE datetime(date || ' ' || end_time) >= datetime('now', 'localtime')"
  ).get().count;
  res.json({ totalUsers, totalBookings, pastBookings, upcomingBookings });
});

// Alle gebruikers ophalen (met zoeken)
router.get('/users', requireAdmin, (req, res) => {
  const search = req.query.q || '';
  let users;
  if (search) {
    users = db.prepare(`
      SELECT id, username, display_name, level, is_admin, created_at,
        (SELECT COUNT(*) FROM participants WHERE user_id = users.id) AS booking_count
      FROM users
      WHERE username LIKE ? OR display_name LIKE ?
      ORDER BY created_at DESC
    `).all(`%${search}%`, `%${search}%`);
  } else {
    users = db.prepare(`
      SELECT id, username, display_name, level, is_admin, created_at,
        (SELECT COUNT(*) FROM participants WHERE user_id = users.id) AS booking_count
      FROM users ORDER BY created_at DESC
    `).all();
  }
  res.json(users);
});

// Gebruiker verwijderen
router.delete('/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId === req.session.userId) {
    return res.status(400).json({ error: 'Je kunt jezelf niet verwijderen' });
  }
  db.prepare('DELETE FROM participants WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM booking_guests WHERE added_by = ?').run(userId);
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  // Boekingen die door deze gebruiker zijn aangemaakt: verwijder ook
  db.prepare('DELETE FROM bookings WHERE created_by = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ success: true });
});

// Wachtwoord resetten (admin)
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' });
  }
  try {
    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server fout' });
  }
});

// Alle boekingen ophalen
router.get('/bookings', requireAdmin, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.id, b.title, b.date, b.start_time, b.end_time, b.notes,
      b.created_by, b.is_private, b.created_at,
      u.display_name AS creator_name,
      COUNT(p.id) + COALESCE((SELECT COUNT(*) FROM booking_guests bg WHERE bg.booking_id = b.id), 0) AS player_count
    FROM bookings b
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p ON b.id = p.booking_id
    GROUP BY b.id
    ORDER BY b.date DESC, b.start_time DESC
  `).all();
  res.json(bookings);
});

// Boeking details ophalen
router.get('/bookings/:id', requireAdmin, (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const booking = db.prepare(`
    SELECT b.*, u.display_name AS creator_name
    FROM bookings b JOIN users u ON b.created_by = u.id
    WHERE b.id = ?
  `).get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  const participants = db.prepare(`
    SELECT p.id, p.user_id, u.display_name, u.level, p.joined_at, 0 AS is_guest
    FROM participants p JOIN users u ON p.user_id = u.id
    WHERE p.booking_id = ? ORDER BY p.joined_at ASC
  `).all(bookingId);

  const guests = db.prepare(`
    SELECT id, guest_name AS display_name, 1 AS is_guest, added_at AS joined_at
    FROM booking_guests WHERE booking_id = ? ORDER BY added_at ASC
  `).all(bookingId);

  res.json({ ...booking, participants: [...participants, ...guests] });
});

// Boeking bijwerken
router.put('/bookings/:id', requireAdmin, (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const { title, date, start_time, end_time, notes } = req.body;
  db.prepare(`
    UPDATE bookings SET title = ?, date = ?, start_time = ?, end_time = ?, notes = ?
    WHERE id = ?
  `).run(title, date, start_time, end_time, notes || null, bookingId);
  res.json({ success: true });
});

// Boeking verwijderen
router.delete('/bookings/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// Deelnemer verwijderen uit boeking
router.delete('/bookings/:bookingId/participants/:participantId', requireAdmin, (req, res) => {
  const { bookingId, participantId } = req.params;
  // Probeer als reguliere deelnemer te verwijderen
  const result = db.prepare('DELETE FROM participants WHERE id = ? AND booking_id = ?')
    .run(parseInt(participantId, 10), parseInt(bookingId, 10));
  if (result.changes === 0) {
    // Probeer als gast
    db.prepare('DELETE FROM booking_guests WHERE id = ? AND booking_id = ?')
      .run(parseInt(participantId, 10), parseInt(bookingId, 10));
  }
  res.json({ success: true });
});

module.exports = router;
