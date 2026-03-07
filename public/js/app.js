/* ============================================================
   Padel Planner — Frontend logic
   ============================================================ */

let currentUser = null;
let currentDetailId = null;
let currentTab = 'potjes';
let pendingAvatar = undefined;
let bookingEditId = null; // null = nieuw, number = boeking-id dat bewerkt wordt

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  try {
    const res = await api('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      setUser(data);
      showApp();
      setupPush();
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
  loadBookings();
  renderProfile();
}

function setUser(data) {
  currentUser = {
    userId:       data.userId,
    display_name: data.display_name,
    username:     data.username,
    level:        data.level,
    avatar:       data.avatar || null,
  };
}

function showTab(tab, btn) {
  hideForgotPassword();
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function showForgotPassword() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('forgot-form').classList.remove('hidden');
  clearError('forgot-error');
  document.getElementById('forgot-username').value    = '';
  document.getElementById('forgot-display-name').value = '';
  document.getElementById('forgot-new-pw').value      = '';
}

function hideForgotPassword() {
  document.getElementById('forgot-form').classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
}

async function handleResetPassword(e) {
  e.preventDefault();
  clearError('forgot-error');
  const username     = document.getElementById('forgot-username').value.trim();
  const display_name = document.getElementById('forgot-display-name').value.trim();
  const new_password = document.getElementById('forgot-new-pw').value;
  const res  = await api('/api/auth/reset-password', { method: 'POST', body: { username, display_name, new_password } });
  const data = await res.json();
  if (!res.ok) return showError('forgot-error', data.error);
  hideForgotPassword();
  showError('login-error', 'Wachtwoord gewijzigd. Je kunt nu inloggen.');
  document.getElementById('login-error').style.color = 'var(--green)';
  document.getElementById('login-username').value = username;
}

async function handleLogin(e) {
  e.preventDefault();
  clearError('login-error');
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const res  = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  const data = await res.json();
  if (!res.ok) return showError('login-error', data.error);
  setUser(data);
  showApp();
  setupPush();
}

async function handleRegister(e) {
  e.preventDefault();
  clearError('register-error');
  const level = parseInt(document.getElementById('reg-level').value, 10);
  if (!level) return showError('register-error', 'Kies een speelniveau');
  const display_name = document.getElementById('reg-display-name').value;
  const username     = document.getElementById('reg-username').value;
  const password     = document.getElementById('reg-password').value;
  const res  = await api('/api/auth/register', { method: 'POST', body: { username, display_name, password, level } });
  const data = await res.json();
  if (!res.ok) return showError('register-error', data.error);
  setUser(data);
  showApp();
  setupPush();
}

async function handleLogout() {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  showAuth();
}

/* ── Tab navigatie ────────────────────────────────────────── */
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tab-potjes').classList.toggle('hidden', tab !== 'potjes');
  document.getElementById('tab-profiel').classList.toggle('hidden', tab !== 'profiel');
  document.getElementById('tab-btn-potjes').classList.toggle('active', tab === 'potjes');
  document.getElementById('tab-btn-profiel').classList.toggle('active', tab === 'profiel');
  if (tab === 'profiel') {
    loadHistory();
    loadUnpaid();
  }
}

/* ── Level picker ─────────────────────────────────────────── */
function initLevelPicker(pickerId, hiddenId) {
  document.querySelectorAll(`#${pickerId} .level-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${pickerId} .level-btn`).forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById(hiddenId).value = btn.dataset.level;
    });
  });
}

function setLevelPicker(pickerId, hiddenId, level) {
  document.querySelectorAll(`#${pickerId} .level-btn`).forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.level) === level);
  });
  if (level) document.getElementById(hiddenId).value = level;
}

document.addEventListener('DOMContentLoaded', () => {
  initLevelPicker('reg-level-picker',  'reg-level');
  initLevelPicker('edit-level-picker', 'edit-level');
});

/* ── Push notifications ───────────────────────────────────── */
async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const keyRes = await api('/api/push/vapid-public-key');
    const { key } = await keyRes.json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api('/api/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: sub.endpoint,
        p256dh:   btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
        auth:     btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))),
      },
    });
  } catch (err) {
    console.log('Push niet beschikbaar:', err.message);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...window.atob(base64)].map(c => c.charCodeAt(0)));
}

/* ── Profiel ──────────────────────────────────────────────── */
function renderAvatarEl(el, avatarUrl, displayName) {
  if (avatarUrl) {
    el.style.backgroundImage = `url('${avatarUrl}')`;
    el.style.backgroundSize  = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    const initials = displayName
      .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    el.textContent = initials;
  }
}

function renderProfile() {
  if (!currentUser) return;
  renderAvatarEl(document.getElementById('profile-avatar'), currentUser.avatar, currentUser.display_name);
  document.getElementById('profile-name').textContent    = currentUser.display_name;
  document.getElementById('profile-username').textContent = `@${currentUser.username || ''}`;
  const pill = document.getElementById('profile-level-pill');
  if (currentUser.level) {
    pill.textContent = `Niveau ${currentUser.level}`;
    pill.classList.remove('hidden');
  } else {
    pill.classList.add('hidden');
  }
}

function showProfileEdit() {
  clearError('profile-error');
  pendingAvatar = undefined;
  document.getElementById('edit-display-name').value = currentUser.display_name;
  document.getElementById('edit-username').value     = currentUser.username || '';
  document.getElementById('edit-current-pw').value   = '';
  document.getElementById('edit-new-pw').value       = '';
  document.getElementById('avatar-file-input').value = '';
  setLevelPicker('edit-level-picker', 'edit-level', currentUser.level);
  renderAvatarEl(document.getElementById('edit-avatar-preview'), currentUser.avatar, currentUser.display_name);
  document.getElementById('profile-modal').classList.remove('hidden');
}

function hideProfileEdit() {
  document.getElementById('profile-modal').classList.add('hidden');
}

function handleAvatarChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 300;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const min = Math.min(img.width, img.height);
      const sx = (img.width  - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      pendingAvatar = canvas.toDataURL('image/jpeg', 0.8);
      renderAvatarEl(document.getElementById('edit-avatar-preview'), pendingAvatar,
        document.getElementById('edit-display-name').value || currentUser.display_name);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function handleSaveProfile() {
  clearError('profile-error');
  const display_name     = document.getElementById('edit-display-name').value.trim();
  const username         = document.getElementById('edit-username').value.trim();
  const level            = parseInt(document.getElementById('edit-level').value, 10) || null;
  const current_password = document.getElementById('edit-current-pw').value;
  const new_password     = document.getElementById('edit-new-pw').value;

  const body = { display_name, username, level };
  if (new_password) { body.current_password = current_password; body.new_password = new_password; }
  if (pendingAvatar !== undefined) body.avatar = pendingAvatar;

  const res  = await api('/api/auth/profile', { method: 'PUT', body });
  const data = await res.json();
  if (!res.ok) return showError('profile-error', data.error);

  currentUser.display_name = data.display_name;
  currentUser.username     = data.username;
  currentUser.level        = data.level;
  if (pendingAvatar !== undefined) currentUser.avatar = pendingAvatar;

  hideProfileEdit();
  renderProfile();
}

/* ── Geschiedenis ─────────────────────────────────────────── */
async function loadHistory() {
  const res      = await api('/api/bookings/history');
  const bookings = await res.json();
  const list     = document.getElementById('history-list');

  if (!bookings.length) {
    list.innerHTML = '<div class="field-row history-empty">Nog geen gespeelde potjes.</div>';
    return;
  }

  list.innerHTML = bookings.map(b => `
    <div class="field-row history-row">
      <div class="history-info">
        <div class="history-title">${escHtml(b.title)}</div>
        <div class="history-meta">${formatDate(b.date)}</div>
      </div>
      ${b.is_extra ? '<span class="role-tag role-extra">Extra</span>' : '<span class="role-tag role-player">Gespeeld</span>'}
    </div>
  `).join('');
}

/* ── Niet-betaald ─────────────────────────────────────────── */
async function loadUnpaid() {
  const res      = await api('/api/bookings');
  const bookings = await res.json();

  // Toon boekingen met betaallink waarbij gebruiker nog niet betaald heeft en geen aanmaker is
  const unpaid = bookings.filter(b =>
    b.payment_url && !b.user_paid_at && b.user_joined && b.created_by !== currentUser.userId
  );

  const section = document.getElementById('unpaid-section');
  const list    = document.getElementById('unpaid-list');

  if (!unpaid.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = unpaid.map(b => `
    <div class="field-row unpaid-row">
      <div class="unpaid-info">
        <div class="unpaid-title">${escHtml(b.title)}</div>
        <div class="unpaid-meta">${formatDate(b.date)}</div>
      </div>
      <div class="unpaid-actions">
        <a href="${escAttr(b.payment_url)}" target="_blank" rel="noopener"
           class="btn-pay-small" onclick="markPaid(${b.id})">Betaal</a>
      </div>
    </div>
  `).join('');
}

async function markPaid(bookingId) {
  await api(`/api/bookings/${bookingId}/pay`, { method: 'POST' });
  setTimeout(loadUnpaid, 800);
}

/* ── Bookings list ────────────────────────────────────────── */
async function loadBookings() {
  const res      = await api('/api/bookings');
  const bookings = await res.json();
  const list     = document.getElementById('bookings-list');
  const empty    = document.getElementById('bookings-empty');
  list.innerHTML = '';

  if (!bookings.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  bookings.forEach(b => list.appendChild(buildCard(b)));
}

function buildCard(b) {
  const playerCount = b.player_count || 0;
  const isFull      = playerCount >= 4;

  const card = document.createElement('div');
  card.className = 'booking-card';
  card.onclick = () => showDetailModal(b.id);

  // Spots
  let spots = '';
  for (let i = 0; i < 4; i++) {
    spots += i < playerCount
      ? `<div class="spot spot-filled">✓</div>`
      : `<div class="spot spot-empty"></div>`;
  }

  // Status
  let statusTag = '';
  if (b.user_joined) {
    statusTag = `<span class="status-tag status-joined">Meedoen</span>`;
  } else if (isFull) {
    statusTag = `<span class="status-tag status-full">Vol</span>`;
  } else {
    statusTag = `<span class="status-tag status-open">${4 - playerCount} plek${4 - playerCount > 1 ? 'ken' : ''} vrij</span>`;
  }

  // Niveau
  let levelTag = '';
  if (b.min_level != null) {
    const txt = b.min_level === b.max_level ? `Niv. ${b.min_level}` : `Niv. ${b.min_level}–${b.max_level}`;
    levelTag = `<span class="status-tag status-level">${txt}</span>`;
  }

  // Betaallink indicator
  const payDot = b.payment_url && b.user_joined && !b.user_paid_at && b.created_by !== currentUser?.userId
    ? `<span class="pay-dot" title="Betaling openstaand"></span>` : '';

  card.innerHTML = `
    <div class="card-top">
      <div class="card-title">${escHtml(b.title)}${payDot}</div>
      <div class="card-chevron">›</div>
    </div>
    <div class="card-meta">
      <span>📅 ${formatDate(b.date)}</span>
      <span>🕐 ${b.start_time} – ${b.end_time}</span>
    </div>
    <div class="card-spots">${spots}</div>
    <div class="card-tags">${statusTag}${levelTag}</div>
  `;
  return card;
}

/* ── Detail modal ─────────────────────────────────────────── */
async function showDetailModal(id) {
  currentDetailId = id;
  clearError('detail-error');

  const res = await api(`/api/bookings/${id}`);
  const b   = await res.json();

  document.getElementById('detail-title').textContent = b.title;

  const playerCount = b.player_count || 0;
  const isFull      = playerCount >= 4;
  const isCreator   = b.created_by === currentUser.userId;

  // Niveau range
  let levelRow = '';
  if (b.min_level != null) {
    const txt = b.min_level === b.max_level ? `${b.min_level}` : `${b.min_level}–${b.max_level}`;
    levelRow = `<div class="field-row"><label>Niveau</label><span>${txt}</span></div>`;
  }

  // Info sectie
  const infoHtml = `
    <div class="section-header">Details</div>
    <div class="field-group">
      <div class="field-row"><label>Datum</label><span>${formatDate(b.date)}</span></div>
      <div class="field-row"><label>Tijd</label><span>${b.start_time} – ${b.end_time}</span></div>
      <div class="field-row"><label>Organisator</label><span>${escHtml(b.creator_name)}</span></div>
      ${levelRow}
      ${b.notes ? `<div class="field-row"><label>Notities</label><span>${escHtml(b.notes)}</span></div>` : ''}
    </div>
  `;

  // Betaallink (voor deelnemers)
  let payHtml = '';
  if (b.payment_url && !isCreator && b.user_joined) {
    const paid = b.user_paid_at;
    payHtml = `
      <div class="section-header">Betaling</div>
      <div class="field-group">
        <div class="field-row">
          ${paid
            ? `<span class="paid-badge">✓ Betaald</span>`
            : `<a href="${escAttr(b.payment_url)}" target="_blank" rel="noopener" class="btn-pay-full" onclick="markPaidAndRefresh(${id})">💳 Betaal hier</a>`
          }
        </div>
        ${paid ? '' : `<div class="field-row"><button class="btn-mark-paid" onclick="markPaidAndRefresh(${id})">Markeer als betaald</button></div>`}
      </div>
    `;
  }

  // Betaallink beheer (voor organisator)
  let payFormHtml = '';
  if (isCreator) {
    payFormHtml = `
      <div class="section-header">Betaallink instellen</div>
      <div class="field-group">
        <div class="field-row">
          <input type="url" id="payment-url-input" placeholder="https://tikkie.me/..." value="${escAttr(b.payment_url || '')}" style="flex:1" />
        </div>
        <div class="field-row">
          <button class="btn btn-primary btn-full" onclick="handleSetPaymentUrl()">Opslaan</button>
        </div>
        <div class="field-row hint-row">Deelnemers ontvangen een pushbericht.</div>
      </div>
    `;
  }

  // Deelnemers
  const playerRows = b.participants.map(p => {
    const lvl = p.level ? ` <span class="p-level">niv. ${p.level}</span>` : '';
    return `<div class="field-row"><span class="p-icon">🎾</span> ${escHtml(p.display_name)}${lvl}</div>`;
  });
  for (let i = b.participants.length; i < 4; i++) {
    playerRows.push(`<div class="field-row p-empty"><span class="p-icon">○</span> Vrije plek</div>`);
  }

  const participantsHtml = `
    <div class="section-header">Spelers (${playerCount}/4)</div>
    <div class="field-group">${playerRows.join('')}</div>
  `;

  document.getElementById('detail-body').innerHTML =
    infoHtml + payHtml + payFormHtml + participantsHtml;

  // Bewerk-knop in header voor organisator
  const headerRight = document.getElementById('detail-header-right');
  if (isCreator) {
    headerRight.innerHTML = `<button class="sheet-done" onclick="showEditBookingModal(${JSON.stringify(b)})">Bewerk</button>`;
  } else {
    headerRight.innerHTML = '';
  }

  // Actieknoppen
  const actions = document.getElementById('detail-actions');
  actions.innerHTML = '';

  if (isCreator) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-destructive-outline btn-full';
    delBtn.textContent = 'Boeking verwijderen';
    delBtn.onclick = handleDeleteBooking;
    actions.appendChild(delBtn);
  } else if (b.user_joined) {
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'btn btn-outline btn-full';
    leaveBtn.textContent = 'Uitschrijven';
    leaveBtn.onclick = handleLeaveBooking;
    actions.appendChild(leaveBtn);
  } else if (!isFull) {
    const joinBtn = document.createElement('button');
    joinBtn.className = 'btn btn-primary btn-full';
    joinBtn.textContent = 'Inschrijven';
    joinBtn.onclick = handleJoinBooking;
    actions.appendChild(joinBtn);
  }

  document.getElementById('detail-modal').classList.remove('hidden');
}

function hideDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  currentDetailId = null;
}

async function markPaidAndRefresh(id) {
  await api(`/api/bookings/${id}/pay`, { method: 'POST' });
  await showDetailModal(id);
  loadUnpaid();
}

async function handleJoinBooking() {
  clearError('detail-error');
  const res  = await api(`/api/bookings/${currentDetailId}/join`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  hideDetailModal(); loadBookings();
}

async function handleLeaveBooking() {
  clearError('detail-error');
  const res  = await api(`/api/bookings/${currentDetailId}/join`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  hideDetailModal(); loadBookings();
}

async function handleDeleteBooking() {
  if (!confirm('Weet je zeker dat je deze boeking wilt verwijderen?')) return;
  clearError('detail-error');
  const res  = await api(`/api/bookings/${currentDetailId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  hideDetailModal(); loadBookings();
}

async function handleSetPaymentUrl() {
  clearError('detail-error');
  const payment_url = document.getElementById('payment-url-input').value.trim();
  const res  = await api(`/api/bookings/${currentDetailId}/payment`, { method: 'PUT', body: { payment_url } });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  await showDetailModal(currentDetailId);
  loadBookings();
}

/* ── New / edit booking modal ─────────────────────────────── */
function showNewBookingModal() {
  bookingEditId = null;
  document.getElementById('booking-modal-title').textContent = 'Nieuwe boeking';
  document.getElementById('booking-modal-done').textContent  = 'Aanmaken';
  const today = new Date().toISOString().split('T')[0];
  clearError('booking-error');
  document.getElementById('booking-form').reset();
  document.getElementById('b-date').value = today;
  document.getElementById('b-date').min   = today;
  document.getElementById('booking-modal').classList.remove('hidden');
}

function showEditBookingModal(b) {
  bookingEditId = b.id;
  document.getElementById('booking-modal-title').textContent = 'Boeking bewerken';
  document.getElementById('booking-modal-done').textContent  = 'Opslaan';
  clearError('booking-error');
  document.getElementById('b-title').value = b.title;
  document.getElementById('b-date').value  = b.date;
  document.getElementById('b-date').min    = '';
  document.getElementById('b-start').value = b.start_time;
  document.getElementById('b-end').value   = b.end_time;
  document.getElementById('b-notes').value = b.notes || '';
  hideDetailModal();
  document.getElementById('booking-modal').classList.remove('hidden');
}

function hideNewBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
  bookingEditId = null;
}

async function handleCreateBooking(e) {
  e.preventDefault();
  clearError('booking-error');
  const body = {
    title:      document.getElementById('b-title').value,
    date:       document.getElementById('b-date').value,
    start_time: document.getElementById('b-start').value,
    end_time:   document.getElementById('b-end').value,
    notes:      document.getElementById('b-notes').value,
  };

  if (bookingEditId) {
    const res  = await api(`/api/bookings/${bookingEditId}`, { method: 'PUT', body });
    const data = await res.json();
    if (!res.ok) return showError('booking-error', data.error);
    hideNewBookingModal(); loadBookings();
  } else {
    const res  = await api('/api/bookings', { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) return showError('booking-error', data.error);
    hideNewBookingModal(); loadBookings();
  }
}

/* ── Sheet backdrop click ─────────────────────────────────── */
function closeSheet(e) {
  if (e.target === e.currentTarget) {
    hideNewBookingModal();
    hideDetailModal();
    hideProfileEdit();
  }
}

/* ── Swipe-to-dismiss voor alle sheets ────────────────────── */
function initSwipeDismiss() {
  document.querySelectorAll('.sheet').forEach(sheet => {
    let startY = 0, currentDy = 0, dragging = false;

    const onStart = (clientY) => {
      startY = clientY;
      currentDy = 0;
      dragging = true;
      sheet.style.transition = 'none';
    };
    const onMove = (clientY) => {
      if (!dragging) return;
      currentDy = clientY - startY;
      if (currentDy > 0) sheet.style.transform = `translateY(${currentDy}px)`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      sheet.style.transform  = '';
      if (currentDy > 80) {
        const overlay = sheet.closest('.sheet-overlay');
        if (overlay) closeSheet({ target: overlay, currentTarget: overlay });
      }
    };

    sheet.addEventListener('touchstart', e => onStart(e.touches[0].clientY), { passive: true });
    sheet.addEventListener('touchmove',  e => onMove(e.touches[0].clientY),  { passive: true });
    sheet.addEventListener('touchend',   onEnd, { passive: true });
  });
}

/* ── Helpers ──────────────────────────────────────────────── */
function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00')
    .toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' });
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
document.addEventListener('DOMContentLoaded', initSwipeDismiss);
init();
