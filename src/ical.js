const express = require('express');
const crypto  = require('crypto');
const db      = require('./database');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// Genereer of haal het ical-token op voor de ingelogde gebruiker
router.get('/token', requireAuth, (req, res) => {
  const userId = req.session.userId;
  let user = db.prepare('SELECT ical_token FROM users WHERE id = ?').get(userId);

  if (!user.ical_token) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE users SET ical_token = ? WHERE id = ?').run(token, userId);
    user = { ical_token: token };
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ token: user.ical_token, url: `${baseUrl}/api/ical/${user.ical_token}.ics` });
});

// Vernieuw het ical-token (maakt oude link ongeldig)
router.post('/token/regenerate', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const token  = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET ical_token = ? WHERE id = ?').run(token, userId);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ token, url: `${baseUrl}/api/ical/${token}.ics` });
});

// iCal feed (publiek, token als authenticatie)
router.get('/:token.ics', (req, res) => {
  const token = req.params.token;
  const user  = db.prepare('SELECT id, display_name FROM users WHERE ical_token = ?').get(token);
  if (!user) return res.status(404).send('Niet gevonden');

  // Haal alle toekomstige + afgelopen 30 dagen potjes op
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const bookings = db.prepare(`
    SELECT b.id, b.date, b.start_time, b.end_time, b.notes, b.location,
           u.display_name AS creator_name,
           (SELECT GROUP_CONCAT(u2.display_name, ', ')
            FROM participants p2 JOIN users u2 ON p2.user_id = u2.id
            WHERE p2.booking_id = b.id) AS player_names,
           (SELECT COUNT(*) FROM booking_guests bg WHERE bg.booking_id = b.id) AS guest_count
    FROM bookings b
    JOIN users u ON b.created_by = u.id
    WHERE b.date >= ?
      AND (b.created_by = ?
           OR EXISTS (SELECT 1 FROM participants WHERE booking_id = b.id AND user_id = ?))
    ORDER BY b.date ASC, b.start_time ASC
  `).all(cutoffStr, user.id, user.id);

  const now = formatIcalDate(new Date());

  const events = bookings.map(b => {
    const dtStart = `${b.date.replace(/-/g, '')}T${b.start_time.replace(':', '')}00`;
    const dtEnd   = `${b.date.replace(/-/g, '')}T${b.end_time.replace(':', '')}00`;

    const players = [b.player_names, b.guest_count > 0 ? `+${b.guest_count} gast${b.guest_count > 1 ? 'en' : ''}` : '']
      .filter(Boolean).join(' | ');

    const desc = [
      players ? `Spelers: ${players}` : '',
      b.notes ? `Notities: ${b.notes}` : '',
    ].filter(Boolean).join('\\n');

    const lines = [
      'BEGIN:VEVENT',
      `UID:padelpotje-${b.id}@padelpotje`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Europe/Amsterdam:${dtStart}`,
      `DTEND;TZID=Europe/Amsterdam:${dtEnd}`,
      `SUMMARY:Padelpotje`,
      desc   ? `DESCRIPTION:${icalEscape(desc)}`   : '',
      `STATUS:CONFIRMED`,
      'END:VEVENT',
    ].filter(Boolean);

    return lines.join('\r\n');
  });

  const cal = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PadelPotje//NL',
    `X-WR-CALNAME:Potjes van ${user.display_name}`,
    'X-WR-CALDESC:Jouw geplande padelpotjes',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:Europe/Amsterdam',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="padelpotjes.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(cal);
});

function formatIcalDate(d) {
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
}

function icalEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

module.exports = router;
