/* ============================================================
   Padel Planner — Frontend logic
   ============================================================ */

let currentUser = null;
let currentDetailId = null;
let currentDetailBooking = null;
let currentTab = 'potjes';
let pendingAvatar = undefined;
let bookingEditId = null;
let allBookings      = [];
let filterStatus     = 'open'; // 'open' | 'all' | 'mine'
let currentInviteToken = null;

/* ── Wachtwoordvalidatie ──────────────────────────────────── */
function validatePassword(pw) {
  if (pw.length < 8)        return 'Wachtwoord moet minimaal 8 tekens zijn';
  if (!/[A-Z]/.test(pw))    return 'Wachtwoord moet minimaal 1 hoofdletter bevatten';
  if (!/[a-z]/.test(pw))    return 'Wachtwoord moet minimaal 1 kleine letter bevatten';
  if (!/[0-9]/.test(pw))    return 'Wachtwoord moet minimaal 1 cijfer bevatten';
  return null;
}

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  try {
    const res = await api('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      setUser(data);
      showApp();
      setupPush();
      handleDeepLink();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const potjeId = params.get('potje');
  if (potjeId) { showDetailModal(parseInt(potjeId, 10)); return; }
  const inviteToken = params.get('invite');
  if (inviteToken) openInviteLink(inviteToken);
}

async function openInviteLink(token) {
  currentInviteToken = token;
  const res = await api(`/api/bookings/invite/${token}`);
  if (!res.ok) { currentInviteToken = null; return; }
  const b = await res.json();
  currentDetailId = b.id;
  currentDetailBooking = b;
  // Render de detail modal direct met de al opgehaalde data
  showDetailModal(b.id);
}

function copyInviteLink(token) {
  const url = `${location.origin}/?invite=${token}`;
  navigator.clipboard.writeText(url).then(() => showToast('Uitnodigingslink gekopieerd!'));
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
  const pwError = validatePassword(new_password);
  if (pwError) return showError('forgot-error', pwError);
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
  handleDeepLink();
}

async function handleRegister(e) {
  e.preventDefault();
  clearError('register-error');
  const display_name = document.getElementById('reg-display-name').value;
  const username     = document.getElementById('reg-username').value;
  const password        = document.getElementById('reg-password').value;
  const passwordConfirm = document.getElementById('reg-password-confirm').value;
  const pwError = validatePassword(password);
  if (pwError) return showError('register-error', pwError);
  if (password !== passwordConfirm) return showError('register-error', 'Wachtwoorden komen niet overeen');
  const res  = await api('/api/auth/register', { method: 'POST', body: { username, display_name, password } });
  const data = await res.json();
  if (!res.ok) return showError('register-error', data.error);
  setUser(data);
  showApp();
  setupPush();
  handleDeepLink();
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

  if (new_password) {
    const pwError = validatePassword(new_password);
    if (pwError) return showError('profile-error', pwError);
  }

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
  showToast('Profiel opgeslagen');
}

/* ── Geschiedenis ─────────────────────────────────────────── */
async function loadHistory() {
  const res      = await api('/api/bookings/history');
  const bookings = await res.json();
  const list     = document.getElementById('history-list');

  const recent = bookings.slice(0, 3);
  if (!recent.length) {
    list.innerHTML = '<div class="field-row history-empty">Nog geen gespeelde potjes.</div>';
    return;
  }

  list.innerHTML = recent.map(b => {
    const names = b.participants_names
      ? b.participants_names.split('||').map(escHtml).join(', ')
      : '';
    return `
    <div class="field-row history-row">
      <div class="history-info">
        <div class="history-title">${escHtml(b.title)}</div>
        <div class="history-meta">${formatDate(b.date)}</div>
        ${names ? `<div class="history-players">${names}</div>` : ''}
      </div>
      ${b.is_extra ? '<span class="role-tag role-extra">Extra</span>' : '<span class="role-tag role-player">Gespeeld</span>'}
    </div>`;
  }).join('');
}

/* ── Niet-betaald ─────────────────────────────────────────── */
async function loadUnpaid() {
  const [resUpcoming, resHistory] = await Promise.all([
    api('/api/bookings'),
    api('/api/bookings/history'),
  ]);
  const upcoming = await resUpcoming.json();
  const history  = await resHistory.json();

  // Normaliseer veldnamen: history gebruikt 'paid_at', upcoming gebruikt 'user_paid_at'
  const all = [
    ...upcoming.map(b => ({ ...b, _paid: b.user_paid_at, _fromHistory: false })),
    ...history.map(b  => ({ ...b, _paid: b.paid_at,      _fromHistory: true  })),
  ];

  // Niet betaald: deelnemer (niet organisator), niet betaald
  // Upcoming: alleen als user meedoet (user_joined); history: al server-side gefilterd
  const unpaid = all.filter(b =>
    !b._paid && b.created_by !== currentUser.userId &&
    (b._fromHistory || b.user_joined)
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
        ${b.payment_url ? `<a href="${escAttr(b.payment_url)}" target="_blank" rel="noopener" class="btn-pay-small">Betaal</a>` : ''}
        <button class="btn-paid-manual" onclick="markPaid(${b.id})">Betaald</button>
      </div>
    </div>
  `).join('');
}

async function markPaid(bookingId) {
  await api(`/api/bookings/${bookingId}/pay`, { method: 'POST' });
  loadUnpaid();
  loadHistory();
}

/* ── Bookings list + filters ──────────────────────────────── */
async function loadBookings() {
  const res = await api('/api/bookings');
  allBookings = await res.json();
  applyFilters();
}

function applyFilters() {
  const list  = document.getElementById('bookings-list');
  const empty = document.getElementById('bookings-empty');
  list.innerHTML = '';

  let visible = allBookings;
  if (filterStatus === 'open') visible = allBookings.filter(b => (b.player_count || 0) < 4);
  if (filterStatus === 'mine') visible = allBookings.filter(b => b.user_joined);

  const emptyTitle = document.querySelector('#bookings-empty .empty-title');
  const emptySub   = document.querySelector('#bookings-empty .empty-sub');
  const emptyBtn   = document.querySelector('#bookings-empty .btn');
  if (filterStatus === 'mine') {
    emptyTitle.textContent = 'Geen aankomende potjes';
    emptySub.textContent   = 'Je bent nergens voor ingeschreven.';
    if (emptyBtn) emptyBtn.style.display = 'none';
  } else {
    emptyTitle.textContent = 'Geen potjes gevonden';
    emptySub.textContent   = 'Maak de eerste boeking aan!';
    if (emptyBtn) emptyBtn.style.display = '';
  }

  if (!visible.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  visible.forEach(b => list.appendChild(buildCard(b)));
}

function setFilter(val) {
  filterStatus = val;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('filter-' + val);
  if (btn) btn.classList.add('active');
  applyFilters();
}

function playerSpotHtml(name) {
  const isMe     = name === currentUser?.display_name;
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  if (isMe && currentUser?.avatar) {
    return `<div class="spot spot-player" title="${escHtml(name)}" style="background-image:url('${currentUser.avatar}')"></div>`;
  }
  return `<div class="spot spot-player" title="${escHtml(name)}">${initials}</div>`;
}

function buildCard(b) {
  const playerCount = b.player_count || 0;
  const isFull      = playerCount >= 4;
  const names       = (b.participants_names || '').split('||').filter(Boolean);

  const card = document.createElement('div');
  card.className = isFull ? 'booking-card booking-card--full' : 'booking-card';
  card.onclick = () => showDetailModal(b.id);

  // Spots
  let spots = '';
  for (let i = 0; i < 4; i++) {
    spots += i < names.length
      ? playerSpotHtml(names[i])
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

  const privateTag = b.is_private
    ? `<span class="status-tag status-private">🔒 Privé</span>` : '';

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
    <div class="card-tags">${statusTag}${levelTag}${privateTag}</div>
  `;
  return card;
}

/* ── Detail modal ─────────────────────────────────────────── */
async function showDetailModal(id) {
  currentDetailId = id;
  clearError('detail-error');

  const res = await api(`/api/bookings/${id}`);
  const b   = await res.json();
  currentDetailBooking = b;

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
      </div>
    `;
  }

  // Uitnodigingslink (voor aanmaker van privé potje)
  let inviteHtml = '';
  if (isCreator && b.is_private && b.invite_token) {
    inviteHtml = `
      <div class="section-header">Uitnodigingslink</div>
      <div class="field-group">
        <div class="field-row"><span style="color:var(--text-2);font-size:.85em">Alleen mensen met deze link kunnen inschrijven.</span></div>
        <div class="field-row">
          <button class="btn btn-outline btn-full" onclick="copyInviteLink('${escAttr(b.invite_token)}')">📋 Kopieer uitnodigingslink</button>
        </div>
      </div>
    `;
  }

  // Deelnemers (inclusief gasten)
  const canAddGuest = (isCreator || b.user_joined) && playerCount < 4;
  const playerRows = b.participants.map(p => {
    if (p.is_guest) {
      const canRemove = isCreator || p.added_by === currentUser.userId;
      const removeBtn = canRemove
        ? `<button class="guest-remove-btn" onclick="handleRemoveGuest(${b.id},${p.id})" title="Gast verwijderen">✕</button>`
        : '';
      return `<div class="field-row"><span class="p-player"><span class="guest-icon">👤</span> ${escHtml(p.display_name)}<span class="guest-badge">Gast</span></span>${removeBtn}</div>`;
    }
    const icon = p.avatar
      ? `<span class="p-avatar" style="background-image:url('${escAttr(p.avatar)}')"></span>`
      : `🎾`;
    return `<div class="field-row"><span class="p-player">${icon} ${escHtml(p.display_name)}</span></div>`;
  });
  for (let i = b.participants.length; i < 4; i++) {
    playerRows.push(`<div class="field-row p-empty"><span class="p-icon">○</span> Vrije plek</div>`);
  }
  if (canAddGuest) {
    playerRows.push(`
      <div class="field-row add-guest-toggle-row" id="add-guest-toggle-row" onclick="showAddGuestForm(${b.id})">
        <span class="add-guest-label">+ Gast toevoegen</span>
      </div>
      <div class="add-guest-form hidden" id="add-guest-form">
        <div class="field-row">
          <input type="text" id="guest-name-input" placeholder="Naam van de gast" maxlength="40" />
        </div>
        <div class="field-row">
          <button class="btn btn-primary btn-full" onclick="handleAddGuest(${b.id})">Toevoegen</button>
        </div>
        <div id="guest-error" class="inline-error hidden" style="padding:0 16px 8px"></div>
      </div>
    `);
  }

  const participantsHtml = `
    <div class="section-header">Spelers (${playerCount}/4)</div>
    <div class="field-group">${playerRows.join('')}</div>
  `;

  document.getElementById('detail-body').innerHTML =
    infoHtml + payHtml + inviteHtml + payFormHtml + participantsHtml;

  // Bewerk-knop in header voor organisator
  const headerRight = document.getElementById('detail-header-right');
  if (isCreator) {
    headerRight.innerHTML = `<button class="sheet-done" onclick="showEditBookingModal()">Bewerk</button>`;
  } else {
    headerRight.innerHTML = '';
  }

  // Actieknoppen
  const actions = document.getElementById('detail-actions');
  actions.innerHTML = '';

  if (isCreator) {
    const waBtn = document.createElement('button');
    waBtn.className = 'btn btn-whatsapp btn-full';
    waBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style="vertical-align:middle;margin-right:6px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.859L.057 23.272a.75.75 0 0 0 .923.923l5.347-1.485A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.715 9.715 0 0 1-4.95-1.355l-.355-.211-3.683 1.023 1.005-3.595-.23-.371A9.718 9.718 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>Deel via WhatsApp';
    waBtn.onclick = () => shareWhatsApp(b);
    actions.appendChild(waBtn);

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
  const qs  = currentInviteToken ? `?token=${currentInviteToken}` : '';
  const res = await api(`/api/bookings/${currentDetailId}/join${qs}`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  currentInviteToken = null;
  hideDetailModal(); loadBookings();
}

async function handleLeaveBooking() {
  clearError('detail-error');
  const res  = await api(`/api/bookings/${currentDetailId}/join`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  hideDetailModal(); loadBookings();
}

function showAddGuestForm(bookingId) {
  const toggleRow = document.getElementById('add-guest-toggle-row');
  const form      = document.getElementById('add-guest-form');
  if (!form) return;
  toggleRow.classList.add('hidden');
  form.classList.remove('hidden');
  document.getElementById('guest-name-input').focus();
}

async function handleAddGuest(bookingId) {
  const name = document.getElementById('guest-name-input')?.value?.trim();
  if (!name) return showError('guest-error', 'Vul een naam in');
  const res  = await api(`/api/bookings/${bookingId}/guests`, { method: 'POST', body: { guest_name: name } });
  const data = await res.json();
  if (!res.ok) return showError('guest-error', data.error);
  showDetailModal(bookingId); loadBookings();
}

async function handleRemoveGuest(bookingId, guestId) {
  const res  = await api(`/api/bookings/${bookingId}/guests/${guestId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  showDetailModal(bookingId); loadBookings();
}

function handleDeleteBooking() {
  document.getElementById('confirm-ok-btn').onclick = async () => {
    closeConfirm();
    clearError('detail-error');
    const res  = await api(`/api/bookings/${currentDetailId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return showError('detail-error', data.error);
    hideDetailModal(); loadBookings();
  };
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.add('hidden');
}

async function handleSetPaymentUrl() {
  clearError('detail-error');
  const payment_url = document.getElementById('payment-url-input').value.trim();
  const res  = await api(`/api/bookings/${currentDetailId}/payment`, { method: 'PUT', body: { payment_url } });
  const data = await res.json();
  if (!res.ok) return showError('detail-error', data.error);
  await showDetailModal(currentDetailId);
  loadBookings();
  showToast(payment_url ? 'Betaallink opgeslagen' : 'Betaallink verwijderd');
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
  setTimeSelect('b-start', '20:00');
  setTimeSelect('b-end',   '21:00');
  document.getElementById('b-private').closest('.field-group').style.display = '';
  document.getElementById('booking-modal').classList.remove('hidden');
}

function showEditBookingModal() {
  const b = currentDetailBooking;
  bookingEditId = b.id;
  document.getElementById('booking-modal-title').textContent = 'Boeking bewerken';
  document.getElementById('booking-modal-done').textContent  = 'Opslaan';
  clearError('booking-error');
  document.getElementById('b-title').value = b.title;
  document.getElementById('b-date').value  = b.date;
  document.getElementById('b-date').min    = new Date().toISOString().split('T')[0];
  setTimeSelect('b-start', b.start_time);
  setTimeSelect('b-end',   b.end_time);
  document.getElementById('b-notes').value   = b.notes || '';
  document.getElementById('b-private').checked = !!b.is_private;
  document.getElementById('b-private').closest('.field-group').style.display = '';
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
    is_private: document.getElementById('b-private').checked,
  };

  // Valideer dat starttijd niet in het verleden ligt
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  if ((body.date + ' ' + body.start_time) <= nowStr) {
    return showError('booking-error', 'Starttijd mag niet in het verleden liggen');
  }

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
    const handle = sheet.querySelector('.sheet-handle');
    if (!handle) return;

    let startY = 0, currentDy = 0, dragging = false;

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

    // Swipe begint alleen op de handle (niet op scrollbare content)
    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      currentDy = 0;
      dragging = true;
      sheet.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      onMove(e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener('touchend', onEnd, { passive: true });
  });
}

/* ── Helpers ──────────────────────────────────────────────── */
function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00')
    .toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' });
}

function shareWhatsApp(b) {
  const datum = new Date(b.date + 'T12:00:00')
    .toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const datumKap = datum.charAt(0).toUpperCase() + datum.slice(1);
  const url = `${location.origin}/?potje=${b.id}`;
  const msg = `🎾 ${b.title}\n\n${datumKap}, ${b.start_time} - ${b.end_time}\n\nDoe mee:\n${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
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

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden', 'fade-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.classList.add('hidden'), 400);
  }, 2500);
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

/* ── Tijdselect opties ────────────────────────────────────── */
function populateTimeSelects() {
  ['b-start', 'b-end'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length) return;
    for (let h = 6; h <= 23; h++) {
      for (let m = 0; m < 60; m += 30) {
        const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        const opt = document.createElement('option');
        opt.value = opt.textContent = val;
        sel.appendChild(opt);
      }
    }
  });
}

function setTimeSelect(id, val) {
  const sel = document.getElementById(id);
  // Trim seconds if present (HH:MM:SS → HH:MM)
  const v = val ? val.slice(0, 5) : '';
  for (const opt of sel.options) {
    if (opt.value === v) { opt.selected = true; break; }
  }
}

/* ── Start ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initSwipeDismiss();
  populateTimeSelects();
  document.getElementById('b-start').addEventListener('change', function () {
    const [h, m] = this.value.split(':').map(Number);
    const endH = (h + 1) % 24;
    setTimeSelect('b-end', `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
  });
});
init();
