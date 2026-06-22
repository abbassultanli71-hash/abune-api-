/* ==========================================================================
   GLOBAL STATE & CONFIG
   ========================================================================== */
const API_BASE = '';
let AUTH_HEADER = '';
let currentUsers = [];
let currentSubs = [];
let currentPayments = [];
let currentNotifs = [];
let activityLog = [];

/* ==========================================================================
   UTILITY: API FETCH WRAPPER
   ========================================================================== */
async function apiFetch(method, endpoint, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_HEADER
    }
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${API_BASE}${endpoint}`, options);
  let data = null;
  try { data = await response.json(); } catch (e) {}
  return { ok: response.ok, status: response.status, data };
}

/* ==========================================================================
   TOAST NOTIFICATIONS
   ========================================================================== */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const iconName = type === 'success' ? 'check-circle' : 'x-circle';
  toast.innerHTML = `
    <div class="toast-icon"><i data-lucide="${iconName}"></i></div>
    <div class="toast-message">${message}</div>
  `;
  container.appendChild(toast);
  lucide.createIcons({ nodes: [toast] });
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

/* ==========================================================================
   ACTIVITY LOG
   ========================================================================== */
function addActivity(type, message) {
  const now = new Date();
  activityLog.unshift({ type, message, time: now.toLocaleTimeString('az', { hour: '2-digit', minute: '2-digit' }) });
  if (activityLog.length > 20) activityLog.pop();
  renderActivity();
}

function renderActivity() {
  const list = document.getElementById('recent-activity-list');
  if (!list) return;
  if (activityLog.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted); text-align:center; font-size:13px;">Hələ heç bir əməliyyat yoxdur.</p>';
    return;
  }
  const iconMap = { add: 'plus-circle', edit: 'pencil', delete: 'trash-2', send: 'send' };
  list.innerHTML = activityLog.map(a => `
    <div class="timeline-item">
      <div class="timeline-badge ${a.type}">
        <i data-lucide="${iconMap[a.type] || 'activity'}"></i>
      </div>
      <div class="timeline-content">
        <p>${a.message}</p>
        <span class="time">${a.time}</span>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

/* ==========================================================================
   DASHBOARD: STATS & CATEGORY CHART
   ========================================================================== */
async function loadDashboardStats() {
  const usersResult = await apiFetch('GET', '/api/istifadeciler');
  if (usersResult.ok) {
    currentUsers = usersResult.data;
    document.getElementById('stat-users-count').textContent = currentUsers.length;
  }

  let totalRevenue = 0;
  let activeSubs = 0;
  const catMap = {};
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9', '#ef4444', '#8b5cf6', '#ec4899'];

  // Fetch all subscriptions for all users
  const allSubsFetch = await Promise.all(currentUsers.map(u =>
    apiFetch('GET', `/api/abunelikler?istifadeci_id=${u.ID || u.id}`)
  ));
  currentSubs = [];
  allSubsFetch.forEach(r => { if (r.ok && Array.isArray(r.data)) currentSubs.push(...r.data); });

  currentSubs.forEach(s => {
    if ((s.STATUS || s.status) === 'active') {
      activeSubs++;
      totalRevenue += parseFloat(s.QIYMET || s.qiymet || 0);
    }
    const cat = s.KATEQORIYA || s.kateqoriya || 'Digər';
    catMap[cat] = (catMap[cat] || 0) + 1;
  });

  document.getElementById('stat-subs-count').textContent = activeSubs;
  document.getElementById('stat-revenue-value').textContent = totalRevenue.toFixed(2) + ' AZN';

  // Notification count
  const allNotifsFetch = await Promise.all(currentUsers.map(u =>
    apiFetch('GET', `/api/bildirisler?istifadeci_id=${u.ID || u.id}`)
  ));
  let totalNotifs = 0;
  currentNotifs = [];
  allNotifsFetch.forEach(r => { if (r.ok && Array.isArray(r.data)) { totalNotifs += r.data.length; currentNotifs.push(...r.data); } });
  document.getElementById('stat-notifs-count').textContent = totalNotifs;

  // Render category chart
  const chartContainer = document.getElementById('category-chart-container');
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const maxVal = catEntries.length ? catEntries[0][1] : 1;
  if (catEntries.length === 0) {
    chartContainer.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">Abunəlik məlumatı yoxdur.</p>';
  } else {
    chartContainer.innerHTML = catEntries.map((([cat, cnt], i) => `
      <div class="chart-bar-item">
        <div class="chart-bar-label">
          <span class="chart-bar-name">${cat}</span>
          <span class="chart-bar-val">${cnt} abunəlik</span>
        </div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width:${Math.max(5, (cnt / maxVal) * 100)}%; background-color:${colors[i % colors.length]};"></div>
        </div>
      </div>
    `)).join('');
  }

  renderActivity();
}

/* ==========================================================================
   USERS TABLE
   ========================================================================== */
async function loadUsers() {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;"><div class="loading-spinner" style="margin:0 auto;"></div></td></tr>';
  const result = await apiFetch('GET', '/api/istifadeciler');
  if (!result.ok) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger);">${result.data?.error || 'Xəta baş verdi.'}</td></tr>`;
    return;
  }
  currentUsers = result.data;
  renderUsersTable(currentUsers);
  populateUserDropdowns();
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:40px;">Heç bir istifadəçi tapılmadı.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const id = u.ID || u.id;
    const ad = u.AD || u.ad;
    const email = u.EMAIL || u.email;
    const date = u.YARADILMA_TARIXI || u.yaradilma_tarixi || '-';
    return `
      <tr>
        <td><span style="color:var(--text-muted); font-size:12px;">#${id}</span></td>
        <td style="font-weight:500;">${ad}</td>
        <td style="color:var(--text-secondary);">${email}</td>
        <td style="color:var(--text-muted); font-size:12px;">${date}</td>
        <td>
          <div class="cell-action-buttons">
            <button class="btn btn-icon edit" title="Düzəliş Et" onclick="editUser(${id})"><i data-lucide="pencil"></i></button>
            <button class="btn btn-icon delete" title="Sil" onclick="deleteUser(${id},'${ad}')"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

function populateUserDropdowns() {
  const dropdowns = ['sub-user', 'payment-user', 'notif-user'];
  dropdowns.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.value;
    el.innerHTML = '<option value="">İstifadəçi seçin...</option>';
    currentUsers.forEach(u => {
      const uid = u.ID || u.id;
      const opt = document.createElement('option');
      opt.value = uid;
      opt.textContent = `#${uid} — ${u.AD || u.ad}`;
      el.appendChild(opt);
    });
    el.value = val;
  });
}

/* ==========================================================================
   USERS CRUD
   ========================================================================== */
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function clearFormErrors(prefix) {
  document.querySelectorAll(`[id^="error-${prefix}"]`).forEach(el => el.textContent = '');
  const genErr = document.getElementById(`${prefix}-form-general-error`);
  if (genErr) genErr.classList.add('hidden');
}

function showFieldError(fieldId, message) {
  const el = document.getElementById(`error-${fieldId}`);
  if (el) el.textContent = message;
}

function showGeneralError(prefix, message) {
  const el = document.getElementById(`${prefix}-form-general-error`);
  if (el) { el.textContent = message; el.classList.remove('hidden'); }
}

// Parse API error and show on the correct field
function handleApiError(error, prefix) {
  const msg = error || 'Bilinməyən xəta baş verdi.';
  if (msg.toLowerCase().includes('email')) return showFieldError(`${prefix}-email`, msg);
  if (msg.toLowerCase().includes('ad ') || msg.toLowerCase().includes('adı')) return showFieldError(`${prefix}-ad`, msg);
  if (msg.toLowerCase().includes('tarixi')) return showFieldError(`${prefix}-date`, msg);
  if (msg.toLowerCase().includes('istifadeci_id')) return showFieldError(`${prefix}-user`, msg);
  if (msg.toLowerCase().includes('abunelik')) return showFieldError(`${prefix}-sub`, msg);
  if (msg.toLowerCase().includes('qiymet') || msg.toLowerCase().includes('məbləğ') || msg.toLowerCase().includes('mebleq')) return showFieldError(`${prefix}-qiymet`, msg);
  if (msg.toLowerCase().includes('valyuta')) return showFieldError(`${prefix}-valyuta`, msg);
  if (msg.toLowerCase().includes('başlama')) return showFieldError(`${prefix}-baslama-tarixi`, msg);
  if (msg.toLowerCase().includes('növbəti') || msg.toLowerCase().includes('novbeti')) return showFieldError(`${prefix}-novbeti-odenis`, msg);
  if (msg.toLowerCase().includes('basliq')) return showFieldError(`${prefix}-basliq`, msg);
  if (msg.toLowerCase().includes('mesaj')) return showFieldError(`${prefix}-mesaj`, msg);
  showGeneralError(prefix, msg);
}

// Open User modal for Add
function openAddUserModal() {
  document.getElementById('user-modal-title').textContent = 'Yeni İstifadəçi Əlavə Et';
  document.getElementById('user-id-field').value = '';
  document.getElementById('user-ad').value = '';
  document.getElementById('user-email').value = '';
  document.getElementById('user-date').value = '';
  document.getElementById('user-date-group').style.display = 'flex';
  clearFormErrors('user');
  openModal('user-modal');
}

// Open User modal for Edit
async function editUser(id) {
  const user = currentUsers.find(u => (u.ID || u.id) == id);
  if (!user) return;
  document.getElementById('user-modal-title').textContent = 'İstifadəçini Düzəliş Et';
  document.getElementById('user-id-field').value = id;
  document.getElementById('user-ad').value = user.AD || user.ad;
  document.getElementById('user-email').value = user.EMAIL || user.email;
  document.getElementById('user-date').value = '';
  document.getElementById('user-date-group').style.display = 'flex';
  clearFormErrors('user');
  openModal('user-modal');
}

// Delete User
async function deleteUser(id, name) {
  if (!confirm(`"${name}" istifadəçisini silmək istədiyinizdən əminsiniz?`)) return;
  const result = await apiFetch('DELETE', `/api/istifadeciler/${id}`);
  if (result.ok) {
    showToast(`"${name}" istifadəçisi uğurla silindi.`, 'success');
    addActivity('delete', `<strong>${name}</strong> istifadəçisi silindi.`);
    loadUsers();
  } else {
    showToast(result.data?.error || 'Silinmə zamanı xəta baş verdi.', 'error');
  }
}

// User Form Submit
document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormErrors('user');
  const btn = document.getElementById('user-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span>Yüklənir...</span>';

  const id = document.getElementById('user-id-field').value;
  const ad = document.getElementById('user-ad').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const date = document.getElementById('user-date').value.trim();
  const body = { ad, email };
  if (date) body.yaradilma_tarixi = date;

  let result;
  if (id) {
    result = await apiFetch('PUT', `/api/istifadeciler/${id}`, body);
  } else {
    result = await apiFetch('POST', '/api/istifadeciler', body);
  }

  btn.disabled = false;
  btn.innerHTML = '<span>Yadda Saxla</span>';

  if (result.ok) {
    closeModal('user-modal');
    showToast(id ? 'İstifadəçi uğurla yeniləndi.' : 'Yeni istifadəçi uğurla əlavə edildi.', 'success');
    addActivity(id ? 'edit' : 'add', id ? `<strong>${ad}</strong> istifadəçisi yeniləndi.` : `Yeni istifadəçi <strong>${ad}</strong> əlavə edildi.`);
    loadUsers();
    loadDashboardStats();
  } else {
    handleApiError(result.data?.error, 'user');
    showToast(result.data?.error || 'Xəta baş verdi.', 'error');
  }
});

/* ==========================================================================
   SUBSCRIPTIONS TABLE
   ========================================================================== */
async function loadSubscriptions() {
  const tbody = document.getElementById('subs-table-body');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:40px;"><div class="loading-spinner" style="margin:0 auto;"></div></td></tr>';

  if (!currentUsers.length) {
    const r = await apiFetch('GET', '/api/istifadeciler');
    if (r.ok) { currentUsers = r.data; populateUserDropdowns(); }
  }

  const allSubs = [];
  await Promise.all(currentUsers.map(async u => {
    const uid = u.ID || u.id;
    const r = await apiFetch('GET', `/api/abunelikler?istifadeci_id=${uid}`);
    if (r.ok && Array.isArray(r.data)) {
      r.data.forEach(s => {
        const userName = u.AD || u.ad;
        allSubs.push({ ...s, _userName: userName });
      });
    }
  }));

  currentSubs = allSubs;
  renderSubsTable(allSubs);
}

function renderSubsTable(subs) {
  const tbody = document.getElementById('subs-table-body');
  if (!subs.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:40px;">Heç bir abunəlik tapılmadı.</td></tr>';
    return;
  }
  const tezlikMap = { monthly: 'Aylıq', yearly: 'İllik', weekly: 'Həftəlik' };
  tbody.innerHTML = subs.map(s => {
    const id = s.ID || s.id;
    const status = (s.STATUS || s.status || 'active').toLowerCase();
    const statusBadge = status === 'active' ? 'badge-success' : 'badge-danger';
    const statusText = status === 'active' ? 'Aktiv' : 'Deaktiv';
    const tezlik = s.ODENIS_TEZLIYI || s.odenis_tezliyi || 'monthly';
    const qiymet = parseFloat(s.QIYMET || s.qiymet || 0).toFixed(2);
    const valyuta = s.VALYUTA || s.valyuta || 'AZN';
    return `
      <tr>
        <td><span style="color:var(--text-muted); font-size:12px;">#${id}</span></td>
        <td style="color:var(--text-secondary);">${s._userName || '-'}</td>
        <td style="font-weight:500;">${s.AD || s.ad || '-'}</td>
        <td><span class="price-tag">${qiymet}</span><span class="price-currency">${valyuta}</span></td>
        <td>${tezlikMap[tezlik] || tezlik}</td>
        <td style="color:var(--text-muted); font-size:12px;">${s.BASLAMA_TARIXI || s.baslama_tarixi || '-'}</td>
        <td style="color:var(--text-muted); font-size:12px;">${s.NOVBETI_ODENIS_TARIXI || s.novbeti_odenis_tarixi || '-'}</td>
        <td style="color:var(--text-secondary);">${s.KATEQORIYA || s.kateqoriya || '-'}</td>
        <td><span class="badge ${statusBadge}">${statusText}</span></td>
        <td>
          <div class="cell-action-buttons">
            <button class="btn btn-icon edit" title="Düzəliş Et" onclick="editSub(${id})"><i data-lucide="pencil"></i></button>
            <button class="btn btn-icon delete" title="Sil" onclick="deleteSub(${id}, '${s.AD || s.ad}')"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function editSub(id) {
  const sub = currentSubs.find(s => (s.ID || s.id) == id);
  if (!sub) return;
  document.getElementById('sub-modal-title').textContent = 'Abunəliyi Düzəliş Et';
  document.getElementById('sub-id-field').value = id;

  // Lock user select
  const userSel = document.getElementById('sub-user');
  userSel.value = sub.ISTIFADECI_ID || sub.istifadeci_id;
  userSel.disabled = true;
  document.getElementById('sub-ad').value = sub.AD || sub.ad || '';
  document.getElementById('sub-qiymet').value = sub.QIYMET || sub.qiymet || '';
  document.getElementById('sub-valyuta').value = (sub.VALYUTA || sub.valyuta || 'AZN').toUpperCase();
  document.getElementById('sub-tezlik').value = sub.ODENIS_TEZLIYI || sub.odenis_tezliyi || 'monthly';
  document.getElementById('sub-baslama-tarixi').value = sub.BASLAMA_TARIXI || sub.baslama_tarixi || '';
  document.getElementById('sub-novbeti-odenis').value = sub.NOVBETI_ODENIS_TARIXI || sub.novbeti_odenis_tarixi || '';
  document.getElementById('sub-kateqoriya').value = sub.KATEQORIYA || sub.kateqoriya || '';
  document.getElementById('sub-status').value = (sub.STATUS || sub.status || 'active').toLowerCase();
  clearFormErrors('sub');
  openModal('sub-modal');
}

async function deleteSub(id, name) {
  if (!confirm(`"${name}" abunəliyini silmək istədiyinizdən əminsiniz?`)) return;
  const result = await apiFetch('DELETE', `/api/abunelikler/${id}`);
  if (result.ok) {
    showToast(`"${name}" abunəliyi uğurla silindi.`, 'success');
    addActivity('delete', `<strong>${name}</strong> abunəliyi silindi.`);
    loadSubscriptions();
    loadDashboardStats();
  } else {
    showToast(result.data?.error || 'Silinmə zamanı xəta baş verdi.', 'error');
  }
}

document.getElementById('sub-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormErrors('sub');
  const btn = document.getElementById('sub-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span>Yüklənir...</span>';

  const id = document.getElementById('sub-id-field').value;
  const istifadeci_id = parseInt(document.getElementById('sub-user').value);
  const ad = document.getElementById('sub-ad').value.trim();
  const qiymet = parseFloat(document.getElementById('sub-qiymet').value);
  const valyuta = document.getElementById('sub-valyuta').value;
  const odenis_tezliyi = document.getElementById('sub-tezlik').value;
  const baslama_tarixi = document.getElementById('sub-baslama-tarixi').value;
  const novbeti_odenis_tarixi = document.getElementById('sub-novbeti-odenis').value;
  const kateqoriya = document.getElementById('sub-kateqoriya').value.trim();
  const status = document.getElementById('sub-status').value;

  const body = { ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status };
  if (!id) body.istifadeci_id = istifadeci_id;

  let result;
  if (id) {
    result = await apiFetch('PUT', `/api/abunelikler/${id}`, body);
  } else {
    result = await apiFetch('POST', '/api/abunelikler', { ...body, istifadeci_id });
  }

  btn.disabled = false;
  btn.innerHTML = '<span>Yadda Saxla</span>';

  if (result.ok) {
    document.getElementById('sub-user').disabled = false;
    closeModal('sub-modal');
    showToast(id ? 'Abunəlik uğurla yeniləndi.' : 'Yeni abunəlik uğurla əlavə edildi.', 'success');
    addActivity(id ? 'edit' : 'add', id ? `<strong>${ad}</strong> abunəliyi yeniləndi.` : `Yeni abunəlik <strong>${ad}</strong> əlavə edildi.`);
    loadSubscriptions();
    loadDashboardStats();
  } else {
    handleApiError(result.data?.error, 'sub');
    showToast(result.data?.error || 'Xəta baş verdi.', 'error');
  }
});

/* ==========================================================================
   PAYMENTS TABLE
   ========================================================================== */
async function loadPayments() {
  const tbody = document.getElementById('payments-table-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;"><div class="loading-spinner" style="margin:0 auto;"></div></td></tr>';

  if (!currentUsers.length) {
    const r = await apiFetch('GET', '/api/istifadeciler');
    if (r.ok) { currentUsers = r.data; populateUserDropdowns(); }
  }

  const allPayments = [];
  await Promise.all(currentUsers.map(async u => {
    const uid = u.ID || u.id;
    const r = await apiFetch('GET', `/api/odenis-tarixcesi?istifadeci_id=${uid}`);
    if (r.ok && Array.isArray(r.data)) {
      r.data.forEach(p => {
        const userName = u.AD || u.ad;
        const subName = currentSubs.find(s => (s.ID || s.id) == (p.ABUNELIK_ID || p.abunelik_id))?._userName || '';
        allPayments.push({ ...p, _userName: userName, _subName: subName });
      });
    }
  }));

  currentPayments = allPayments;
  renderPaymentsTable(allPayments);
}

function renderPaymentsTable(payments) {
  const tbody = document.getElementById('payments-table-body');
  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:40px;">Heç bir ödəniş qeydi tapılmadı.</td></tr>';
    return;
  }
  tbody.innerHTML = payments.map(p => {
    const id = p.ID || p.id;
    const status = (p.STATUS || p.status || 'success').toLowerCase();
    const statusBadge = status === 'success' ? 'badge-success' : 'badge-danger';
    const statusText = status === 'success' ? 'Uğurlu' : 'Uğursuz';
    const subId = p.ABUNELIK_ID || p.abunelik_id;
    const sub = currentSubs.find(s => (s.ID || s.id) == subId);
    const subName = sub ? (sub.AD || sub.ad || `#${subId}`) : `#${subId}`;
    return `
      <tr>
        <td><span style="color:var(--text-muted); font-size:12px;">#${id}</span></td>
        <td style="color:var(--text-secondary);">${p._userName || '-'}</td>
        <td>${subName}</td>
        <td style="color:var(--text-muted); font-size:12px;">${p.ODENIS_TARIXI || p.odenis_tarixi || '-'}</td>
        <td><span class="price-tag">${parseFloat(p.MEBLEQ || p.mebleq || 0).toFixed(2)}</span></td>
        <td><span class="badge ${statusBadge}">${statusText}</span></td>
        <td>
          <div class="cell-action-buttons">
            <button class="btn btn-icon edit" title="Düzəliş Et" onclick="editPayment(${id})"><i data-lucide="pencil"></i></button>
            <button class="btn btn-icon delete" title="Sil" onclick="deletePayment(${id})"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function loadUserSubs(userId) {
  const subSel = document.getElementById('payment-sub');
  if (!userId) { subSel.disabled = true; subSel.innerHTML = '<option value="">Əvvəlcə istifadəçi seçin...</option>'; return; }
  subSel.disabled = false;
  subSel.innerHTML = '<option value="">Yüklənir...</option>';
  const r = await apiFetch('GET', `/api/abunelikler?istifadeci_id=${userId}`);
  subSel.innerHTML = '<option value="">Abunəlik seçin...</option>';
  if (r.ok && Array.isArray(r.data)) {
    r.data.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.ID || s.id;
      opt.textContent = `#${s.ID || s.id} — ${s.AD || s.ad}`;
      subSel.appendChild(opt);
    });
  }
}

async function editPayment(id) {
  const p = currentPayments.find(p => (p.ID || p.id) == id);
  if (!p) return;
  document.getElementById('payment-modal-title').textContent = 'Ödəniş Qeydini Düzəliş Et';
  document.getElementById('payment-id-field').value = id;

  const uid = p.ISTIFADECI_ID || p.istifadeci_id;
  const paymentUserSel = document.getElementById('payment-user');
  paymentUserSel.value = uid;
  paymentUserSel.disabled = true;

  await loadUserSubs(uid);

  const subSel = document.getElementById('payment-sub');
  subSel.value = p.ABUNELIK_ID || p.abunelik_id;
  subSel.disabled = true;

  document.getElementById('payment-tarix').value = p.ODENIS_TARIXI || p.odenis_tarixi || '';
  document.getElementById('payment-mebleq').value = p.MEBLEQ || p.mebleq || '';
  document.getElementById('payment-status').value = (p.STATUS || p.status || 'success').toLowerCase();

  clearFormErrors('payment');
  openModal('payment-modal');
}

async function deletePayment(id) {
  if (!confirm(`Bu ödəniş qeydini silmək istədiyinizdən əminsiniz?`)) return;
  const result = await apiFetch('DELETE', `/api/odenis-tarixcesi/${id}`);
  if (result.ok) {
    showToast('Ödəniş qeydi uğurla silindi.', 'success');
    addActivity('delete', `Ödəniş qeydi #${id} silindi.`);
    loadPayments();
  } else {
    showToast(result.data?.error || 'Silinmə zamanı xəta baş verdi.', 'error');
  }
}

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormErrors('payment');
  const btn = document.getElementById('payment-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span>Yüklənir...</span>';

  const id = document.getElementById('payment-id-field').value;
  const odenis_tarixi = document.getElementById('payment-tarix').value;
  const mebleq = parseFloat(document.getElementById('payment-mebleq').value);
  const status = document.getElementById('payment-status').value;
  const body = { odenis_tarixi, mebleq, status };

  let result;
  if (id) {
    result = await apiFetch('PUT', `/api/odenis-tarixcesi/${id}`, body);
  } else {
    const istifadeci_id = parseInt(document.getElementById('payment-user').value);
    const abunelik_id = parseInt(document.getElementById('payment-sub').value);
    result = await apiFetch('POST', '/api/odenis-tarixcesi', { istifadeci_id, abunelik_id, odenis_tarixi, mebleq, status });
  }

  btn.disabled = false;
  btn.innerHTML = '<span>Yadda Saxla</span>';

  if (result.ok) {
    document.getElementById('payment-user').disabled = false;
    document.getElementById('payment-sub').disabled = false;
    closeModal('payment-modal');
    showToast(id ? 'Ödəniş qeydi yeniləndi.' : 'Yeni ödəniş qeydi əlavə edildi.', 'success');
    addActivity(id ? 'edit' : 'add', id ? `Ödəniş qeydi #${id} yeniləndi.` : `Yeni ödəniş qeydi əlavə edildi.`);
    loadPayments();
  } else {
    handleApiError(result.data?.error, 'payment');
    showToast(result.data?.error || 'Xəta baş verdi.', 'error');
  }
});

/* ==========================================================================
   NOTIFICATIONS TABLE
   ========================================================================== */
async function loadNotifications() {
  const tbody = document.getElementById('notifs-table-body');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px;"><div class="loading-spinner" style="margin:0 auto;"></div></td></tr>';

  if (!currentUsers.length) {
    const r = await apiFetch('GET', '/api/istifadeciler');
    if (r.ok) { currentUsers = r.data; populateUserDropdowns(); }
  }

  const allNotifs = [];
  await Promise.all(currentUsers.map(async u => {
    const uid = u.ID || u.id;
    const r = await apiFetch('GET', `/api/bildirisler?istifadeci_id=${uid}`);
    if (r.ok && Array.isArray(r.data)) {
      r.data.forEach(n => allNotifs.push({ ...n, _userName: u.AD || u.ad }));
    }
  }));
  currentNotifs = allNotifs;
  renderNotifsTable(allNotifs);
}

function renderNotifsTable(notifs) {
  const tbody = document.getElementById('notifs-table-body');
  if (!notifs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:40px;">Heç bir bildiriş tapılmadı.</td></tr>';
    return;
  }
  tbody.innerHTML = notifs.map(n => {
    const id = n.ID || n.id;
    const basliq = n.BASLIQ || n.basliq || '-';
    const mesaj = n.MESAJ || n.mesaj || '-';
    const date = n.GONDERILME_TARIXI || n.gonderilme_tarixi || '-';
    return `
      <tr>
        <td><span style="color:var(--text-muted); font-size:12px;">#${id}</span></td>
        <td style="color:var(--text-secondary);">${n._userName || '-'}</td>
        <td style="font-weight:500;">${basliq}</td>
        <td style="color:var(--text-secondary); max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${mesaj}</td>
        <td style="color:var(--text-muted); font-size:12px;">${date}</td>
        <td>
          <div class="cell-action-buttons">
            <button class="btn btn-icon edit" title="Düzəliş Et" onclick="editNotif(${id})"><i data-lucide="pencil"></i></button>
            <button class="btn btn-icon delete" title="Sil" onclick="deleteNotif(${id})"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function editNotif(id) {
  const n = currentNotifs.find(n => (n.ID || n.id) == id);
  if (!n) return;
  document.getElementById('notif-form').dataset.editId = id;
  document.getElementById('notif-user').value = n.ISTIFADECI_ID || n.istifadeci_id;
  document.getElementById('notif-user').disabled = true;
  document.getElementById('notif-basliq').value = n.BASLIQ || n.basliq || '';
  document.getElementById('notif-mesaj').value = n.MESAJ || n.mesaj || '';
  clearFormErrors('notif');
  openModal('notif-modal');
}

async function deleteNotif(id) {
  if (!confirm(`Bu bildirişi silmək istədiyinizdən əminsiniz?`)) return;
  const result = await apiFetch('DELETE', `/api/bildirisler/${id}`);
  if (result.ok) {
    showToast('Bildiriş uğurla silindi.', 'success');
    addActivity('delete', `Bildiriş #${id} silindi.`);
    loadNotifications();
    loadDashboardStats();
  } else {
    showToast(result.data?.error || 'Silinmə zamanı xəta baş verdi.', 'error');
  }
}

document.getElementById('notif-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormErrors('notif');
  const editId = document.getElementById('notif-form').dataset.editId;
  const istifadeci_id = parseInt(document.getElementById('notif-user').value);
  const basliq = document.getElementById('notif-basliq').value.trim();
  const mesaj = document.getElementById('notif-mesaj').value.trim();

  let result;
  if (editId) {
    result = await apiFetch('PUT', `/api/bildirisler/${editId}`, { basliq, mesaj });
  } else {
    result = await apiFetch('POST', '/api/bildirisler', { istifadeci_id, basliq, mesaj });
  }

  if (result.ok) {
    document.getElementById('notif-user').disabled = false;
    delete document.getElementById('notif-form').dataset.editId;
    closeModal('notif-modal');
    showToast(editId ? 'Bildiriş yeniləndi.' : 'Bildiriş uğurla göndərildi.', 'success');
    addActivity('send', editId ? `Bildiriş #${editId} yeniləndi.` : `Yeni bildiriş <strong>${basliq}</strong> göndərildi.`);
    loadNotifications();
    loadDashboardStats();
  } else {
    handleApiError(result.data?.error, 'notif');
    showToast(result.data?.error || 'Xəta baş verdi.', 'error');
  }
});

/* ==========================================================================
   SEARCH FILTERS
   ========================================================================== */
document.getElementById('users-search').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = currentUsers.filter(u =>
    (u.AD || u.ad || '').toLowerCase().includes(q) ||
    (u.EMAIL || u.email || '').toLowerCase().includes(q)
  );
  renderUsersTable(filtered);
});

document.getElementById('subs-search').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = currentSubs.filter(s =>
    (s.AD || s.ad || '').toLowerCase().includes(q) ||
    (s._userName || '').toLowerCase().includes(q)
  );
  renderSubsTable(filtered);
});

document.getElementById('payments-search').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = currentPayments.filter(p =>
    (p._userName || '').toLowerCase().includes(q) ||
    String(p.ABUNELIK_ID || p.abunelik_id || '').includes(q)
  );
  renderPaymentsTable(filtered);
});

document.getElementById('notifs-search').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = currentNotifs.filter(n =>
    (n.BASLIQ || n.basliq || '').toLowerCase().includes(q) ||
    (n.MESAJ || n.mesaj || '').toLowerCase().includes(q)
  );
  renderNotifsTable(filtered);
});

/* ==========================================================================
   MODAL OPEN/CLOSE: Reset on open
   ========================================================================== */
// Override openModal for user/sub/payment/notif modals to reset state
window.openModal = function(id) {
  if (id === 'user-modal') {
    document.getElementById('user-modal-title').textContent = 'Yeni İstifadəçi Əlavə Et';
    document.getElementById('user-id-field').value = '';
    document.getElementById('user-ad').value = '';
    document.getElementById('user-email').value = '';
    document.getElementById('user-date').value = '';
    clearFormErrors('user');
  }
  if (id === 'sub-modal') {
    document.getElementById('sub-modal-title').textContent = 'Yeni Abunəlik Əlavə Et';
    document.getElementById('sub-id-field').value = '';
    document.getElementById('sub-user').disabled = false;
    document.getElementById('sub-user').value = '';
    document.getElementById('sub-ad').value = '';
    document.getElementById('sub-qiymet').value = '';
    document.getElementById('sub-valyuta').value = 'AZN';
    document.getElementById('sub-tezlik').value = 'monthly';
    document.getElementById('sub-baslama-tarixi').value = '';
    document.getElementById('sub-novbeti-odenis').value = '';
    document.getElementById('sub-kateqoriya').value = '';
    document.getElementById('sub-status').value = 'active';
    clearFormErrors('sub');
  }
  if (id === 'payment-modal') {
    document.getElementById('payment-modal-title').textContent = 'Yeni Ödəniş Qeydi Əlavə Et';
    document.getElementById('payment-id-field').value = '';
    document.getElementById('payment-user').disabled = false;
    document.getElementById('payment-user').value = '';
    document.getElementById('payment-sub').disabled = true;
    document.getElementById('payment-sub').innerHTML = '<option value="">Əvvəlcə istifadəçi seçin...</option>';
    document.getElementById('payment-tarix').value = '';
    document.getElementById('payment-mebleq').value = '';
    document.getElementById('payment-status').value = 'success';
    clearFormErrors('payment');
  }
  if (id === 'notif-modal') {
    delete document.getElementById('notif-form').dataset.editId;
    document.getElementById('notif-user').disabled = false;
    document.getElementById('notif-user').value = '';
    document.getElementById('notif-basliq').value = '';
    document.getElementById('notif-mesaj').value = '';
    clearFormErrors('notif');
  }
  document.getElementById(id).classList.add('open');
};

window.closeModal = function(id) {
  document.getElementById(id).classList.remove('open');
  // Re-enable potentially disabled fields
  if (id === 'sub-modal') document.getElementById('sub-user').disabled = false;
  if (id === 'payment-modal') {
    document.getElementById('payment-user').disabled = false;
    document.getElementById('payment-sub').disabled = false;
  }
  if (id === 'notif-modal') document.getElementById('notif-user').disabled = false;
};

// Close modal on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
});

/* ==========================================================================
   TAB NAVIGATION
   ========================================================================== */
const tabTitles = {
  dashboard: ['Dashboard', 'Sistem vəziyyəti və ümumi statistik göstəricilər'],
  users: ['İstifadəçilər', 'Bütün istifadəçiləri idarə edin'],
  subscriptions: ['Abunəliklər', 'İstifadəçilərin abunəliklərini idarə edin'],
  payments: ['Ödəniş Tarixçəsi', 'Ödəniş qeydlərini idarə edin'],
  notifications: ['Bildirişlər', 'İstifadəçilərə bildirişlər göndərin və idarə edin'],
};

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
    const [title, subtitle] = tabTitles[tab] || ['', ''];
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-subtitle').textContent = subtitle;

    if (tab === 'dashboard') loadDashboardStats();
    if (tab === 'users') loadUsers();
    if (tab === 'subscriptions') loadSubscriptions();
    if (tab === 'payments') loadPayments();
    if (tab === 'notifications') loadNotifications();
  });
});

/* ==========================================================================
   LOGIN
   ========================================================================== */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-submit-btn');
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<span>Yoxlanılır...</span>';

  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value;
  AUTH_HEADER = 'Basic ' + btoa(`${user}:${pass}`);

  // Update user avatar initials
  document.querySelector('.user-avatar').textContent = user.substring(0, 2).toUpperCase();
  document.querySelector('.user-name').textContent = user;

  const result = await apiFetch('GET', '/api/istifadeciler');
  btn.disabled = false;
  btn.innerHTML = '<span>Daxil Ol</span><i data-lucide="arrow-right"></i>';
  lucide.createIcons({ nodes: [btn] });

  if (result.ok) {
    currentUsers = result.data;
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    loadDashboardStats();
    populateUserDropdowns();
  } else if (result.status === 401) {
    AUTH_HEADER = '';
    errEl.textContent = 'İstifadəçi adı və ya şifrə yanlışdır. Yenidən cəhd edin.';
    errEl.classList.remove('hidden');
  } else {
    errEl.textContent = 'Serverə qoşulma xətası. Zəhmət olmasa API-nın aktivliyini yoxlayın.';
    errEl.classList.remove('hidden');
  }
});

/* ==========================================================================
   LOGOUT
   ========================================================================== */
document.getElementById('logout-btn').addEventListener('click', () => {
  AUTH_HEADER = '';
  currentUsers = [];
  currentSubs = [];
  currentPayments = [];
  currentNotifs = [];
  activityLog = [];
  document.getElementById('app-container').classList.add('hidden');
  document.getElementById('login-container').classList.remove('hidden');
  document.getElementById('login-password').value = '';
});

/* ==========================================================================
   INIT
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
});
