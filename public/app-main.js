/* ==========================================================================
   CONFIG & STATE
   ========================================================================== */
const API = '';
const ADMIN_AUTH = 'Basic ' + btoa('admin:admin123'); // API Basic Auth
let currentUser = null; // { id, ad, email }
let userSubs = [];
let userPayments = [];
let userNotifs = [];

const EXCHANGE_RATES = {
  USD: 1.0,
  AZN: 1.70,
  EUR: 0.92
};

function getValidCurrency(valyuta) {
  if (!valyuta) return 'AZN';
  let v = String(valyuta).trim().toUpperCase();
  if (v === 'EURO') v = 'EUR';
  return v;
}

function currencySymbol(curr) {
  const c = getValidCurrency(curr);
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  return '₼';
}

function convertCurrency(amount, from, to) {
  const f = getValidCurrency(from);
  const t = getValidCurrency(to);
  if (f === t) return Number(amount) || 0;
  const fromRate = EXCHANGE_RATES[f] || 1.0;
  const toRate = EXCHANGE_RATES[t] || 1.0;
  return (Number(amount) || 0) * (toRate / fromRate);
}

function toMonthlyAmount(price, freq) {
  const p = Number(price) || 0;
  const f = String(freq || 'monthly').toLowerCase();
  if (f === 'yearly') return p / 12;
  if (f === 'quarterly') return p / 3;
  if (f === 'weekly') return p * 52 / 12;
  return p;
}

/* ==========================================================================
   API HELPER
   ========================================================================== */
async function api(method, url, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': ADMIN_AUTH }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API}${url}`, opts);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'Serverə qoşulma xətası.' } };
  }
}

/* ==========================================================================
   TOAST
   ========================================================================== */
function toast(msg, type = 'ok') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i data-lucide="${type === 'ok' ? 'check-circle' : 'alert-circle'}"></i><span>${msg}</span>`;
  c.prepend(el);
  lucide.createIcons({ nodes: [el] });
  setTimeout(() => el.style.opacity = '0', 3500);
  setTimeout(() => el.remove(), 4000);
}

/* ==========================================================================
   SCREEN NAVIGATION
   ========================================================================== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  lucide.createIcons();
}

/* ==========================================================================
   PAGE NAVIGATION (within the App)
   ========================================================================== */
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.querySelector(`.bnav-item[data-page="${name}"]`).classList.add('active');

  if (name === 'home') loadHome();
  if (name === 'subscriptions') loadSubs();
  if (name === 'payments') loadPayments();
  if (name === 'notifications') loadNotifs();
  if (name === 'profile') loadProfile();

  lucide.createIcons();
}

/* ==========================================================================
   HELPERS
   ========================================================================== */
function getInitials(name) {
  return (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const subColors = ['#e50914','#1db954','#6366f1','#f59e0b','#0ea5e9','#ec4899','#10b981','#8b5cf6','#ef4444','#14b8a6'];
function getColor(name) {
  let hash = 0;
  for (let c of (name || 'S')) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return subColors[Math.abs(hash) % subColors.length];
}

function tezlikLabel(t) {
  return { monthly: 'Aylıq', yearly: 'İllik', weekly: 'Həftəlik' }[t] || t;
}

function clearErrors(prefix) {
  document.querySelectorAll(`[id^="err-${prefix}"]`).forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
}

function showErr(id, msg) {
  const el = document.getElementById(`err-${id}`);
  if (!el) return;
  el.textContent = msg;
  if (el.classList.contains('form-general-err')) el.classList.add('show');
}

function handleErr(error, prefix) {
  const msg = error || 'Bilinməyən xəta.';
  if (msg.toLowerCase().includes('email')) return showErr(`${prefix}-email`, msg);
  if (msg.toLowerCase().includes('ad ') || msg.toLowerCase().includes('adı') || msg.toLowerCase().includes('simvol')) return showErr(`${prefix}-name`, msg);
  showErr(`${prefix}-general`, msg);
}

/* ==========================================================================
   REGISTER
   ========================================================================== */
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors('reg');
  const btn = document.getElementById('reg-submit');
  btn.disabled = true;
  btn.innerHTML = '<span>Yaradılır...</span>';

  const ad = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();

  const res = await api('POST', '/api/istifadeciler', { ad, email });

  btn.disabled = false;
  btn.innerHTML = '<span>Qeydiyyatdan Keç</span><i data-lucide="arrow-right"></i>';
  lucide.createIcons({ nodes: [btn] });

  if (res.ok) {
    // Find new user by email and auto-login
    const usersRes = await api('GET', '/api/istifadeciler');
    if (usersRes.ok) {
      const found = usersRes.data.find(u => (u.EMAIL || u.email || '').toLowerCase() === email.toLowerCase());
      if (found) {
        loginAs(found);
        toast('Xoş gəldin, ' + ad + '! 🎉', 'ok');
        return;
      }
    }
    toast('Qeydiyyat uğurlu! Daxil olun.', 'ok');
    showScreen('screen-login');
  } else {
    handleErr(res.data?.error, 'reg');
    toast(res.data?.error || 'Qeydiyyat zamanı xəta.', 'err');
  }
});

/* ==========================================================================
   LOGIN
   ========================================================================== */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors('login');
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.innerHTML = '<span>Axtarılır...</span>';

  const email = document.getElementById('login-email').value.trim();

  const res = await api('GET', '/api/istifadeciler');
  btn.disabled = false;
  btn.innerHTML = '<span>Daxil Ol</span><i data-lucide="arrow-right"></i>';
  lucide.createIcons({ nodes: [btn] });

  if (!res.ok) {
    showErr('login-general', 'Serverə qoşulma xətası. API-nın aktiv olduğundan əmin olun.');
    return;
  }

  const found = res.data.find(u => (u.EMAIL || u.email || '').toLowerCase() === email.toLowerCase());
  if (!found) {
    showErr('login-email', 'Bu email ilə qeydiyyatdan keçmiş istifadəçi tapılmadı.');
    toast('İstifadəçi tapılmadı.', 'err');
    return;
  }

  loginAs(found);
  toast('Xoş gəldin, ' + (found.AD || found.ad) + '!', 'ok');
});

function loginAs(user) {
  currentUser = {
    id: user.ID || user.id,
    ad: user.AD || user.ad,
    email: user.EMAIL || user.email
  };
  localStorage.setItem('subtrack_user', JSON.stringify(currentUser));
  showScreen('screen-app');
  switchPage('home');
}

function logout() {
  currentUser = null;
  userSubs = [];
  userPayments = [];
  userNotifs = [];
  localStorage.removeItem('subtrack_user');
  showScreen('screen-landing');
  toast('Çıxış edildi.', 'ok');
}

/* ==========================================================================
   HOME PAGE
   ========================================================================== */
async function loadHome() {
  if (!currentUser) return;
  const initials = getInitials(currentUser.ad);
  document.getElementById('home-username').textContent = currentUser.ad;
  document.getElementById('home-avatar').textContent = initials;

  // Load subscriptions
  const subsRes = await api('GET', `/api/abunelikler?istifadeci_id=${currentUser.id}`);
  userSubs = subsRes.ok && Array.isArray(subsRes.data) ? subsRes.data : [];

  // Fetch user budget currency
  const budgetRes = await api('GET', `/api/budceler/${currentUser.username}`);
  let targetCurrency = 'AZN';
  if (budgetRes.ok && budgetRes.data && budgetRes.data.data) {
    const b = budgetRes.data.data.budget || (budgetRes.data.data.budgets && budgetRes.data.data.budgets[0]);
    if (b) targetCurrency = getValidCurrency(b.VALYUTA || b.valyuta || 'AZN');
  }

  const monthlyTotal = activeSubs.reduce((sum, s) => {
    const price = parseFloat(s.QIYMET || s.qiymet || 0);
    const curr = getValidCurrency(s.VALYUTA || s.valyuta || 'AZN');
    const freq = s.ODENIS_TEZLIYI || s.odenis_tezliyi || 'monthly';
    const monthlyEquiv = toMonthlyAmount(price, freq);
    return sum + convertCurrency(monthlyEquiv, curr, targetCurrency);
  }, 0);

  const sym = currencySymbol(targetCurrency);
  document.getElementById('home-active-count').textContent = activeSubs.length;
  document.getElementById('home-monthly-cost').textContent = `${sym}${monthlyTotal.toFixed(2)} ${targetCurrency}`;
  document.getElementById('home-yearly-cost').textContent = `${sym}${(monthlyTotal * 12).toFixed(2)} ${targetCurrency}`;

  // Upcoming payments (next 3 active subs sorted by next payment)
  const sorted = [...activeSubs].sort((a, b) => {
    const da = new Date(a.NOVBETI_ODENIS_TARIXI || a.novbeti_odenis_tarixi || '');
    const db = new Date(b.NOVBETI_ODENIS_TARIXI || b.novbeti_odenis_tarixi || '');
    return da - db;
  }).slice(0, 3);

  const upcomingEl = document.getElementById('home-upcoming');
  if (!sorted.length) {
    upcomingEl.innerHTML = `<div class="empty-state"><i data-lucide="calendar-x"></i><h4>Abunəlik yoxdur</h4><p>Yeni abunəlik əlavə edin</p></div>`;
  } else {
    upcomingEl.innerHTML = sorted.map(s => {
      const name = s.AD || s.ad;
      const price = parseFloat(s.QIYMET || s.qiymet || 0).toFixed(2);
      const currency = s.VALYUTA || s.valyuta || 'AZN';
      const next = s.NOVBETI_ODENIS_TARIXI || s.novbeti_odenis_tarixi || '-';
      const color = getColor(name);
      return `
        <div class="upcoming-item">
          <div class="ui-icon" style="background:${color};">${name[0]}</div>
          <div class="ui-info">
            <div class="ui-name">${name}</div>
            <div class="ui-date">Növbəti: ${next}</div>
          </div>
          <div class="ui-price">${price} ${currency}</div>
        </div>`;
    }).join('');
  }

  // Recent notifications (last 3)
  const notifsRes = await api('GET', `/api/bildirisler?istifadeci_id=${currentUser.id}`);
  userNotifs = notifsRes.ok && Array.isArray(notifsRes.data) ? notifsRes.data : [];

  const homeNotifsEl = document.getElementById('home-notifs');
  const latestNotifs = userNotifs.slice(0, 3);
  if (!latestNotifs.length) {
    homeNotifsEl.innerHTML = `<div class="empty-state"><i data-lucide="bell-off"></i><h4>Bildiriş yoxdur</h4><p>Yeni bildirişlər burada görünəcək</p></div>`;
  } else {
    homeNotifsEl.innerHTML = latestNotifs.map(n => `
      <div class="notif-preview-item">
        <div class="np-title">🔔 ${n.BASLIQ || n.basliq}</div>
        <div class="np-msg">${n.MESAJ || n.mesaj}</div>
      </div>
    `).join('');
  }

  lucide.createIcons();
}

/* ==========================================================================
   SUBSCRIPTIONS PAGE
   ========================================================================== */
let currentFilter = 'all';

async function loadSubs() {
  if (!currentUser) return;
  const res = await api('GET', `/api/abunelikler?istifadeci_id=${currentUser.id}`);
  userSubs = res.ok && Array.isArray(res.data) ? res.data : [];
  filterSubs(currentFilter, document.querySelector(`.ftab[data-filter="${currentFilter}"]`));
}

function filterSubs(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('#sub-filter-tabs .ftab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const list = filter === 'all' ? userSubs : userSubs.filter(s => (s.STATUS || s.status) === filter);
  renderSubsList(list);
}

function renderSubsList(subs) {
  const el = document.getElementById('subs-list');
  if (!subs.length) {
    el.innerHTML = `<div class="empty-state"><i data-lucide="credit-card"></i><h4>Abunəlik tapılmadı</h4><p>Yeni abunəlik əlavə etmək üçün + düyməsinə basın</p></div>`;
    lucide.createIcons();
    return;
  }
  el.innerHTML = subs.map(s => {
    const id = s.ID || s.id;
    const name = s.AD || s.ad || '-';
    const price = parseFloat(s.QIYMET || s.qiymet || 0).toFixed(2);
    const currency = s.VALYUTA || s.valyuta || 'AZN';
    const freq = tezlikLabel(s.ODENIS_TEZLIYI || s.odenis_tezliyi || 'monthly');
    const cat = s.KATEQORIYA || s.kateqoriya || '';
    const next = s.NOVBETI_ODENIS_TARIXI || s.novbeti_odenis_tarixi || '-';
    const status = (s.STATUS || s.status || 'active').toLowerCase();
    const color = getColor(name);
    return `
      <div class="sub-card">
        <div class="sub-card-icon" style="background:${color};">${name[0]}</div>
        <div class="sub-card-info">
          <div class="sub-card-name">${name}</div>
          <div class="sub-card-meta">
            ${cat ? `<span class="sub-card-cat">${cat}</span>` : ''}
            <span class="sub-card-freq">${freq}</span>
          </div>
          <div class="sub-card-actions">
            <button class="btn-xs edit" onclick="editSub(${id})">Düzəliş</button>
            <button class="btn-xs del" onclick="deleteSub(${id},'${name}')">Sil</button>
          </div>
        </div>
        <div class="sub-card-right">
          <div class="sub-card-price">${price} ${currency}</div>
          <div class="sub-card-next">${next}</div>
          <span class="sub-card-badge ${status}">${status === 'active' ? 'Aktiv' : 'Deaktiv'}</span>
        </div>
      </div>`;
  }).join('');
  lucide.createIcons();
}

/* ==========================================================================
   SUBSCRIPTION MODAL
   ========================================================================== */
function openSubModal(editData = null) {
  clearErrors('sm');
  document.getElementById('sub-modal-title').textContent = editData ? 'Abunəliyi Düzəliş Et' : 'Yeni Abunəlik';
  document.getElementById('sub-modal-id').value = editData ? (editData.ID || editData.id) : '';
  document.getElementById('sm-name').value = editData ? (editData.AD || editData.ad || '') : '';
  document.getElementById('sm-price').value = editData ? (editData.QIYMET || editData.qiymet || '') : '';
  document.getElementById('sm-currency').value = editData ? (editData.VALYUTA || editData.valyuta || 'AZN') : 'AZN';
  document.getElementById('sm-start').value = editData ? (editData.BASLAMA_TARIXI || editData.baslama_tarixi || '') : '';
  document.getElementById('sm-next').value = editData ? (editData.NOVBETI_ODENIS_TARIXI || editData.novbeti_odenis_tarixi || '') : '';
  document.getElementById('sm-active').checked = editData ? (editData.STATUS || editData.status) === 'active' : true;

  // Frequency
  const freq = editData ? (editData.ODENIS_TEZLIYI || editData.odenis_tezliyi || 'monthly') : 'monthly';
  document.getElementById('sm-freq').value = freq;
  document.querySelectorAll('#freq-tabs .ftab').forEach(t => {
    t.classList.toggle('active', t.dataset.val === freq);
  });

  // Category
  const cat = editData ? (editData.KATEQORIYA || editData.kateqoriya || '') : '';
  document.getElementById('sm-category').value = cat;
  document.querySelectorAll('.cat-chips .chip').forEach(c => {
    c.classList.toggle('selected', c.textContent.trim().includes(cat) && cat !== '');
  });

  document.getElementById('sub-modal').classList.add('open');
}

function closeSubModal() {
  document.getElementById('sub-modal').classList.remove('open');
}

function selectFreq(val, btn) {
  document.getElementById('sm-freq').value = val;
  document.querySelectorAll('#freq-tabs .ftab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
}

function selectCat(val, btn) {
  document.querySelectorAll('.cat-chips .chip').forEach(c => c.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('sm-category').value = val;
}

// Close modal on backdrop click
document.getElementById('sub-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('sub-modal')) closeSubModal();
});

document.getElementById('sub-modal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors('sm');
  const btn = document.getElementById('sm-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Yüklənir...';

  const id = document.getElementById('sub-modal-id').value;
  const body = {
    ad: document.getElementById('sm-name').value.trim(),
    qiymet: parseFloat(document.getElementById('sm-price').value),
    valyuta: document.getElementById('sm-currency').value,
    odenis_tezliyi: document.getElementById('sm-freq').value,
    baslama_tarixi: document.getElementById('sm-start').value,
    novbeti_odenis_tarixi: document.getElementById('sm-next').value,
    kateqoriya: document.getElementById('sm-category').value,
    status: document.getElementById('sm-active').checked ? 'active' : 'inactive'
  };

  let res;
  if (id) {
    res = await api('PUT', `/api/abunelikler/${id}`, body);
  } else {
    res = await api('POST', '/api/abunelikler', { ...body, istifadeci_id: currentUser.id });
  }

  btn.disabled = false;
  btn.textContent = 'Yadda Saxla';

  if (res.ok) {
    closeSubModal();
    toast(id ? 'Abunəlik yeniləndi.' : 'Yeni abunəlik əlavə edildi! 🎉', 'ok');
    loadSubs();
    loadHome();
  } else {
    const err = res.data?.error || 'Xəta baş verdi.';
    if (err.toLowerCase().includes('başlama')) showErr('sm-start', err);
    else if (err.toLowerCase().includes('növbəti') || err.toLowerCase().includes('novbeti')) showErr('sm-next', err);
    else if (err.toLowerCase().includes('qiymət') || err.toLowerCase().includes('qiymet')) showErr('sm-price', err);
    else showErr('sm-general', err);
    toast(err, 'err');
  }
});

function editSub(id) {
  const sub = userSubs.find(s => (s.ID || s.id) == id);
  if (sub) openSubModal(sub);
}

async function deleteSub(id, name) {
  if (!confirm(`"${name}" abunəliyini silmək istəyirsiniz?`)) return;
  const res = await api('DELETE', `/api/abunelikler/${id}`);
  if (res.ok) {
    toast(`"${name}" silindi.`, 'ok');
    loadSubs();
    loadHome();
  } else {
    toast(res.data?.error || 'Silinmə xətası.', 'err');
  }
}

/* ==========================================================================
   PAYMENTS PAGE
   ========================================================================== */
async function loadPayments() {
  if (!currentUser) return;
  const res = await api('GET', `/api/odenis-tarixcesi?istifadeci_id=${currentUser.id}`);
  userPayments = res.ok && Array.isArray(res.data) ? res.data : [];

  const el = document.getElementById('payments-list');
  if (!userPayments.length) {
    el.innerHTML = `<div class="empty-state"><i data-lucide="receipt"></i><h4>Ödəniş tapılmadı</h4><p>Ödəniş tarixçəniz burada görünəcək</p></div>`;
    lucide.createIcons();
    return;
  }

  // Group by month
  const groups = {};
  userPayments.forEach(p => {
    const d = p.ODENIS_TARIXI || p.odenis_tarixi || '';
    const month = d.slice(0, 7);
    if (!groups[month]) groups[month] = [];
    groups[month].push(p);
  });

  el.innerHTML = Object.entries(groups).sort((a,b) => b[0].localeCompare(a[0])).map(([month, payments]) => {
    const monthLabel = new Date(month + '-01').toLocaleDateString('az', { month: 'long', year: 'numeric' });
    return `
      <div style="margin-bottom:20px;">
        <p style="font-size:12px; font-weight:600; text-transform:uppercase; color:var(--text2); letter-spacing:0.5px; margin-bottom:10px;">${monthLabel}</p>
        ${payments.map(p => {
          const subId = p.ABUNELIK_ID || p.abunelik_id;
          const sub = userSubs.find(s => (s.ID || s.id) == subId);
          const subName = sub ? (sub.AD || sub.ad) : `Abunəlik #${subId}`;
          const status = (p.STATUS || p.status || 'success').toLowerCase();
          const color = getColor(subName);
          return `
            <div class="payment-item">
              <div class="pi-left" style="display:flex; align-items:center; gap:12px;">
                <div style="width:38px; height:38px; border-radius:8px; background:${color}; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:16px; flex-shrink:0;">${subName[0]}</div>
                <div>
                  <div class="pi-name">${subName}</div>
                  <div class="pi-date">${p.ODENIS_TARIXI || p.odenis_tarixi || ''}</div>
                </div>
              </div>
              <div class="pi-right">
                <div class="pi-amount">${parseFloat(p.MEBLEQ || p.mebleq || 0).toFixed(2)} AZN</div>
                <div class="pi-status ${status}">${status === 'success' ? 'Uğurlu' : 'Uğursuz'}</div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }).join('');
  lucide.createIcons();
}

/* ==========================================================================
   NOTIFICATIONS PAGE
   ========================================================================== */
async function loadNotifs() {
  if (!currentUser) return;
  const res = await api('GET', `/api/bildirisler?istifadeci_id=${currentUser.id}`);
  userNotifs = res.ok && Array.isArray(res.data) ? res.data : [];

  const el = document.getElementById('notifs-list');
  if (!userNotifs.length) {
    el.innerHTML = `<div class="empty-state"><i data-lucide="bell-off"></i><h4>Bildiriş yoxdur</h4><p>Yeni bildirişlər burada görünəcək</p></div>`;
    lucide.createIcons();
    return;
  }
  el.innerHTML = userNotifs.map(n => `
    <div class="notif-item">
      <div class="ni-title">🔔 ${n.BASLIQ || n.basliq}</div>
      <div class="ni-msg">${n.MESAJ || n.mesaj}</div>
      <div class="ni-date">${n.GONDERILME_TARIXI || n.gonderilme_tarixi || ''}</div>
    </div>
  `).join('');
  lucide.createIcons();
}

/* ==========================================================================
   PROFILE PAGE
   ========================================================================== */
function loadProfile() {
  if (!currentUser) return;
  const initials = getInitials(currentUser.ad);
  document.getElementById('profile-avatar-big').textContent = initials;
  document.getElementById('profile-name-display').textContent = currentUser.ad;
  document.getElementById('profile-email-display').textContent = currentUser.email;
  document.getElementById('profile-name').value = currentUser.ad;
  document.getElementById('profile-email').value = currentUser.email;
  clearErrors('profile');
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors('profile');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Yenilənir...';

  const ad = document.getElementById('profile-name').value.trim();
  const email = document.getElementById('profile-email').value.trim();

  const res = await api('PUT', `/api/istifadeciler/${currentUser.id}`, { ad, email });

  btn.disabled = false;
  btn.textContent = 'Yadda Saxla';

  if (res.ok) {
    currentUser.ad = ad;
    currentUser.email = email;
    localStorage.setItem('subtrack_user', JSON.stringify(currentUser));
    loadProfile();
    document.getElementById('home-username').textContent = ad;
    document.getElementById('home-avatar').textContent = getInitials(ad);
    toast('Profil yeniləndi!', 'ok');
  } else {
    handleErr(res.data?.error, 'profile');
    toast(res.data?.error || 'Xəta baş verdi.', 'err');
  }
});

/* ==========================================================================
   AUTO LOGIN (from localStorage)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  const saved = localStorage.getItem('subtrack_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showScreen('screen-app');
      switchPage('home');
    } catch (_) {
      localStorage.removeItem('subtrack_user');
    }
  }
});
