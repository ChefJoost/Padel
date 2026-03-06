/* ============================================================
   Padel Planner — Frontend logic
   ============================================================ */

let currentUser = null;
let currentDetailId = null;

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  try {
    const res = await api('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      setUser(data);
      showApp();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

/* ── API helper ───────────────────────────────────────────── */
async function api(url, options = {}) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

/* ── Auth UI ──────────────────────────────────────────────── */
function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-greeting').textContent = `Hoi, ${currentUser.display_name}!`;
  loadBookings();
}

function setUser(data) {
  currentUser = { userId: data.userId, display_name: data.display_name };
}

function showTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
}

async function handleLogin(e) {
  e.preventDefault();
  clearError('login-error');
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  const res = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  const data = await res.json();
  if (!res.ok) return showError('login-error', data.error);

  setUser(data);
  showApp();
}

async function handleRegister(e) {
  e.preventDefault();
  clearError('register-error');
  const display_name = document.getElementById('reg-display-name').value;
  const username     = document.getElementById('reg-username').value;
  const password     = document.getElementById('reg-password').value;

  const res = await api('/api/auth/register', { method: 'POST', body: { username, display_name, password } });
  const data = await res.json();
  if (!res.ok) return showError('register-error', data.error);

  setUser(data);
  showApp();
}

async function handleLogout() {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  showAuth();
}

/* ── Bookings list ────────────────────────────────────────── */
async function loadBookings() {
  const res = await api('/api/bookings');
  const bookings = await res.json();

  const list = document.getElementById('bookings-list');
  const empty = document.getElementById('bookings-empty');
  list.innerHTML = '';

  if (!bookings.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  bookings.forEach(b => {
    list.appendChild(buildCard(b));
  });
}

function buildCard(b) {
  const playerCount = b.player_count || 0;
  const extraCount  = b.extra_count  || 0;
  const isFull      = playerCount >= 4 && extraCount >= 1;
  const hasExtra    = extraCount > 0;

  const card = document.createElement('div');
  card.className = `booking-card${isFull ? ' full' : hasExtra ? ' has-extra' : ''}`;
  card.onclick = () => showDetailModal(b.id);

  // Spots visualisatie
  let spots = '';
  for (let i = 0; i < 4; i++) {
    if (i < playerCount) spots += `<div class="spot filled" title="Speler ${i + 1}">✓</div>`;
    else spots += `<div class="spot empty" title="Vrije plek">${i + 1}</div>`;
  }
  if (extraCount > 0) {
    spots += `<div class="spot extra" title="Extra man">+1</div>`;
  } else if (playerCount >= 4) {
    spots += `<div class="spot empty" title="Extra man (vrij)">+1</div>`;
  }

  // Badge
  let badge = '';
  if (b.user_joined) {
    badge = b.user_is_extra
      ? `<span class="booking-badge badge-extra">Jij bent extra</span>`
      : `<span class="booking-badge badge-joined">Jij speelt mee</span>`;
  } else if (isFull) {
    badge = `<span class="booking-badge badge-full">Vol</span>`;
  } else {
    const free = 4 - playerCount;
    badge = `<span class="booking-badge badge-open">${free} plek${free > 1 ? 'ken' : ''} vrij</span>`;
  }

  const dateStr = formatDate(b.date);

  card.innerHTML = `
    <div class="booking-card-title">${escHtml(b.title)}</div>
    <div class="booking-card-meta">
      <span>📅 ${dateStr}</span>
      <span>🕐 ${b.start_time} – ${b.end_time}</span>
      <span>📍 ${escHtml(b.location)}</span>
    </div>
    <div class="spots-bar">${spots}</div>
    <div>${badge}</div>
  `;

  return card;
}

/* ── Detail modal ─────────────────────────────────────────── */
async function showDetailModal(id) {
  currentDetailId = id;
  clearError('detail-error');

  const res = await api(`/api/bookings/${id}`);
  const b = await res.json();

  document.getElementById('detail-title').textContent = b.title;

  const playerCount = b.player_count || 0;
  const extraCount  = b.extra_count  || 0;
  const isFull      = playerCount >= 4 && extraCount >= 1;

  // Info
  let infoHtml = `
    <dl class="detail-info">
      <dt>Datum</dt>      <dd>${formatDate(b.date)}</dd>
      <dt>Tijd</dt>       <dd>${b.start_time} – ${b.end_time}</dd>
      <dt>Locatie</dt>    <dd>${escHtml(b.location)}</dd>
      <dt>Aangemaakt door</dt> <dd>${escHtml(b.creator_name)}</dd>
      ${b.notes ? `<dt>Notities</dt><dd>${escHtml(b.notes)}</dd>` : ''}
    </dl>
  `;

  // Deelnemers
  const players = b.participants.filter(p => !p.is_extra);
  const extras  = b.participants.filter(p => p.is_extra);

  let partHtml = `<div class="participants-section">
    <h3>Spelers (${playerCount}/4)</h3>
    <ul class="participant-list">`;

  if (players.length === 0) {
    partHtml += `<li><span class="picon">➖</span> Nog niemand</li>`;
  } else {
    players.forEach(p => {
      partHtml += `<li><span class="picon">🎾</span> ${escHtml(p.display_name)}</li>`;
    });
  }
  // Lege plekken
  for (let i = players.length; i < 4; i++) {
    partHtml += `<li style="opacity:.4"><span class="picon">⬜</span> Vrije plek</li>`;
  }
  partHtml += `</ul>`;

  // Extra man
  partHtml += `<h3>Extra man</h3><ul class="participant-list">`;
  if (extras.length > 0) {
    extras.forEach(p => {
      partHtml += `<li><span class="picon">➕</span> ${escHtml(p.display_name)}</li>`;
    });
  } else {
    partHtml += `<li style="opacity:.4"><span class="picon">⬜</span> Vrij</li>`;
  }
  partHtml += `</ul></div>`;

  document.getElementById('detail-content').innerHTML = infoHtml + partHtml;

  // Actieknoppen
  const actions = document.getElementById('detail-actions');
  actions.innerHTML = '';

  const isCreator = b.created_by === currentUser.userId;

  if (isCreator) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Boeking verwijderen';
    delBtn.onclick = handleDeleteBooking;
    actions.appendChild(delBtn);
  } else if (b.user_joined) {
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'btn btn-outline';
    leaveBtn.textContent = 'Uitschrijven';
    leaveBtn.onclick = handleLeaveBooking;
    actions.appendChild(leaveBtn);
  } else if (!isFull) {
    const joinBtn = document.createElement('button');
    joinBtn.className = 'btn btn-primary';
    joinBtn.textContent = playerCount >= 4 ? 'Inschrijven als extra' : 'Inschrijven';
    joinBtn.onclick = handleJoinBooking;
    actions.appendChild(joinBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-outline';
  closeBtn.textContent = 'Sluiten';
  closeBtn.onclick = hideDetailModal;
  actions.appendChild(closeBtn);

  document.getElementById('detail-modal').classList.remove('hidden');
}

function hideDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  currentDetailId = null;
}

async function handleJoinBooking() {
  clearError('detail-error');
  const res = await api(`/api/bookings/${currentDetailId}/join`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);

  hideDetailModal();
  loadBookings();
}

async function handleLeaveBooking() {
  clearError('detail-error');
  const res = await api(`/api/bookings/${currentDetailId}/join`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);

  hideDetailModal();
  loadBookings();
}

async function handleDeleteBooking() {
  if (!confirm('Weet je zeker dat je deze boeking wilt verwijderen?')) return;
  clearError('detail-error');
  const res = await api(`/api/bookings/${currentDetailId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);

  hideDetailModal();
  loadBookings();
}

/* ── New booking modal ────────────────────────────────────── */
function showNewBookingModal() {
  // Datum op vandaag zetten als standaard
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('b-date').value = today;
  document.getElementById('b-date').min = today;
  clearError('booking-error');
  document.getElementById('booking-modal').classList.remove('hidden');
}

function hideNewBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
}

async function handleCreateBooking(e) {
  e.preventDefault();
  clearError('booking-error');

  const body = {
    title:      document.getElementById('b-title').value,
    location:   document.getElementById('b-location').value,
    date:       document.getElementById('b-date').value,
    start_time: document.getElementById('b-start').value,
    end_time:   document.getElementById('b-end').value,
    notes:      document.getElementById('b-notes').value,
  };

  const res = await api('/api/bookings', { method: 'POST', body });
  const data = await res.json();
  if (!res.ok) return showError('booking-error', data.error);

  hideNewBookingModal();
  loadBookings();
}

/* ── Modal backdrop click ─────────────────────────────────── */
function closeModal(e) {
  if (e.target === e.currentTarget) {
    hideNewBookingModal();
    hideDetailModal();
  }
}

/* ── Helpers ──────────────────────────────────────────────── */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' });
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.classList.add('hidden');
}

/* ── Start ────────────────────────────────────────────────── */
init();
