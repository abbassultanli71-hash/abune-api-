
  const API_BASE = '';
  let currentUser = null; // { id, username, ad, email }
  let subscriptions = [];
  let cards = [];
  let paymentHistory = [];
  let notifications = [];
  let budgetState = { limit: 300.00, spent: 0.00, currency: 'AZN', exists: false };
  let currentSettings = { esas_valyuta: 'AZN', bildiris_metodu: 'email', dil: 'az', tema: 'dark', tema_rengi: 'gold' };
  
  let selectedCategoryFilter = 'All';
  const TODAY = new Date();

  // Helper to normalize uppercase columns from database
  function normalizeKeys(obj) {
    if (Array.isArray(obj)) return obj.map(normalizeKeys);
    if (obj !== null && typeof obj === 'object') {
      const normal = {};
      for (const key of Object.keys(obj)) {
        normal[key.toLowerCase()] = normalizeKeys(obj[key]);
      }
      return normal;
    }
    return obj;
  }

  // API Request Wrapper using JWT Bearer authentication
  async function apiFetch(method, endpoint, body = null) {
    const token = localStorage.getItem('abunelik_token');
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    const options = {
      method,
      headers
    };
    if (body) options.body = JSON.stringify(body);
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, options);
      
      // Auto logout if session expired / unauthorized
      if (response.status === 401 && endpoint !== '/api/istifadeciler/login') {
        handleLogout();
        return { ok: false, status: 401, data: { error: 'Oturum vaxtı bitdi. Yenidən giriş edin.' } };
      }

      const data = await response.json();
      return { ok: response.ok, status: response.status, data: normalizeKeys(data) };
    } catch (e) {
      console.error('API Fetch error:', e);
      return { ok: false, status: 0, data: { error: 'Server ilə əlaqə qurulmadı.' } };
    }
  }

  // iOS-style In-App Toast Notification
  function showInAppToast(title, body) {
    const phoneContainer = document.querySelector('.phone');
    if (!phoneContainer) return;
    
    // Create elements
    const toast = document.createElement('div');
    toast.className = 'ios-toast-notification';
    
    toast.innerHTML = `
      <div class="ios-toast-header">
        <div class="ios-toast-app-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--purple);"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        </div>
        <span class="ios-toast-app-name">ABUNƏM</span>
        <span class="ios-toast-time">indi</span>
      </div>
      <div class="ios-toast-body">
        <div class="ios-toast-title">${title}</div>
        <div class="ios-toast-message">${body}</div>
      </div>
      <div class="ios-toast-drag-bar"></div>
    `;
    
    phoneContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
      toast.classList.add('show');
    }, 50);
    
    // Dismiss after 4.5 seconds
    const dismissTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 4500);
    
    // Tap to dismiss immediately
    toast.addEventListener('click', () => {
      clearTimeout(dismissTimer);
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    });
  }

  // General Notification Trigger (combining In-App Toast & Native Web Push)
  function triggerSubscriptionNotification(title, body) {
    // 1. Show beautiful iOS push mockup
    showInAppToast(title, body);

    // 2. Trigger browser native push notification (works on desktop & mobile PWAs)
    if (window.Notification && Notification.permission === 'granted') {
      const options = {
        body: body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [100, 50, 100]
      };

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
          registration.showNotification(title, options);
        }).catch(() => {
          new Notification(title, options);
        });
      } else {
        new Notification(title, options);
      }
    }
  }

  // ─── Renewal reminder push with "Cancel Subscription" action button ─────────
  function triggerRenewalNotification(title, body, abunelikId) {
    // 1. Always show iOS-style in-app toast banner
    showInAppToast(title, body);

    // 2. Browser native push with action buttons (SW-backed)
    if (window.Notification && Notification.permission === 'granted') {
      const token = localStorage.getItem('abunelik_token');
      const options = {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,   // stays on screen until user acts
        actions: [
          { action: 'cancel_sub', title: 'Abunəliyi Ləğv Et ❌' },
          { action: 'dismiss',    title: 'Bağla' }
        ],
        data: { abunelikId, token }
      };

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then(reg => reg.showNotification(title, options))
          .catch(() => new Notification(title, { body }));
      } else {
        new Notification(title, { body });
      }
    }
  }

  let isOtpVerificationStep = false;

  // Handle Auth tab switching
  function toggleAuthTab(mode) {
    document.getElementById('tab-login-btn').classList.toggle('active', mode === 'login');
    document.getElementById('tab-register-btn').classList.toggle('active', mode === 'register');
    document.getElementById('auth-login-view').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('auth-register-view').style.display = mode === 'register' ? 'block' : 'none';
    document.getElementById('auth-login-error').classList.remove('show');
    document.getElementById('auth-register-error').classList.remove('show');

    // Reset registration form state if tab changes
    if (mode === 'login' || mode === 'register') {
      isOtpVerificationStep = false;
      document.getElementById('reg-otp-container').style.display = 'none';
      document.getElementById('reg-username').parentElement.style.display = 'block';
      document.getElementById('reg-ad').parentElement.style.display = 'block';
      document.getElementById('reg-email').parentElement.style.display = 'block';
      document.getElementById('reg-password').parentElement.style.display = 'block';
      document.getElementById('reg-submit-btn').textContent = 'Qeydiyyatdan Keç';
      document.getElementById('auth-register-error').style.color = '#ef4444'; // Reset color to red
    }
  }

  // Login handler
  async function handleLogin() {
    const usernameInput = document.getElementById('auth-username-input').value.trim();
    const passwordInput = document.getElementById('auth-password-input').value;
    const errorEl = document.getElementById('auth-login-error');
    if (!usernameInput || !passwordInput) {
      errorEl.textContent = 'İstifadəçi adı və şifrə daxil edilməlidir.';
      errorEl.classList.add('show');
      return;
    }

    const res = await apiFetch('POST', '/api/istifadeciler/login', { username: usernameInput, password: passwordInput });
    if (res.ok && res.data && res.data.data && res.data.data.user) {
      currentUser = res.data.data.user;
      localStorage.setItem('abunelik_user', JSON.stringify(currentUser));
      if (res.data.data.token) {
        localStorage.setItem('abunelik_token', res.data.data.token);
      }
      showApp();
    } else {
      errorEl.textContent = res.data?.error?.message || 'Xəta baş verdi.';
      errorEl.classList.add('show');
    }
  }

  // Register handler with 2-step OTP flow
  async function handleRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const ad = document.getElementById('reg-ad').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const otpContainer = document.getElementById('reg-otp-container');
    const otpInput = document.getElementById('reg-otp');
    const submitBtn = document.getElementById('reg-submit-btn');
    const errorEl = document.getElementById('auth-register-error');

    if (!username || !ad || !email || !password) {
      errorEl.style.color = '#ef4444';
      errorEl.textContent = 'Bütün sahələr doldurulmalıdır.';
      errorEl.classList.add('show');
      return;
    }
    if (password.length < 6) {
      errorEl.style.color = '#ef4444';
      errorEl.textContent = 'Şifrə ən azı 6 simvol olmalıdır.';
      errorEl.classList.add('show');
      return;
    }

    if (!isOtpVerificationStep) {
      // Step 1: Initiate registration (send OTP)
      submitBtn.disabled = true;
      submitBtn.textContent = 'Kod göndərilir...';
      
      const res = await apiFetch('POST', '/api/istifadeciler/register/initiate', { username, ad, email, password });
      submitBtn.disabled = false;

      if (res.ok) {
        isOtpVerificationStep = true;
        // Hide regular inputs to keep layout clean
        document.getElementById('reg-username').parentElement.style.display = 'none';
        document.getElementById('reg-ad').parentElement.style.display = 'none';
        document.getElementById('reg-email').parentElement.style.display = 'none';
        document.getElementById('reg-password').parentElement.style.display = 'none';
        
        // Show OTP field
        otpContainer.style.display = 'block';
        submitBtn.textContent = 'Kodu Təsdiqlə';
        errorEl.innerHTML = `
          <div style="text-align:center; padding: 10px 0;">
            <div style="font-size:13px; margin-bottom:12px;">Məlumatlar qəbul edildi! OTP kodunu almaq üçün:</div>
            <a href="https://t.me/Abunem_bot" target="_blank"
               style="display:inline-flex; align-items:center; gap:8px;
                      background:linear-gradient(135deg,#229ED9,#1a7ab8);
                      color:#fff; font-weight:600; font-size:13px;
                      padding:10px 18px; border-radius:10px;
                      text-decoration:none; box-shadow:0 3px 12px rgba(34,158,217,0.4);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.284c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L6.92 14.41l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.896.176z"/></svg>
              @Abunem_bot-u Açın
            </a>
            <div style="font-size:11px; margin-top:8px; opacity:0.6;">Bota emailinizi yazın → kod anında gələcək</div>
          </div>`;
        errorEl.style.color = '#10b981';
        errorEl.classList.add('show');
        submitBtn.style.display = 'block';
        submitBtn.textContent = 'Kodu Təsdiqlə';
      } else {
        submitBtn.textContent = 'Qeydiyyatdan Keç';
        errorEl.style.color = '#ef4444'; // Red error color
        errorEl.textContent = res.data?.error?.message || 'Qeydiyyat zamanı xəta baş verdi.';
        errorEl.classList.add('show');
      }
    } else {
      // Step 2: Verify OTP and complete registration
      const otp = otpInput.value.trim();
      if (!otp) {
        errorEl.style.color = '#ef4444';
        errorEl.textContent = 'Təsdiq kodunu daxil edin.';
        errorEl.classList.add('show');
        return;
      }

      const activeBtn = document.getElementById('reg-submit-btn');
      activeBtn.disabled = true;
      activeBtn.textContent = 'Təsdiqlənir...';

      const res = await apiFetch('POST', '/api/istifadeciler/register/verify', { email, otp });
      if (res.ok) {
        // Auto login on successful registration
        const loginRes = await apiFetch('POST', '/api/istifadeciler/login', { username, password });
        activeBtn.disabled = false;
        
        // Reset registration fields state
        isOtpVerificationStep = false;
        otpContainer.style.display = 'none';
        document.getElementById('reg-username').parentElement.style.display = 'block';
        document.getElementById('reg-ad').parentElement.style.display = 'block';
        document.getElementById('reg-email').parentElement.style.display = 'block';
        document.getElementById('reg-password').parentElement.style.display = 'block';
        activeBtn.textContent = 'Qeydiyyatdan Keç';

        if (loginRes.ok && loginRes.data && loginRes.data.data && loginRes.data.data.user) {
          currentUser = loginRes.data.data.user;
          localStorage.setItem('abunelik_user', JSON.stringify(currentUser));
          if (loginRes.data.data.token) {
            localStorage.setItem('abunelik_token', loginRes.data.data.token);
          }
          showApp();
        } else {
          toggleAuthTab('login');
        }
      } else {
        activeBtn.disabled = false;
        activeBtn.textContent = 'Kodu Təsdiqlə';
        errorEl.style.color = '#ef4444';
        errorEl.textContent = res.data?.error?.message || 'Təsdiq kodu yanlışdır və ya vaxtı bitib.';
        errorEl.classList.add('show');
      }
    }
  }

  async function resendRegisterOtp(event) {
    if (event) event.preventDefault();
    isOtpVerificationStep = false;
    await handleRegister();
  }

  function handleLogout() {
    localStorage.removeItem('abunelik_user');
    localStorage.removeItem('abunelik_token');
    currentUser = null;
    hideApp();
  }

  function showApp() {
    document.getElementById('scr-auth').classList.remove('active');
    document.getElementById('app-tabbar').style.display = 'flex';
    document.querySelector('.fab').style.display = 'flex';

    // Request notification permission for native push alerts
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Register Service Worker for native push notifications on mobile
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('Service Worker registered successfully:', reg.scope))
        .catch(err => console.error('Service Worker registration failed:', err));

      // 🔄 Listen for "refresh_data" message when user cancels from push notification
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.action === 'refresh_data') {
          console.log('[SW Message] Abunəlik ləğv edildi — data yenilənir...');
          loadAllData();
        }
      });
    }
    
    // Set profile names
    document.getElementById('profile-fullname').textContent = currentUser.ad;
    document.getElementById('profile-username').textContent = '@' + currentUser.username;
    document.getElementById('profile-initials').textContent = initials(currentUser.ad);
    const heroAvatarEl = document.getElementById('hero-avatar-initials');
    if (heroAvatarEl) heroAvatarEl.textContent = initials(currentUser.ad);
    
    // Update date on dashboard
    const monthsAz = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
    const daysAz = ['Bazar', 'Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə'];
    document.getElementById('dashboard-date').textContent = `${TODAY.getDate()} ${monthsAz[TODAY.getMonth()]}, ${daysAz[TODAY.getDay()]}`;

    switchScreen('dashboard');
    loadAllData();
  }

  function hideApp() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('scr-auth').classList.add('active');
    document.getElementById('app-tabbar').style.display = 'none';
    document.querySelector('.fab').style.display = 'none';
    document.getElementById('auth-username-input').value = '';
    document.getElementById('auth-password-input').value = '';
  }

  // Dynamic currency conversion base rates (with AZN as anchor)
  const BASE_RATES = {
    AZN: 1.0,
    USD: 1.70,
    EUR: 1.85
  };
  function convertCurrency(amount, from, to) {
    if (!from || !to || from === to) return amount;
    const amountInAzn = amount * (BASE_RATES[from] || 1.0);
    return amountInAzn / (BASE_RATES[to] || 1.0);
  }

  // Load all user data from API
  async function loadAllData() {
    if (!currentUser) return;

    // 1. Settings
    const settingsRes = await apiFetch('GET', `/api/ayarlar/${currentUser.username}`);
    if (settingsRes.ok && settingsRes.data && settingsRes.data.data && settingsRes.data.data.settings) {
      currentSettings = settingsRes.data.data.settings;
      setTheme(currentSettings.tema || 'light');
      applyAccentColor(currentSettings.tema_rengi || 'purple', currentSettings.tema || 'light');
      applyLanguage(currentSettings.dil || 'az');
      document.getElementById('setting-currency').value = currentSettings.esas_valyuta || 'AZN';
      document.getElementById('setting-notif').value = currentSettings.bildiris_metodu || 'email';
      document.getElementById('setting-lang').value = currentSettings.dil || 'az';
    }

    // 2. Subscriptions
    const subsRes = await apiFetch('GET', `/api/abunelikler?username=${currentUser.username}`);
    if (subsRes.ok && subsRes.data && subsRes.data.data && subsRes.data.data.subscriptions) {
      // Map API fields to UI models
      subscriptions = subsRes.data.data.subscriptions.map(s => ({
        id: s.abunelik_id,
        name: s.ad,
        category: s.kateqoriya || 'Other',
        price: parseFloat(s.qiymet),
        currency: s.valyuta,
        freq: s.odenis_tezliyi === 'yearly' ? 'İllik' : s.odenis_tezliyi === 'quarterly' ? 'Rüblük' : s.odenis_tezliyi === 'weekly' ? 'Həftəlik' : 'Aylıq',
        freqRaw: s.odenis_tezliyi,
        start: s.baslama_tarixi,
        next: s.novbeti_odenis_tarixi,
        status: s.status,
        odenis_metodu_id: s.odenis_metodu_id
      }));
    } else {
      subscriptions = [];
    }

    // 3. Notifications
    const notifsRes = await apiFetch('GET', `/api/bildirisler?username=${currentUser.username}`);
    if (notifsRes.ok && notifsRes.data && notifsRes.data.data && notifsRes.data.data.notifications) {
      notifications = notifsRes.data.data.notifications.map(n => ({
        id: n.bildiris_id,
        title: n.basliq,
        msg: n.mesaj,
        urgency: getUrgency(n.basliq, n.mesaj),
        time: n.gonderilme_tarixi,
        is_read: n.is_read || false,
        abunelik_id: n.abunelik_id || null  // linked subscription for push action
      }));

      // 🔔 Auto-fire push notification for any unread renewal reminders
      const today = new Date().toISOString().split('T')[0];
      const freshReminders = notifsRes.data.data.notifications.filter(n =>
        !n.is_read &&
        n.abunelik_id &&
        (n.basliq || '').match(/Xatırlatması|Məlumatı|Yaxınlaşan|Bildirişi/)
      );
      freshReminders.forEach(n => {
        triggerRenewalNotification(
          n.basliq || 'Abunəlik Xatırlatması 🔔',
          n.mesaj  || 'Abunəliyinizin yenilənmə tarixi yaxınlaşır.',
          n.abunelik_id
        );
      });
    } else {
      notifications = [];
    }

    // 4. Budget
    const budgetRes = await apiFetch('GET', `/api/budceler/${currentUser.username}`);
    const activeSubs = subscriptions.filter(s => s.status === 'active');
    
    // Read the budget currency first to do dynamic conversion
    let targetCurrency = 'AZN';
    let rawLimit = 300.00;
    let budgetExists = false;

    if (budgetRes.ok && budgetRes.data && budgetRes.data.data) {
      const b = budgetRes.data.data.budget || (budgetRes.data.data.budgets && budgetRes.data.data.budgets[0]);
      if (b) {
        targetCurrency = (b.VALYUTA !== undefined ? b.VALYUTA : b.valyuta) || 'AZN';
        rawLimit = parseFloat(b.LIMIT_MEBLEQ !== undefined ? b.LIMIT_MEBLEQ : b.limit_mebleq) || 300.00;
        budgetExists = true;
      }
    }

    // Calculate total spent (converting to targetCurrency using monthly equivalence)
    let totalSpend = 0;
    activeSubs.forEach(s => {
      let monthlyEquiv = s.price;
      if (s.freqRaw === 'weekly') monthlyEquiv = s.price * 4;
      else if (s.freqRaw === 'yearly') monthlyEquiv = s.price / 12;
      else if (s.freqRaw === 'quarterly') monthlyEquiv = s.price / 3;

      totalSpend += convertCurrency(monthlyEquiv, s.currency, targetCurrency);
    });

    budgetState = {
      limit: rawLimit,
      spent: totalSpend,
      currency: targetCurrency,
      exists: budgetExists
    };

    // Update backend spent count if different and budget exists
    if (budgetExists) {
      apiFetch('PUT', `/api/budceler/${currentUser.username}`, {
        limit_mebleq: budgetState.limit,
        valyuta: budgetState.currency,
        hesab_mebleqi: totalSpend
      });
    }

    // Render components
    renderSubs();
    renderNotifs();
    renderRuler();
    renderBudgetCard();

    // 5. Cards & Payment History
    await loadCards();
    await loadPaymentHistory();
  }

  function getUrgency(basliq, mesaj) {
    if (basliq.includes('Gecikmiş') || basliq.includes('gecikmiş') || basliq.includes('Gecikib')) return 'urgent';
    if (basliq.includes('Bu Gün') || basliq.includes('bu gün')) return 'urgent';
    const match = mesaj.match(/(\d+)\s+gün/);
    if (match) {
      const days = parseInt(match[1]);
      return days <= 2 ? 'urgent' : days <= 7 ? 'soon' : 'normal';
    }
    return 'normal';
  }

  function daysUntil(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(Date.UTC(y, m - 1, d));
    const cleanToday = new Date(Date.UTC(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()));
    return Math.round((targetDate - cleanToday) / 86400000);
  }
  function urgencyFor(days) { return days <= 2 ? 'urgent' : days <= 7 ? 'soon' : 'normal'; }
  function badgeLabel(days) {
    if (days < 0) return 'gecikib';
    if (days === 0) return 'bu gün';
    if (days === 1) return 'sabah';
    return days + ' gün';
  }
  function initials(name) { return name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase(); }

  const CATEGORY_ICONS = {
    'Entertainment': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none"/></svg>',
    'Music': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    'Education': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12.5V17c0 1.1 2.7 3 6 3s6-1.9 6-3v-4.5"/></svg>',
    'Health & Fitness': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 7v10M18 7v10M2 10.5v3M22 10.5v3M6 12h12"/></svg>',
    'Productivity': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
    'Gaming': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4"/><circle cx="15.8" cy="10.3" r="1" fill="currentColor" stroke="none"/><circle cx="18.3" cy="12.8" r="1" fill="currentColor" stroke="none"/></svg>',
    'Cloud Storage': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4 1.8A4 4 0 0 0 6.5 19h11Z"/></svg>',
    'News': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V4Z"/><path d="M19 8h1.5v10a2 2 0 0 1-2 2"/><path d="M8 8.5h6M8 12h6M8 15.5h4"/></svg>',
    'Food & Delivery': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2v7a2 2 0 0 0 4 0V2M8 11v11M17 2c-1.7 0-3 2-3 5v3a2 2 0 0 0 2 2h1v9"/></svg>',
    'Shopping': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6.5 8h11l1 13h-13l1-13Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
    'Finance': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M15 9.5c0-1.4-1.5-2.3-3-2.3s-3 .9-3 2.3 1.5 1.9 3 2.3 3 .9 3 2.3-1.5 2.4-3 2.4-3-1-3-2.4"/></svg>',
    'Other': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>'
  };
  const CATEGORY_COLORS = {
    'Entertainment': 'coral', 'Music': 'pink', 'Education': 'blue',
    'Health & Fitness': 'coral', 'Productivity': 'purple', 'Gaming': 'gold',
    'Cloud Storage': 'teal', 'News': 'blue', 'Food & Delivery': 'gold',
    'Shopping': 'pink', 'Finance': 'teal', 'Other': 'neutral'
  };
  function categoryIconHTML(category) {
    const icon = CATEGORY_ICONS[category] || CATEGORY_ICONS['Other'];
    const color = CATEGORY_COLORS[category] || 'neutral';
    return `<div class="sub-icon ${color}">${icon}</div>`;
  }

  function getBrandIconHTML(name, category) {
    const lowerName = (name || '').toLowerCase();
    
    // Netflix
    if (lowerName.includes('netflix') || lowerName.includes('neftlix')) {
      return `<div class="sub-icon" style="background: rgba(229, 9, 20, 0.12); border: 1px solid rgba(229, 9, 20, 0.25); box-shadow: 0 4px 10px rgba(229, 9, 20, 0.15);"><svg viewBox="0 0 24 24" fill="none" style="width:20px; height:20px;"><path d="M4 2v20h4V13.6L16 22h4V2h-4v8.4L8 2H4z" fill="#E50914"/></svg></div>`;
    }
    // Spotify
    if (lowerName.includes('spotify')) {
      return `<div class="sub-icon" style="background: rgba(29, 185, 84, 0.12); border: 1px solid rgba(29, 185, 84, 0.25); box-shadow: 0 4px 10px rgba(29, 185, 84, 0.15);"><svg viewBox="0 0 24 24" fill="none" style="width:20px; height:20px;"><circle cx="12" cy="12" r="10" fill="#1DB954"/><path d="M7 9a11 11 0 0 1 10 0M8 12a8 8 0 0 1 8 0M9 15a5 5 0 0 1 6 0" stroke="#FFF" stroke-width="1.8" stroke-linecap="round"/></svg></div>`;
    }
    // YouTube / YouTube Premium
    if (lowerName.includes('youtube')) {
      return `<div class="sub-icon" style="background: rgba(255, 0, 0, 0.12); border: 1px solid rgba(255, 0, 0, 0.25); box-shadow: 0 4px 10px rgba(255, 0, 0, 0.15);"><svg viewBox="0 0 24 24" fill="none" style="width:20px; height:20px;"><rect x="2" y="5" width="20" height="14" rx="4" fill="#FF0000"/><polygon points="10 9 15 12 10 15" fill="#FFF"/></svg></div>`;
    }
    // Apple / iCloud / iTunes / Apple Music / Apple TV
    if (lowerName.includes('apple') || lowerName.includes('icloud') || lowerName.includes('itunes')) {
      return `<div class="sub-icon" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 4px 10px rgba(255,255,255,0.05);"><svg viewBox="0 0 24 24" fill="currentColor" style="width:20px; height:20px; color:#fff;"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.69-1.12 1.84-.98 2.94 1.07.08 2.15-.52 2.81-1.33z"/></svg></div>`;
    }
    // ChatGPT / OpenAI
    if (lowerName.includes('chatgpt') || lowerName.includes('openai')) {
      return `<div class="sub-icon" style="background: rgba(16, 163, 127, 0.12); border: 1px solid rgba(16, 163, 127, 0.25); box-shadow: 0 4px 10px rgba(16, 163, 127, 0.15);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:20px; height:20px; color:#10a37f;"><path d="M4.5 16.5c-1.5-2.5-1.5-5.5 0-8M19.5 7.5c1.5 2.5 1.5 5.5 0 8M16.5 4.5c2.5-1.5 5.5-1.5 8 0M7.5 19.5c-2.5 1.5-5.5 1.5-8 0M7.5 4.5c2.5 1.5 2.5 4.5 0 7M16.5 19.5c-2.5-1.5-2.5-4.5 0-7"/></svg></div>`;
    }
    // Telegram
    if (lowerName.includes('telegram')) {
      return `<div class="sub-icon" style="background: rgba(0, 136, 204, 0.12); border: 1px solid rgba(0, 136, 204, 0.25); box-shadow: 0 4px 10px rgba(0, 136, 204, 0.15);"><svg viewBox="0 0 24 24" fill="none" style="width:20px; height:20px;"><path d="m22 2-21 8 8 3 3 8 2-5 6 4z" fill="#0088cc"/><path d="m9 13 4-8-7 6z" fill="#fff"/></svg></div>`;
    }
    // Google / Google One / Drive
    if (lowerName.includes('google') || lowerName.includes('drive') || lowerName.includes('youtube premium') === false && lowerName.includes('yt premium') === false && lowerName.includes('gsuite') || lowerName.includes('gmail')) {
      return `<div class="sub-icon" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 4px 10px rgba(0,0,0,0.2);"><svg viewBox="0 0 24 24" style="width:20px; height:20px;"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22-.03-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/></svg></div>`;
    }
    // Canva
    if (lowerName.includes('canva')) {
      return `<div class="sub-icon" style="background: rgba(0, 194, 203, 0.12); border: 1px solid rgba(139, 61, 255, 0.25); box-shadow: 0 4px 10px rgba(139, 61, 255, 0.15);"><svg viewBox="0 0 24 24" fill="none" style="width:20px; height:20px;"><circle cx="12" cy="12" r="10" fill="url(#canva-grad)"/><defs><linearGradient id="canva-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00C2CB"/><stop offset="100%" stop-color="#8B3DFF"/></linearGradient></defs></svg></div>`;
    }
    // Adobe
    if (lowerName.includes('adobe') || lowerName.includes('photoshop') || lowerName.includes('illustrator')) {
      return `<div class="sub-icon" style="background: rgba(255, 0, 0, 0.1); border: 1px solid rgba(255, 0, 0, 0.25);"><svg viewBox="0 0 24 24" fill="#FF0000" style="width:19px; height:19px;"><path d="M14.7 2h7.3v18.7l-7.3-18.7zm-5.4 0H2v18.7L9.3 2zm2.7 5.7L18.4 22h-3.6l-2.8-6.9H8.7L12 7.7z"/></svg></div>`;
    }
    // Amazon / Prime
    if (lowerName.includes('amazon') || lowerName.includes('prime')) {
      return `<div class="sub-icon" style="background: rgba(255, 153, 0, 0.12); border: 1px solid rgba(255, 153, 0, 0.25);"><svg viewBox="0 0 24 24" fill="none" style="width:20px; height:20px;"><path d="M3 17c5 4 13 4 18 0" stroke="#FF9900" stroke-width="2" stroke-linecap="round"/><path d="M18 15l3 2-2 3" stroke="#FF9900" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="9" r="6" stroke="#fff" stroke-width="2"/></svg></div>`;
    }
    // Microsoft / Office
    if (lowerName.includes('microsoft') || lowerName.includes('office') || lowerName.includes('onedrive')) {
      return `<div class="sub-icon" style="background: rgba(0, 164, 239, 0.12); border: 1px solid rgba(0, 164, 239, 0.25);"><svg viewBox="0 0 23 23" style="width:19px; height:19px;"><path fill="#f25022" d="M0 0h11v11H0z"/><path fill="#7fba00" d="M12 0h11v11H12z"/><path fill="#00a4ef" d="M0 12h11v11H0z"/><path fill="#ffb900" d="M12 12h11v11H12z"/></svg></div>`;
    }
    
    // Fallback to Category Icon
    return categoryIconHTML(category);
  }

  function currencySymbol(code) {
    return code === 'USD' ? '$' : code === 'EUR' ? '€' : '₼';
  }

  function subRowHTML(s) {
    const days = daysUntil(s.next);
    const urg = s.status === 'deactive' ? 'paused' : urgencyFor(days);
    const badgeText = s.status === 'deactive' ? 'dayandırılıb' : badgeLabel(days);
    const dateFmt = s.next.split('-').reverse().join('.');
    const sym = currencySymbol(s.currency);
    return `
      <div class="sub-row" onclick="openManageSheet(${JSON.stringify(s).replace(/"/g, '&quot;')})">
        <div class="sub-icon-wrap">
          ${getBrandIconHTML(s.name, s.category)}
        </div>
        <div class="sub-name">${s.name}</div>
        <div class="sub-price-badge">${sym}${s.price.toFixed(2)}</div>
        <span class="sub-badge ${urg}">${badgeText}</span>
      </div>`;
  }

  function renderSubs() {
    const activeSubs = subscriptions.filter(s => s.status === 'active');
    
    // Sort upcoming by days remaining
    const preview = [...activeSubs]
      .sort((a,b) => daysUntil(a.next) - daysUntil(b.next)).slice(0,4);
    
    document.getElementById('subs-preview-list').innerHTML = preview.length > 0 ? 
      preview.map(subRowHTML).join('') : '<div class="hint">Yaxınlaşan ödəniş yoxdur.</div>';
    
    // Update sub title counts
    document.querySelector('.hero-sub[data-i18n="dashboard_sub"]').textContent = `${activeSubs.length} aktiv abunəlik izlənilir`;
    document.getElementById('subs-screen-sub').textContent = `${subscriptions.length} abunəlik · ${activeSubs.length} aktiv`;
    
    // Update dashboard active count stat card
    const activeCountEl = document.getElementById('dashboard-active-count');
    if (activeCountEl) {
      activeCountEl.textContent = activeSubs.length;
    }

    // Render full list with filter
    filterSubscriptionsList();
  }

  function filterSubscriptionsList() {
    const query = document.getElementById('sub-search-input').value.toLowerCase().trim();
    let filtered = subscriptions;

    if (selectedCategoryFilter !== 'All') {
      filtered = filtered.filter(s => s.category === selectedCategoryFilter);
    }

    if (query) {
      filtered = filtered.filter(s => s.name.toLowerCase().includes(query) || s.category.toLowerCase().includes(query));
    }

    // Sort order based on dropdown selection
    const sortVal = document.getElementById('sub-sort-select').value;
    filtered.sort((a, b) => {
      if (sortVal === 'price_desc') return b.price - a.price;
      if (sortVal === 'price_asc') return a.price - b.price;
      if (sortVal === 'name_asc') return a.name.localeCompare(b.name);
      // default: next_asc (earliest next payment date)
      return daysUntil(a.next) - daysUntil(b.next);
    });

    document.getElementById('subs-full-list').innerHTML = filtered.length > 0 ?
      filtered.map(subRowHTML).join('') :
      '<div class="hint">Abunəlik tapılmadı.</div>';
  }

  function filterCategory(cat) {
    selectedCategoryFilter = cat;
    document.querySelectorAll('#category-filter-row .filter-chip').forEach(chip => {
      chip.classList.toggle('selected', chip.getAttribute('data-category') === cat);
    });
    filterSubscriptionsList();
  }

  function notifRowHTML(n) {
    const color = n.urgency === 'urgent' ? 'var(--coral)' : n.urgency === 'soon' ? 'var(--gold)' : 'var(--teal)';
    const dotHtml = n.is_read ? '' : `<span class="notif-dot" style="background:${color}"></span>`;
    // If this notification is linked to a subscription, show Cancel button
    const cancelBtn = n.abunelik_id
      ? `<button class="notif-cancel-btn" id="notif-cancel-${n.id}" onclick="event.stopPropagation(); handleCancelSubscriptionFromNotif(${n.abunelik_id}, ${n.id}, this)">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
           Abunəliyi Ləğv Et
         </button>`
      : '';
    return `
      <div class="notif-item" style="${n.is_read ? 'opacity:0.6;' : ''}">
        ${dotHtml}
        <div style="flex: 1;">
          <div class="notif-title">${n.title}</div>
          <div class="notif-msg">${n.msg}</div>
          <div class="notif-time">${n.time}</div>
          ${cancelBtn}
        </div>
        ${!n.is_read ? `<button onclick="handleMarkNotificationRead(${n.id})" title="Oxundu işarələ"
          style="border:none;background:none;cursor:pointer;color:var(--ink-faint);padding:4px;font-size:16px;flex-shrink:0;">✓</button>` : ''}
      </div>`;
  }
  
  function renderNotifs() {
    const unreadCount = notifications.filter(n => !n.is_read).length;
    document.getElementById('notif-preview-list').innerHTML = notifications.slice(0,2).map(notifRowHTML).join('');
    document.getElementById('notif-full-list').innerHTML = notifications.map(notifRowHTML).join('');
    
    // Toggle tab badge dot
    document.getElementById('notif-badge').style.display = unreadCount > 0 ? 'block' : 'none';
  }

  // Mark notification as read (PATCH instead of DELETE)
  async function handleMarkNotificationRead(id) {
    const res = await apiFetch('PATCH', `/api/bildirisler/${id}/read`);
    if (res.ok) {
      notifications = notifications.map(n =>
        n.id === id ? { ...n, is_read: true } : n
      );
      renderNotifs();
    } else {
      alert(res.data?.error?.message || 'Bildiriş oxunmuş kimi işarələnə bilmədi.');
    }
  }

  // ── Cancel subscription directly from notification card ────────────────────
  async function handleCancelSubscriptionFromNotif(abunelikId, notifId, btnEl) {
    if (!abunelikId) return;
    if (!confirm('Bu abunəliyi həqiqətən ləğv etmək istəyirsiniz?')) return;

    // Show loading state on button
    btnEl.classList.add('loading');
    btnEl.textContent = 'Silinir...';

    const res = await apiFetch('DELETE', `/api/abunelikler/${abunelikId}`);

    if (res.ok) {
      // Remove this notification from local list + refresh everything
      notifications = notifications.filter(n => n.id !== notifId);
      renderNotifs();
      triggerSubscriptionNotification('Abunəlik Ləğv Edildi ✅', 'Abunəliyiniz uğurla sistemdən silindi.');
      await loadAllData();
    } else {
      btnEl.classList.remove('loading');
      btnEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Abunəliyi Ləğv Et`;
      alert(res.data?.error?.message || 'Abunəlik silinə bilmədi. Yenidən cəhd edin.');
    }
  }

  function renderRuler() {
    const track = document.getElementById('ruler-track');
    const daysInMonth = 31;
    const todayDay = TODAY.getDate();
    let html = '';
    const todayPct = ((todayDay - 1) / (daysInMonth - 1)) * 100;
    
    const monthsAzShort = ['YAN', 'FEV', 'MAR', 'APR', 'MAY', 'İYN', 'İYL', 'AVQ', 'SEN', 'OKT', 'NOY', 'DEK'];
    document.getElementById('ruler-month-title').textContent = `${monthsAzShort[TODAY.getMonth()]} · 31 GÜN`;

    html += `<div class="ruler-today-line" style="left:${todayPct}%"></div>`;
    html += `<div class="ruler-today-label" style="left:${todayPct}%">BUGÜN</div>`;
    
    const currentMonthPrefix = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
    
    const activeSubs = subscriptions.filter(s => s.status === 'active' && s.next.startsWith(currentMonthPrefix));
    
    activeSubs.forEach(s => {
      const day = Number(s.next.split('-')[2]);
      const pct = ((day - 1) / (daysInMonth - 1)) * 100;
      const urg = urgencyFor(daysUntil(s.next));
      html += `<div class="ruler-chip ${urg}" style="left:${pct}%" title="${s.name}"></div>`;
    });
    track.innerHTML = html;

    // Also update "Next Payment" stat card
    const nextPayStat = document.getElementById('dashboard-next-payment');
    if (activeSubs.length > 0) {
      const sorted = [...activeSubs].sort((a,b) => daysUntil(a.next) - daysUntil(b.next));
      const nearest = sorted[0];
      const days = daysUntil(nearest.next);
      const daysLabel = days === 0 ? 'bu gün' : days === 1 ? 'sabah' : `${days} gün`;
      nextPayStat.innerHTML = `${nearest.name} <small>${daysLabel}</small>`;
    } else {
      nextPayStat.textContent = '-';
    }
  }

  function switchScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const targetScreen = document.getElementById('scr-' + name);
    if (targetScreen) targetScreen.classList.add('active');

    if (name !== 'auth') {
      document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      const activeTab = document.querySelector(`.tab-item[data-screen="${name}"]`);
      if (activeTab) activeTab.classList.add('active');
      if (targetScreen) targetScreen.scrollTop = 0;

      // Show FAB on dashboard, subs, and cards screens, configure dynamically
      const fab = document.querySelector('.fab');
      if (fab) {
        if (['dashboard', 'subs', 'cards'].includes(name)) {
          fab.style.display = 'flex';
          if (name === 'cards') {
            fab.setAttribute('onclick', 'openCardSheet()');
            fab.setAttribute('title', 'Yeni kart əlavə et');
          } else {
            fab.setAttribute('onclick', 'openSheet()');
            fab.setAttribute('title', 'Yeni abunəlik əlavə et');
          }
        } else {
          fab.style.display = 'none';
        }
      }

      // Attach scroll-to-top listener on this screen
      const scrollBtn = document.getElementById('scroll-top-btn');
      if (scrollBtn && targetScreen) {
        // Remove previous listener to avoid duplicates
        if (targetScreen._scrollHandler) {
          targetScreen.removeEventListener('scroll', targetScreen._scrollHandler);
        }
        targetScreen._scrollHandler = () => {
          if (targetScreen.scrollTop > 120) {
            scrollBtn.classList.add('visible');
          } else {
            scrollBtn.classList.remove('visible');
          }
        };
        targetScreen.addEventListener('scroll', targetScreen._scrollHandler);
        scrollBtn.classList.remove('visible');
      }
    }
  }

  function scrollToTop() {
    const active = document.querySelector('.screen.active');
    if (active) active.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('scroll-top-btn').classList.remove('visible');
  }

  function updateBodyScrollLock() {
    const anyOpen = document.querySelectorAll('.sheet-overlay.open').length > 0;
    if (anyOpen) {
      document.body.classList.add('sheet-open');
    } else {
      document.body.classList.remove('sheet-open');
    }
  }

  function openSheet() { 
    // Set start date to today's date formatted as YYYY-MM-DD
    const yyyy = TODAY.getFullYear();
    const mm = String(TODAY.getMonth() + 1).padStart(2, '0');
    const dd = String(TODAY.getDate()).padStart(2, '0');
    document.getElementById('new-sub-start').value = `${yyyy}-${mm}-${dd}`;
    document.getElementById('new-sub-email').value = '';
    document.getElementById('new-sub-password').value = '';
    // Set default currency to primary currency
    document.getElementById('new-sub-currency').value = currentSettings.esas_valyuta || 'AZN';
    const overlay = document.getElementById('sheet-overlay');
    overlay.classList.add('open'); 
    updateBodyScrollLock();
    const sheet = overlay.querySelector('.sheet');
    if (sheet) sheet.scrollTop = 0;
  }
  function closeSheet() {
    document.getElementById('sheet-overlay').classList.remove('open');
    updateBodyScrollLock();
    if (document.activeElement) document.activeElement.blur();
    setTimeout(() => { window.scrollTo(0, window.scrollY); }, 80);
  }
  document.getElementById('sheet-overlay').addEventListener('click', e => {
    if (e.target.id === 'sheet-overlay') closeSheet();
  });

  function clearPriceError() {
    document.getElementById('price-error').classList.remove('show');
    document.getElementById('new-sub-price').classList.remove('invalid');
  }

  // Handle Add subscription to API
  async function handleAddSubscription() {
    const nameInput = document.getElementById('new-sub-name');
    const priceInput = document.getElementById('new-sub-price');
    const currencyInput = document.getElementById('new-sub-currency');
    const freqInput = document.getElementById('new-sub-freq');
    const startInput = document.getElementById('new-sub-start');
    const catInput = document.getElementById('new-sub-category');
    const cardInput = document.getElementById('new-sub-card');
    const emailInput = document.getElementById('new-sub-email');
    const passwordInput = document.getElementById('new-sub-password');

    const name = nameInput.value.trim();
    const price = Number(priceInput.value);
    const currency = currencyInput.value;
    const freq = freqInput.value;
    const start = startInput.value;
    const category = catInput.value;
    const cardId = cardInput.value || null;
    const accountEmail = emailInput.value.trim();
    const accountPassword = passwordInput.value.trim();

    if (!name) {
      nameInput.focus();
      return;
    }

    if (!accountEmail || !accountPassword) {
      emailInput.classList.add('invalid');
      passwordInput.classList.add('invalid');
      emailInput.focus();
      return;
    }
    emailInput.classList.remove('invalid');
    passwordInput.classList.remove('invalid');

    if (!priceInput.value || isNaN(price) || price <= 0) {
      document.getElementById('price-error').classList.add('show');
      priceInput.classList.add('invalid');
      priceInput.focus();
      return;
    }

    if (!cardId) {
      cardInput.classList.add('invalid');
      cardInput.focus();
      return;
    }
    cardInput.classList.remove('invalid');

    clearPriceError();

    // ── CLIENT-SIDE büdcə limiti yoxlaması ──────────────────────────────────
    // budgetState.limit - cari limit (hətta default 300 olsa belə)
    // budgetState.spent - mövcud aktiv abunəliklərin cəmi
    {
      const effectiveLimit = budgetState.limit > 0 ? budgetState.limit : 300;
      const currentSpent   = budgetState.spent  || 0;
      const projectedTotal = currentSpent + price;

      if (projectedTotal > effectiveLimit) {
        const remaining = Math.max(0, effectiveLimit - currentSpent);
        const sym = currencySymbol(budgetState.currency || 'AZN');
        const errMsg = `Büdcə limiti keçilir! Mövcud xərc: ${sym}${currentSpent.toFixed(2)}, yeni abunəlik: +${sym}${price.toFixed(2)}, cəmi: ${sym}${projectedTotal.toFixed(2)} — limit: ${sym}${effectiveLimit.toFixed(2)}. (Qalan boş büdcə: ${sym}${remaining.toFixed(2)})`;
        document.getElementById('budget-exceeded-msg').textContent = errMsg;
        const banner = document.getElementById('budget-exceeded-banner');
        banner.style.display = 'block';
        banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const payload = {
      username: currentUser.username,
      ad: name,
      qiymet: price,
      valyuta: currency,
      odenis_tezliyi: freq,
      baslama_tarixi: start,
      kateqoriya: category,
      odenis_metodu_id: cardId,
      accountemail: accountEmail,
      accountpassword: accountPassword
    };

    // Budget banner sıfırla
    document.getElementById('budget-exceeded-banner').style.display = 'none';

    const res = await apiFetch('POST', '/api/abunelikler', payload);

    if (res.ok) {
      const sym = currencySymbol(currency);
      triggerSubscriptionNotification(
        'Yeni abunəlik yaradıldı! 🎉',
        `"${name}" abunəliyi uğurla əlavə edildi. Qiymət: ${sym}${price.toFixed(2)}`
      );

      closeSheet();
      nameInput.value = '';
      priceInput.value = '';
      emailInput.value = '';
      passwordInput.value = '';
      loadAllData();
    } else {
      const errCode = res.data?.error?.code;
      const errMsg  = res.data?.error?.message || 'Abunəlik yaradıla bilmədi.';
      if (errCode === 'BUDGET_EXCEEDED') {
        // Büdcə limitini keçdikdə inline banner göstər
        document.getElementById('budget-exceeded-msg').textContent = errMsg;
        const banner = document.getElementById('budget-exceeded-banner');
        banner.style.display = 'block';
        banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (errCode === 'ACCOUNT_NOT_FOUND') {
        alert('Abunəlik hesabı tapılmadı! Email və şifrəni yoxlayın.');
      } else {
        alert(errMsg);
      }
    }
  }

  // Manage Subscription Modal
  function openManageSheet(sub) {
    document.getElementById('manage-sub-id').value = sub.id;
    document.getElementById('manage-sub-orig-name').value = sub.name;
    document.getElementById('manage-sub-name').value = sub.name;
    document.getElementById('manage-sub-price').value = sub.price;
    document.getElementById('manage-sub-currency').value = sub.currency;
    document.getElementById('manage-sub-freq').value = sub.freqRaw;
    document.getElementById('manage-sub-start').value = sub.start;
    document.getElementById('manage-sub-category').value = sub.category;
    document.getElementById('manage-sub-status').value = sub.status;
    document.getElementById('manage-sub-card').value = sub.odenis_metodu_id || '';
    document.getElementById('manage-sub-email').value = '';
    document.getElementById('manage-sub-password').value = '';

    document.getElementById('manage-budget-exceeded-banner').style.display = 'none';
    clearManagePriceError();
    const overlay = document.getElementById('sub-manage-overlay');
    overlay.classList.add('open');
    updateBodyScrollLock();
    const sheet = overlay.querySelector('.sheet');
    if (sheet) sheet.scrollTop = 0;
  }

  function closeManageSheet() {
    document.getElementById('sub-manage-overlay').classList.remove('open');
    updateBodyScrollLock();
    if (document.activeElement) document.activeElement.blur();
    setTimeout(() => { window.scrollTo(0, window.scrollY); }, 80);
  }
  document.getElementById('sub-manage-overlay').addEventListener('click', e => {
    if (e.target.id === 'sub-manage-overlay') closeManageSheet();
  });

  function clearManagePriceError() {
    document.getElementById('manage-price-error').classList.remove('show');
    document.getElementById('manage-sub-price').classList.remove('invalid');
  }

  // Handle Edit subscription API
  async function handleUpdateSubscription() {
    const id = document.getElementById('manage-sub-id').value;
    const origName = document.getElementById('manage-sub-orig-name').value;
    const name = document.getElementById('manage-sub-name').value.trim();
    const priceInput = document.getElementById('manage-sub-price');
    const price = Number(priceInput.value);
    const currency = document.getElementById('manage-sub-currency').value;
    const freq = document.getElementById('manage-sub-freq').value;
    const start = document.getElementById('manage-sub-start').value;
    const category = document.getElementById('manage-sub-category').value;
    const status = document.getElementById('manage-sub-status').value;
    const cardId = document.getElementById('manage-sub-card').value || null;
    const accountEmail = document.getElementById('manage-sub-email').value.trim();
    const accountPassword = document.getElementById('manage-sub-password').value.trim();

    if (!name) {
      document.getElementById('manage-sub-name').focus();
      return;
    }

    if (!accountEmail || !accountPassword) {
      document.getElementById('manage-sub-email').classList.add('invalid');
      document.getElementById('manage-sub-password').classList.add('invalid');
      document.getElementById('manage-sub-email').focus();
      return;
    }
    document.getElementById('manage-sub-email').classList.remove('invalid');
    document.getElementById('manage-sub-password').classList.remove('invalid');

    if (!priceInput.value || isNaN(price) || price <= 0) {
      document.getElementById('manage-price-error').classList.add('show');
      priceInput.classList.add('invalid');
      priceInput.focus();
      return;
    }

    clearManagePriceError();
    document.getElementById('manage-budget-exceeded-banner').style.display = 'none';

    const updatePayload = {
      ad: name,
      qiymet: price,
      valyuta: currency,
      odenis_tezliyi: freq,
      baslama_tarixi: start,
      kateqoriya: category,
      status: status,
      odenis_metodu_id: cardId,
      accountemail: accountEmail,
      accountpassword: accountPassword
    };

    const res = await apiFetch('PUT', `/api/abunelikler?username=${currentUser.username}&ad=${origName}`, updatePayload);

    if (res.ok) {
      closeManageSheet();
      document.getElementById('manage-budget-exceeded-banner').style.display = 'none';
      loadAllData();
    } else {
      const errCode = res.data?.error?.code;
      const errMsg  = res.data?.error?.message || 'Abunəlik yenilənmədi.';
      if (errCode === 'BUDGET_EXCEEDED') {
        document.getElementById('manage-budget-exceeded-msg').textContent = errMsg;
        const banner = document.getElementById('manage-budget-exceeded-banner');
        banner.style.display = 'block';
        banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (errCode === 'ACCOUNT_NOT_FOUND') {
        alert('Abunəlik hesabı tapılmadı! Email və şifrəni yoxlayın.');
      } else {
        alert(errMsg);
      }
    }
  }

  // Handle Delete subscription API
  async function handleDeleteSubscription() {
    const id = document.getElementById('manage-sub-id').value;
    if (confirm('Bu abunəliyi silmək istədiyinizdən əminsiniz?')) {
      const res = await apiFetch('DELETE', `/api/abunelikler/${id}`);
      if (res.ok) {
        closeManageSheet();
        loadAllData();
      } else {
        alert(res.data?.error?.message || 'Silinmə zamanı xəta baş verdi.');
      }
    }
  }

  // ---- Cards (Ödəniş Metodları) ----
  function getCardStyleByName(cardName, cardType) {
    const name = (cardName || '').toLowerCase();
    const type = (cardType || '').toLowerCase();
    
    let bg = 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.01) 60%, rgba(255,255,255,0.0) 100%), linear-gradient(210deg, #1e1948 0%, #110e25 100%)';
    let color = '#ffffff';
    let shadow = '0 12px 30px rgba(0,0,0,0.5)';
    
    if (name.includes('kapital')) {
      bg = 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 60%), linear-gradient(135deg, #FF3344 0%, #850010 100%)';
      shadow = '0 12px 32px rgba(255, 51, 68, 0.2)';
    } else if (name.includes('abb') || name.includes('beynəlxalq') || name.includes('beynelxalq') || name.includes('iba')) {
      bg = 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 60%), linear-gradient(135deg, #0072ff 0%, #002244 100%)';
      shadow = '0 12px 32px rgba(0, 114, 255, 0.2)';
    } else if (name.includes('pasha') || name.includes('paşa')) {
      bg = 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 60%), linear-gradient(135deg, #37332c 0%, #11100e 100%)';
      shadow = '0 12px 32px rgba(0,0,0,0.6)';
      color = '#e0bd68';
    } else if (name.includes('leo')) {
      bg = 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 60%), linear-gradient(135deg, #18191c 0%, #060708 100%)';
      color = '#1fe0c2';
      shadow = '0 12px 32px rgba(31,224,194,0.12)';
    } else if (type === 'visa') {
      bg = 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 60%), linear-gradient(135deg, #6952e0 0%, #1a153b 100%)';
      shadow = '0 12px 32px rgba(105, 82, 224, 0.2)';
    } else if (type === 'mastercard') {
      bg = 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 60%), linear-gradient(135deg, #ff8a00 0%, #da1b60 100%)';
      shadow = '0 12px 32px rgba(255, 138, 0, 0.2)';
    }
    
    return { bg, color, shadow };
  }

  function cardRowHTML(c) {
    const panDisplay = c.pan
      ? '•••• •••• •••• ' + String(c.pan).replace(/\s/g, '').slice(-4)
      : '•••• •••• •••• ••••';
    
    const style = getCardStyleByName(c.ad, c.kart_tipi);
    const brandLogoHTML = (c.kart_tipi || '').toLowerCase() === 'visa'
      ? `<img src="/visa.svg?v=1.2" style="height: 14px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));" alt="Visa">`
      : `<img src="/mastercard.svg?v=1.2" style="height: 18px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));" alt="Mastercard">`;

    return `
      <div class="wallet-card" style="background: ${style.bg}; color: ${style.color}; box-shadow: ${style.shadow};">
        <div class="wallet-card-glow"></div>
        <div class="wallet-card-header">
          <span class="wallet-bank-name">${c.ad.toUpperCase()}</span>
          <div class="wallet-brand-logo">${brandLogoHTML}</div>
        </div>
        <div class="wallet-card-chip">
          <svg viewBox="0 0 32 24" fill="none" style="width: 32px; height: 24px;">
            <rect width="32" height="24" rx="4" fill="url(#chip-grad-wallet-row)" />
            <path d="M0 8h32M0 16h32M10 0v24M22 0v24" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
            <rect x="10" y="8" width="12" height="8" rx="2" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>
            <defs>
              <linearGradient id="chip-grad-wallet-row" x1="0" y1="0" x2="32" y2="24" gradientUnits="userSpaceOnUse">
                <stop stop-color="#ffe8a3"/>
                <stop offset="0.5" stop-color="#ffd066"/>
                <stop offset="1" stop-color="#d49a17"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div class="wallet-card-number">${panDisplay}</div>
        <div class="wallet-card-footer">
          <div class="wallet-card-holder">
            <div class="wallet-label">KART SAHİBİ</div>
            <div class="wallet-value">${(currentUser && currentUser.ad ? currentUser.ad.toUpperCase() : 'ABUNƏÇİ')}</div>
          </div>
          <div class="wallet-card-expiry">
            <div class="wallet-label">SON TARİX</div>
            <div class="wallet-value">${c.kart_istifade_tarixi || 'AA/İİ'}</div>
          </div>
          <button class="wallet-card-delete" onclick="event.stopPropagation(); handleDeleteCard(${c.card_id})" title="Sil">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>`;
  }

  async function loadCards() {
    const res = await apiFetch('GET', `/api/odenis-metodlari?username=${currentUser.username}`);
    if (res.ok && res.data && res.data.data && res.data.data.cards) {
      cards = res.data.data.cards;
    } else {
      cards = [];
    }
    renderCards();
    updateCardDropdowns();
  }

  function renderCards() {
    const list = document.getElementById('cards-list');
    const sub = document.getElementById('cards-sub');
    if (cards.length === 0) {
      list.innerHTML = `
        <div class="hint" style="padding:20px 0;">
          <div style="font-size:40px;margin-bottom:12px;">💳</div>
          Hələ kart əlavə edilməyib.<br>
          <span style="color:var(--ink-muted);font-size:12px;">Yeni kart əlavə etmək üçün <strong style="color:var(--accent);">+</strong> düyməsini istifadə edin.</span>
        </div>
      `;
      if (sub) sub.textContent = '0 ödəniş metodu';
    } else {
      list.innerHTML = cards.map(cardRowHTML).join('');
      if (sub) sub.textContent = `${cards.length} ödəniş metodu`;
    }
  }

  function updateCardDropdowns() {
    ['new-sub-card', 'manage-sub-card'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const currentVal = sel.value;
      sel.innerHTML = '<option value="">-- Kart seçilməyib --</option>';
      cards.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.card_id;
        const brandLabel = (c.kart_tipi || '').toLowerCase() === 'visa' ? 'Visa' : 'Mastercard';
        opt.textContent = `${c.ad} (${brandLabel} ${c.pan ? '****' + String(c.pan).slice(-4) : ''})`;
        sel.appendChild(opt);
      });
      if (currentVal) sel.value = currentVal;
    });
  }

  // Card Brand Detection UI
  function detectCardBrandUI(pan) {
    const badge = document.getElementById('card-brand-badge');
    const errorEl = document.getElementById('card-pan-error');
    const cleaned = String(pan).replace(/\s/g, '');
    const logoEl = document.getElementById('preview-brand-logo');
    
    if (cleaned.length < 2) {
      badge.style.display = 'none';
      errorEl.style.display = 'none';
      if (logoEl) logoEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px; height:20px; opacity:0.5; color:#fff;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`;
      return;
    }
    
    let brand = null;
    if (cleaned.startsWith('4')) {
      brand = 'Visa';
    } else if (cleaned.startsWith('51') || cleaned.startsWith('52') || cleaned.startsWith('53') || 
               cleaned.startsWith('54') || cleaned.startsWith('55')) {
      brand = 'Mastercard';
    } else if (cleaned.length >= 4) {
      const prefix = parseInt(cleaned.substring(0, 4));
      if (prefix >= 2221 && prefix <= 2720) {
        brand = 'Mastercard';
      }
    }
    
    if (brand) {
      badge.textContent = brand;
      badge.style.display = 'block';
      badge.style.background = brand === 'Visa' ? 'var(--teal-soft)' : 'var(--gold-soft)';
      badge.style.color = brand === 'Visa' ? 'var(--teal)' : 'var(--gold)';
      errorEl.style.display = 'none';
      if (logoEl) {
        logoEl.innerHTML = brand === 'Visa' ? 
          `<img src="/visa.svg?v=1.2" style="height: 15px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));" alt="Visa">` : 
          `<img src="/mastercard.svg?v=1.2" style="height: 20px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));" alt="Mastercard">`;
      }
    } else {
      badge.style.display = 'none';
      if (logoEl) logoEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px; height:20px; opacity:0.5; color:#fff;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`;
      if (cleaned.length >= 4) {
        errorEl.style.display = 'block';
      } else {
        errorEl.style.display = 'none';
      }
    }
  }

  async function handleDeleteCard(id) {
    if (!confirm('Bu kartı silmək istəyirsiniz?')) return;
    const res = await apiFetch('DELETE', `/api/odenis-metodlari/${id}`);
    if (res.ok) {
      await loadCards();
    } else if (res.status === 409) {
      // Payment method in use
      alert('Bu kart aktiv abunəliklərdə istifadə olunur. Əvvəlcə abunəliyi başqa karta keçirin və ya silin.');
    } else {
      alert(res.data?.error?.message || 'Kart silinə bilmədi.');
    }
  }

  let cardSheetReturnTarget = null;
  function openCardSheet(returnTargetSelectId) {
    cardSheetReturnTarget = returnTargetSelectId || null;
    document.getElementById('card-name').value = '';
    document.getElementById('card-name').classList.remove('invalid');
    document.getElementById('card-pan').value = '';
    document.getElementById('card-pan').classList.remove('invalid');
    document.getElementById('card-expiry').value = '';
    document.getElementById('card-expiry').classList.remove('invalid');
    document.getElementById('card-cvv').value = '';
    document.getElementById('card-cvv').classList.remove('invalid');
    document.getElementById('card-error').textContent = '';
    document.getElementById('card-error').classList.remove('show');
    document.getElementById('card-brand-badge').style.display = 'none';
    document.getElementById('card-pan-error').style.display = 'none';

    // Reset Live Preview Card Mockup
    document.getElementById('preview-bank-name').textContent = 'BANK ADI';
    document.getElementById('preview-brand-logo').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px; height:20px; opacity:0.5; color:#fff;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`;
    document.getElementById('preview-card-number').textContent = '•••• •••• •••• ••••';
    document.getElementById('preview-card-expiry').textContent = 'AA/İİ';
    document.getElementById('preview-card-name').textContent = (currentUser && currentUser.ad ? currentUser.ad.toUpperCase() : 'ABUNƏÇİ');
    document.getElementById('preview-card-cvv').textContent = '•••';
    document.getElementById('live-preview-card').classList.remove('flipped');

    const overlay = document.getElementById('card-sheet-overlay');
    overlay.classList.add('open');
    updateBodyScrollLock();
    const sheet = overlay.querySelector('.sheet');
    if (sheet) sheet.scrollTop = 0;
  }
  function closeCardSheet() {
    document.getElementById('card-sheet-overlay').classList.remove('open');
    updateBodyScrollLock();
    if (document.activeElement) document.activeElement.blur();
    setTimeout(() => { window.scrollTo(0, window.scrollY); }, 80);
  }
  document.getElementById('card-sheet-overlay').addEventListener('click', e => {
    if (e.target.id === 'card-sheet-overlay') closeCardSheet();
  });

  function formatCardNum(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 16);
    input.value = v.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

async function handleAddCard() {
  const nameEl = document.getElementById('card-name');
  const name = nameEl.value.trim();
  const panEl = document.getElementById('card-pan');
  const panRaw = panEl.value.replace(/\s/g, '');
  const expiryEl = document.getElementById('card-expiry');
  const expiry = expiryEl.value.trim();
  const cvvEl = document.getElementById('card-cvv');
  const cvv = cvvEl.value.trim();
  const errEl = document.getElementById('card-error');

  console.log('🔵 ========== KART ƏLAVƏ ETMƏ ==========');
  console.log('🔵 Name:', name);
  console.log('🔵 PAN:', panRaw ? panRaw.substring(0,4) + '****' + panRaw.slice(-4) : 'EMPTY');
  console.log('🔵 Expiry:', expiry);
  console.log('🔵 CVV:', cvv ? '***' : 'EMPTY');

  // Auto-detect card brand from PAN
  const detectedBrand = detectCardBrandFromPan(panRaw);
  console.log('🔵 Aşkarlanan brend:', detectedBrand);
  
  if (!detectedBrand) {
    errEl.textContent = 'Dəstəklənməyən kart nömrəsi. Visa (4) və ya Mastercard (51-55, 2221-2720) daxil edin.';
    errEl.classList.add('show');
    panEl.classList.add('invalid');
    panEl.focus();
    console.log('❌ Dəstəklənməyən brend');
    return;
  }

  if (!name) {
    errEl.textContent = 'Kart adı məcburidir.';
    errEl.classList.add('show');
    nameEl.classList.add('invalid');
    nameEl.focus();
    console.log('❌ Ad boşdur');
    return;
  }
  nameEl.classList.remove('invalid');

  if (!panRaw) {
    errEl.textContent = 'Kart nömrəsi (PAN) məcburidir.';
    errEl.classList.add('show');
    panEl.classList.add('invalid');
    panEl.focus();
    console.log('❌ PAN boşdur');
    return;
  }
  if (panRaw.length < 12) {
    errEl.textContent = 'Kart nömrəsi ən azı 12 rəqəm olmalıdır.';
    errEl.classList.add('show');
    panEl.classList.add('invalid');
    panEl.focus();
    console.log('❌ PAN çox qısadır:', panRaw.length);
    return;
  }
  panEl.classList.remove('invalid');

  if (!expiry) {
    errEl.textContent = 'Son tarix (AA/İİ) məcburidir.';
    errEl.classList.add('show');
    expiryEl.classList.add('invalid');
    expiryEl.focus();
    console.log('❌ Expiry boşdur');
    return;
  }
  if (!/^\d{2}\/\d{2}$/.test(expiry)) {
    errEl.textContent = 'Son tarix formatı yanlışdır. Format: AA/İİ (məs: 12/28).';
    errEl.classList.add('show');
    expiryEl.classList.add('invalid');
    expiryEl.focus();
    console.log('❌ Expiry formatı yanlışdır:', expiry);
    return;
  }
  expiryEl.classList.remove('invalid');

  if (!cvv) {
    errEl.textContent = 'CVV məcburidir.';
    errEl.classList.add('show');
    cvvEl.classList.add('invalid');
    cvvEl.focus();
    console.log('❌ CVV boşdur');
    return;
  }
  if (!/^\d{3}$/.test(cvv)) {
    errEl.textContent = 'CVV yalnız 3 rəqəmdən ibarət olmalıdır.';
    errEl.classList.add('show');
    cvvEl.classList.add('invalid');
    cvvEl.focus();
    console.log('❌ CVV formatı yanlışdır:', cvv);
    return;
  }
  cvvEl.classList.remove('invalid');

  errEl.classList.remove('show');

  const payload = {
    username: currentUser.username,
    ad: name,
    pan: panRaw,
    kart_istifade_tarixi: expiry,
    cvv: cvv
  };

  console.log('🔵 Göndərilən payload:', {
    username: payload.username,
    ad: payload.ad,
    pan: payload.pan.substring(0,4) + '****' + payload.pan.slice(-4),
    kart_istifade_tarixi: payload.kart_istifade_tarixi,
    cvv: '***'
  });

  try {
    const res = await apiFetch('POST', '/api/odenis-metodlari', payload);
    console.log('🔵 Server cavabı:', res);
    
    if (res.ok) {
      console.log('✅ Kart uğurla əlavə edildi!');
      const newCardId = res.data?.data?.card_id ?? res.data?.card_id ?? null;
      closeCardSheet();
      await loadCards();
      if (cardSheetReturnTarget && newCardId) {
        const targetSel = document.getElementById(cardSheetReturnTarget);
        if (targetSel) {
          targetSel.value = String(newCardId);
          targetSel.classList.remove('invalid');
        }
      }
      cardSheetReturnTarget = null;
    } else {
      const errorMsg = res.data?.error?.message || res.data?.message || 'Kart əlavə edilə bilmədi.';
      console.log('❌ Server xətası:', errorMsg);
      console.log('❌ Tam xəta:', JSON.stringify(res.data, null, 2));
      errEl.textContent = errorMsg;
      errEl.classList.add('show');
    }
  } catch (error) {
    console.error('❌ Fetch xətası:', error);
    errEl.textContent = 'Serverlə əlaqə qurulmadı.';
    errEl.classList.add('show');
  }
}
  // Card brand detection helper (client-side)
  function detectCardBrandFromPan(pan) {
    const cleaned = String(pan).replace(/\s/g, '');
    if (cleaned.startsWith('4')) return 'visa';
    if (cleaned.startsWith('51') || cleaned.startsWith('52') || cleaned.startsWith('53') || 
        cleaned.startsWith('54') || cleaned.startsWith('55')) return 'mastercard';
    if (cleaned.length >= 4) {
      const prefix = parseInt(cleaned.substring(0, 4));
      if (prefix >= 2221 && prefix <= 2720) return 'mastercard';
    }
    return null;
  }

  // ---- Payment History ----
  function historyIconHTML(name, category) {
    return getBrandIconHTML(name, category);
  }

  function historyRowHTML(h) {
    const sym = h.valyuta === 'USD' ? '$' : h.valyuta === 'EUR' ? '€' : '₼';
    const dateStr = h.odenis_tarixi ? h.odenis_tarixi.substring(0, 10) : '-';
    const dateFmt = dateStr.split('-').reverse().join('.');
    const badgeCls = h.status === 'success' ? 'badge-success' : 'badge-fail';
    const badgeTxt = h.status === 'success' ? '✓ uğurlu' : '✗ uğursuz';
    return `
      <div class="history-row">
        ${historyIconHTML(h.app_adi, h.kateqoriya || 'Other')}
        <div class="history-info">
          <div class="history-name">${h.app_adi}</div>
          <div class="history-meta">${dateFmt}</div>
        </div>
        <div class="history-right">
          <div style="font-family:var(--font-mono);font-weight:600;font-size:13.5px;">${sym}${parseFloat(h.mebleq).toFixed(2)}</div>
          <span class="${badgeCls}">${badgeTxt}</span>
        </div>
      </div>`;
  }

  async function loadPaymentHistory() {
    const res = await apiFetch('GET', `/api/odenis-tarixcesi?username=${currentUser.username}`);
    if (res.ok && res.data && res.data.data && res.data.data.paymenthistory) {
      paymentHistory = res.data.data.paymenthistory;
    } else {
      paymentHistory = [];
    }
    renderPaymentHistory();
  }

  function renderPaymentHistory() {
    const list = document.getElementById('history-list');
    const sub = document.getElementById('history-sub');
    if (!list) return;
    if (paymentHistory.length === 0) {
      list.innerHTML = '<div class="hint">Hələ ödəniş tarixçəsi yoxdur.</div>';
      if (sub) sub.textContent = '0 ödəniş';
    } else {
      list.innerHTML = paymentHistory.map(historyRowHTML).join('');
      if (sub) sub.textContent = `${paymentHistory.length} ödəniş`;
    }
  }

  const ACCENT_COLORS = {
    dark: {
      gold: { main: '#ffb020', soft: 'rgba(255,176,32,0.18)' },
      teal: { main: '#17e0c9', soft: 'rgba(23,224,201,0.16)' },
      coral: { main: '#ff5b45', soft: 'rgba(255,91,69,0.19)' },
      purple: { main: '#b48bff', soft: 'rgba(180,139,255,0.18)' },
      blue: { main: '#4d8cff', soft: 'rgba(77,140,255,0.18)' }
    },
    light: {
      gold: { main: '#d6850a', soft: 'rgba(214,133,10,0.16)' },
      teal: { main: '#09a397', soft: 'rgba(9,163,151,0.14)' },
      coral: { main: '#de3823', soft: 'rgba(222,56,35,0.14)' },
      purple: { main: '#7c3aed', soft: 'rgba(124,58,237,0.14)' },
      blue: { main: '#1d63d8', soft: 'rgba(29,99,216,0.14)' }
    }
  };

  function applyAccentColor(colorName, themeMode) {
    const mode = themeMode || (document.documentElement.getAttribute('data-theme') || 'dark');
    const themeColors = ACCENT_COLORS[mode] || ACCENT_COLORS.dark;
    const color = themeColors[colorName] || themeColors.gold;
    document.documentElement.style.setProperty('--accent', color.main);
    document.documentElement.style.setProperty('--accent-soft', color.soft);

    document.querySelectorAll('.accent-opt').forEach(opt => {
      opt.classList.toggle('selected', opt.getAttribute('data-color') === colorName);
    });
  }

  async function setAccentColor(colorName) {
    if (!currentUser) return;
    currentSettings.tema_rengi = colorName;
    applyAccentColor(colorName);
    await onSettingChange('tema_rengi', colorName);
  }

  // Handle Setting updates
  async function onSettingChange(key, value) {
    currentSettings[key] = value;
    const res = await apiFetch('PUT', `/api/ayarlar/${currentUser.username}`, currentSettings);
    if (res.ok) {
      if (key === 'dil') applyLanguage(value);
    } else {
      console.error('Settings save failed:', res.data?.error?.message);
    }
  }

  function setTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    document.getElementById('theme-dark-opt').classList.toggle('selected', mode === 'dark');
    document.getElementById('theme-light-opt').classList.toggle('selected', mode === 'light');
    if (currentUser) {
      currentSettings.tema = mode;
      onSettingChange('tema', mode);
    }
    if (currentSettings && currentSettings.tema_rengi) {
      applyAccentColor(currentSettings.tema_rengi, mode);
    }
  }

  // Budget
  function renderBudgetCard() {
    const sym = currencySymbol(budgetState.currency);
    const pct = budgetState.limit > 0 ? Math.min(100, Math.round((budgetState.spent / budgetState.limit) * 100)) : 0;
    const free = Math.max(0, budgetState.limit - budgetState.spent);
    
    document.querySelector('.budget-spent').textContent = sym + budgetState.spent.toFixed(2);
    document.querySelector('.budget-limit').textContent = '/ ' + sym + budgetState.limit.toFixed(2);
    
    const barFill = document.querySelector('.budget-bar-fill');
    if (barFill) {
      barFill.style.width = pct + '%';
      if (pct >= 80) barFill.classList.add('pulse-glow');
      else barFill.classList.remove('pulse-glow');
    }

    // Circular progress ring
    const ringCircumference = 326.7;
    const ringFill = document.getElementById('budget-ring-fill');
    if (ringFill) {
      ringFill.style.strokeDashoffset = ringCircumference * (1 - pct / 100);
      if (pct >= 80) ringFill.classList.add('pulse-glow');
      else ringFill.classList.remove('pulse-glow');
    }
    const ringPct = document.getElementById('budget-ring-pct');
    if (ringPct) ringPct.textContent = pct + '%';
    
    // Update stats cards in dashboard
    document.getElementById('dashboard-monthly-spend').textContent = sym + budgetState.spent.toFixed(2);

    // Update new figma-style dashboard budget card
    const dbSpent = document.getElementById('db-budget-spent');
    if (dbSpent) dbSpent.textContent = sym + budgetState.spent.toFixed(2);
    const dbLimit = document.getElementById('db-budget-limit');
    if (dbLimit) dbLimit.textContent = '/ ' + sym + budgetState.limit.toFixed(2);
    
    const dbRingFill = document.getElementById('db-ring-fill');
    if (dbRingFill) {
      dbRingFill.style.strokeDashoffset = 251.2 * (1 - pct / 100);
      if (pct >= 80) dbRingFill.classList.add('pulse-glow');
      else dbRingFill.classList.remove('pulse-glow');
    }
    const dbRingPct = document.getElementById('db-ring-pct');
    if (dbRingPct) dbRingPct.textContent = pct + '%';
    
    document.querySelector('.budget-note').innerHTML =
      `Limitin <strong style="color:var(--ink)">%${pct}</strong>-i istifadə olunub · ${sym}${free.toFixed(2)} sərbəst qalıb.`;
    document.getElementById('budget-limit-display').textContent = sym + budgetState.limit.toFixed(2);
    document.getElementById('budget-currency-display').textContent = budgetState.currency;

    // Advanced: Calculate Category Breakdown
    const categoryTotals = {};
    const activeSubs = subscriptions.filter(s => s.status === 'active');
    activeSubs.forEach(s => {
      let monthlyEquiv = s.price;
      if (s.freqRaw === 'weekly') monthlyEquiv = s.price * 4;
      else if (s.freqRaw === 'yearly') monthlyEquiv = s.price / 12;
      else if (s.freqRaw === 'quarterly') monthlyEquiv = s.price / 3;

      const converted = convertCurrency(monthlyEquiv, s.currency, budgetState.currency);
      categoryTotals[s.category] = (categoryTotals[s.category] || 0) + converted;
    });

    // Render Category Breakdown List
    const breakdownListEl = document.getElementById('budget-breakdown-list');
    if (breakdownListEl) {
      if (Object.keys(categoryTotals).length === 0) {
        breakdownListEl.innerHTML = '<div class="hint" style="padding: 14px 16px;">Hələ aktiv abunəlik yoxdur.</div>';
      } else {
        breakdownListEl.innerHTML = Object.entries(categoryTotals)
          .map(([cat, total]) => {
            const catPct = budgetState.limit > 0 ? Math.min(100, Math.round((total / budgetState.limit) * 100)) : 0;
            const colorClass = CATEGORY_COLORS[cat] || 'neutral';
            return `
              <div class="settings-row" style="border-bottom: 1px solid var(--border); padding: 14px 16px; flex-direction:column; align-items:stretch;">
                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; margin-bottom:6px; color:var(--ink);">
                  <span>${cat}</span>
                  <span>${sym}${total.toFixed(2)} (${catPct}%)</span>
                </div>
                <div class="budget-bar-track" style="height: 6px; background:var(--surface-3); border-radius:10px; overflow:hidden;">
                  <div class="budget-bar-fill" style="width: ${catPct}%; background: var(--${colorClass === 'neutral' ? 'ink-faint' : colorClass}); height:100%; border-radius:10px;"></div>
                </div>
              </div>`;
          }).join('');
      }
    }

    // Render AI Smart Insights
    const insightsEl = document.getElementById('budget-insights-panel');
    if (insightsEl) {
      let insightHTML = '';
      if (pct >= 100) {
        insightHTML = `
          <div style="background: rgba(255, 91, 69, 0.06); border: 2px solid var(--coral); border-radius: 22px; padding: 18px; font-size:13px; line-height:1.5; color: var(--ink); box-shadow: 0 10px 24px -8px rgba(255, 91, 69, 0.12);">
            <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:var(--coral); margin-bottom:8px; font-family:var(--font-display); font-size:12px; letter-spacing:0.5px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-top:-1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>LİMİT AŞILIB</span>
            </div>
            Aylıq limitinizi tamamilə aşmısınız! Ümumi abunəlik xərcləriniz təyin etdiyiniz limitdən <strong>${sym}${(budgetState.spent - budgetState.limit).toFixed(2)}</strong> çoxdur. Xərclərinizi azaltmaq üçün bəzi lazımsız xidmətləri dayandırmağı tövsiyə edirik.
          </div>`;
      } else if (pct >= 80) {
        insightHTML = `
          <div style="background: rgba(245, 196, 107, 0.06); border: 2px solid var(--gold); border-radius: 22px; padding: 18px; font-size:13px; line-height:1.5; color: var(--ink); box-shadow: 0 10px 24px -8px rgba(245, 196, 107, 0.12);">
            <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:var(--gold); margin-bottom:8px; font-family:var(--font-display); font-size:12px; letter-spacing:0.5px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-top:-1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>KRİTİK HƏDD</span>
            </div>
            Büdcə limitiniz dolmaq üzrədir (%${pct} istifadə olunub). Yeni bir abunəlik qoşulsa, müəyyən etdiyiniz limiti keçəcəksiniz. Qalan sərbəst məbləğ: <strong>${sym}${free.toFixed(2)}</strong>.
          </div>`;
      } else {
        // Find top category
        let topCat = '';
        let topVal = 0;
        Object.entries(categoryTotals).forEach(([cat, val]) => {
          if (val > topVal) {
            topVal = val;
            topCat = cat;
          }
        });
        
        if (topCat) {
          insightHTML = `
            <div style="background: rgba(139, 92, 246, 0.06); border: 2px solid var(--purple); border-radius: 22px; padding: 18px; font-size:13px; line-height:1.5; color: var(--ink); box-shadow: 0 10px 24px -8px rgba(139, 92, 246, 0.12);">
              <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:var(--purple); margin-bottom:8px; font-family:var(--font-display); font-size:12px; letter-spacing:0.5px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-top:-1px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                <span>AĞILLI TƏHLİL</span>
              </div>
              Büdcəniz hazırda stabil vəziyyətdədir. Ən çox xərciniz <strong>${topCat}</strong> kateqoriyasınadır (aylıq <strong>${sym}${topVal.toFixed(2)}</strong>). Digər abunəliklər üçün hələ <strong>${sym}${free.toFixed(2)}</strong> sərbəst limitiniz var.
            </div>`;
        } else {
          insightHTML = `
            <div style="background: rgba(31, 224, 194, 0.06); border: 2px solid var(--teal); border-radius: 22px; padding: 18px; font-size:13px; line-height:1.5; color: var(--ink); box-shadow: 0 10px 24px -8px rgba(31, 224, 194, 0.12);">
              <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:var(--teal); margin-bottom:8px; font-family:var(--font-display); font-size:12px; letter-spacing:0.5px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-top:-1px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>HƏR ŞEY ƏLA</span>
              </div>
              Büdcəniz tam sərbəstdir! İlk abunəliyinizi əlavə etdikdən sonra burada ağıllı maliyyə təhlilləri və proqnozları göstəriləcəkdir.
            </div>`;
        }
      }
      insightsEl.innerHTML = insightHTML;
    }
  }

  function openBudgetEdit() {
    document.getElementById('budget-view').style.display = 'none';
    document.getElementById('budget-update-wrap').style.display = 'none';
    document.getElementById('budget-edit').style.display = 'block';
    document.getElementById('budget-edit-actions').style.display = 'flex';
    document.getElementById('budget-limit-input').value = budgetState.limit;
    document.getElementById('budget-spent-input').value = budgetState.spent;
    document.getElementById('budget-currency-input').value = budgetState.currency;
    clearBudgetError();
  }

  function closeBudgetEdit() {
    document.getElementById('budget-edit').style.display = 'none';
    document.getElementById('budget-edit-actions').style.display = 'none';
    document.getElementById('budget-view').style.display = 'block';
    document.getElementById('budget-update-wrap').style.display = 'block';
    clearBudgetError();
  }

  function clearBudgetError() {
    const err = document.getElementById('budget-error');
    err.classList.remove('show');
    err.textContent = '';
  }

  function showBudgetError(msg) {
    const err = document.getElementById('budget-error');
    err.textContent = msg;
    err.classList.add('show');
  }

  async function saveBudget() {
    const limitRaw = document.getElementById('budget-limit-input').value;
    const spentRaw = document.getElementById('budget-spent-input').value;
    const currency = document.getElementById('budget-currency-input').value;

    if (limitRaw === '' || limitRaw === null || limitRaw === undefined) {
      showBudgetError('limit_mebleq sahəsi məcburidir.');
      return;
    }
    const limit = Number(limitRaw);
    if (isNaN(limit) || limit <= 0) {
      showBudgetError('limit_mebleq 0-dan böyük olmalıdır.');
      return;
    }
    const spent = (spentRaw === '' || spentRaw === null) ? 0 : Number(spentRaw);
    if (isNaN(spent) || spent < 0) {
      showBudgetError('hesab_mebleqi mənfi ola bilməz.');
      return;
    }

    clearBudgetError();

    // Check if budget needs to be POSTed (new) or PUTted (update)
    let res;
    if (budgetState.exists) {
      res = await apiFetch('PUT', `/api/budceler/${currentUser.username}`, {
        limit_mebleq: limit,
        valyuta: currency,
        hesab_mebleqi: spent
      });
    } else {
      res = await apiFetch('POST', '/api/budceler', {
        username: currentUser.username,
        limit_mebleq: limit,
        valyuta: currency,
        hesab_mebleqi: spent
      });
    }

    if (res.ok) {
      budgetState = { limit, spent, currency, exists: true };
      renderBudgetCard();
      closeBudgetEdit();
    } else {
      showBudgetError(res.data?.error?.message || 'Büdcə yadda saxlanılmadı.');
    }
  }

  // i18n
  const translations = {
    az: {
      tab_overview: 'İcmal', tab_subs: 'Abunəlik', tab_notif: 'Bildiriş', tab_budget: 'Büdcə', tab_settings: 'Ayarlar',
      dashboard_title: 'Xoş gördük', dashboard_sub: 'Aktiv abunəlik izlənilir',
      stat_active: 'Aktiv abunəlik', stat_monthly: 'Aylıq xərc', stat_next: 'Növbəti ödəniş', today_label: 'bu gün',
      ruler_title: 'Ödəniş cədvəli', legend_urgent: '≤2 gün', legend_soon: '≤7 gün', legend_normal: 'normal',
      section_upcoming: 'Yaxınlaşan ödənişlər', section_notifications: 'Bildirişlər', section_all_link: 'Hamısı →',
      subs_eyebrow: 'Abunəliklər', subs_title: 'Hamısı', subs_sub: '0 abunəlik',
      search_placeholder: 'Abunəlik axtar…', filter_all: 'Hamısı',
      notif_eyebrow: 'Bildirişlər', notif_title: 'Xəbərdarlıqlar', notif_sub: 'Ödənişdən əvvəl xəbərdarlıq gəlir',
      budget_eyebrow: 'Büdcə', budget_title: 'Aylıq limit', budget_sub: 'İstifadəçi başına 1 aktiv limit',
      budget_limit_label: 'Limit məbləği', budget_currency_label: 'Valyuta', budget_spent_label: 'Xərclənib (hesab_mebleqi)',
      budget_update_btn: 'Limiti yenilə', budget_save_btn: 'Yadda saxla', budget_cancel_btn: 'İmtina et',
      settings_eyebrow: 'Ayarlar', settings_title: 'Hesabım',
      settings_currency: 'Əsas valyuta', settings_notif: 'Bildiriş metodu', settings_lang: 'Dil',
      settings_theme: 'Görünüş', theme_dark: 'Tünd', theme_light: 'Açıq',
      settings_theme_color: 'Tema rəngi',
      sheet_title: 'Yeni abunəlik', field_name: 'Ad', field_price: 'Qiymət', field_currency: 'Valyuta',
      field_freq: 'Tezlik', field_start: 'Başlama tarixi', field_category: 'Kateqoriya',
      freq_monthly: 'Aylıq', freq_yearly: 'İllik', freq_quarterly: 'Rüblük', freq_weekly: 'Həftəlik',
      btn_cancel: 'İmtina et', btn_add: 'Əlavə et', price_error: 'Qiymət 0-dan böyük olmalıdır.',
      hint: 'Abunəm v1.1 · Bütün məlumatlar username üzərindən sinxronlaşdırılır',
      auth_subtitle: 'Abunəliklərinizi asanlıqla idarə edin',
      auth_select_user: 'Mövcud istifadəçi seçin',
      settings_logout: 'Çıxış et',
      field_status: 'Status',
      status_active: 'Aktiv',
      status_deactive: 'Dayandırılıb',
      btn_delete: 'Abunəlik Sil',
      tab_history: 'Tarixçə', tab_cards: 'Kartlar',
      field_card: 'Ödəniş kartı'
    },
    en: {
      tab_overview: 'Overview', tab_subs: 'Subs', tab_notif: 'Alerts', tab_budget: 'Budget', tab_settings: 'Settings',
      dashboard_title: 'Welcome back', dashboard_sub: 'Active subscriptions tracked',
      stat_active: 'Active subs', stat_monthly: 'Monthly spend', stat_next: 'Next payment', today_label: 'today',
      ruler_title: 'Payment schedule', legend_urgent: '≤2 days', legend_soon: '≤7 days', legend_normal: 'normal',
      section_upcoming: 'Upcoming payments', section_notifications: 'Notifications', section_all_link: 'See all →',
      subs_eyebrow: 'Subscriptions', subs_title: 'All', subs_sub: '0 subscriptions',
      search_placeholder: 'Search subscriptions…', filter_all: 'All',
      notif_eyebrow: 'Notifications', notif_title: 'Alerts', notif_sub: 'You get alerted before each payment',
      budget_eyebrow: 'Budget', budget_title: 'Monthly limit', budget_sub: '1 active limit per user',
      budget_limit_label: 'Limit amount', budget_currency_label: 'Currency', budget_spent_label: 'Spent (hesab_mebleqi)',
      budget_update_btn: 'Update limit', budget_save_btn: 'Save', budget_cancel_btn: 'Cancel',
      settings_eyebrow: 'Settings', settings_title: 'My account',
      settings_currency: 'Base currency', settings_notif: 'Notification method', settings_lang: 'Language',
      settings_theme: 'Appearance', theme_dark: 'Dark', theme_light: 'Light',
      settings_theme_color: 'Theme color',
      sheet_title: 'New subscription', field_name: 'Name', field_price: 'Price', field_currency: 'Currency',
      field_freq: 'Frequency', field_start: 'Start date', field_category: 'Category',
      freq_monthly: 'Monthly', freq_yearly: 'Yearly', freq_quarterly: 'Quarterly', freq_weekly: 'Weekly',
      btn_cancel: 'Cancel', btn_add: 'Add', price_error: 'Price must be greater than 0.',
      hint: 'Abunəm v1.1 · All data is synced via username',
      auth_subtitle: 'Manage your subscriptions easily',
      auth_select_user: 'Select existing user',
      settings_logout: 'Log out',
      field_status: 'Status',
      status_active: 'Active',
      status_deactive: 'Paused',
      btn_delete: 'Delete Subscription',
      tab_history: 'History', tab_cards: 'Cards',
      field_card: 'Payment card'
    },
    ru: {
      tab_overview: 'Обзор', tab_subs: 'Подписки', tab_notif: 'Уведомления', tab_budget: 'Бюджет', tab_settings: 'Настройки',
      dashboard_title: 'С возвращением', dashboard_sub: 'Активные подписки',
      stat_active: 'Активные подписки', stat_monthly: 'Расход в месяц', stat_next: 'Следующий платёж', today_label: 'сегодня',
      ruler_title: 'График платежей', legend_urgent: '≤2 дн', legend_soon: '≤7 дн', legend_normal: 'обычно',
      section_upcoming: 'Ближайшие платежи', section_notifications: 'Уведомления', section_all_link: 'Все →',
      subs_eyebrow: 'Подписки', subs_title: 'Все', subs_sub: '0 подписок',
      search_placeholder: 'Поиск подписок…', filter_all: 'Все',
      notif_eyebrow: 'Уведомления', notif_title: 'Оповещения', notif_sub: 'Уведомление приходит до платежа',
      budget_eyebrow: 'Бюджет', budget_title: 'Месячный лимит', budget_sub: '1 активный лимит на пользователя',
      budget_limit_label: 'Сумма лимита', budget_currency_label: 'Валюта', budget_spent_label: 'Потрачено (hesab_mebleqi)',
      budget_update_btn: 'Обновить лимит', budget_save_btn: 'Сохранить', budget_cancel_btn: 'Отмена',
      settings_eyebrow: 'Настройки', settings_title: 'Мой аккаунт',
      settings_currency: 'Основная валюта', settings_notif: 'Способ уведомления', settings_lang: 'Язык',
      settings_theme: 'Внешний вид', theme_dark: 'Тёмная', theme_light: 'Светлая',
      settings_theme_color: 'Цвет темы',
      sheet_title: 'Новая подписка', field_name: 'Название', field_price: 'Цена', field_currency: 'Валюта',
      field_freq: 'Периодичность', field_start: 'Дата начала', field_category: 'Категория',
      freq_monthly: 'Ежемесячно', freq_yearly: 'Ежегодно', freq_quarterly: 'Ежеквартально', freq_weekly: 'Еженедельно',
      btn_cancel: 'Отмена', btn_add: 'Добавить', price_error: 'Цена должна быть больше 0.',
      hint: 'Abunəm v1.1 · Все данные синхронизируются по username',
      auth_subtitle: 'Легко управляйте подписками',
      auth_select_user: 'Выберите пользователя',
      settings_logout: 'Выйти',
      field_status: 'Статус',
      status_active: 'Активно',
      status_deactive: 'Приостановлено',
      btn_delete: 'Удалить подписку',
      tab_history: 'История', tab_cards: 'Карты',
      field_card: 'Карта оплаты'
    },
    tr: {
      tab_overview: 'Genel', tab_subs: 'Abonelik', tab_notif: 'Bildirim', tab_budget: 'Bütçe', tab_settings: 'Ayarlar',
      dashboard_title: 'Tekrar hoş geldin', dashboard_sub: 'Aktif abonelik izleniyor',
      stat_active: 'Aktif abonelik', stat_monthly: 'Aylık harcama', stat_next: 'Sıradaki ödeme', today_label: 'bugün',
      ruler_title: 'Ödeme takvimi', legend_urgent: '≤2 gün', legend_soon: '≤7 gün', legend_normal: 'normal',
      section_upcoming: 'Yaklaşan ödemeler', section_notifications: 'Bildirimler', section_all_link: 'Tümü →',
      subs_eyebrow: 'Abonelikler', subs_title: 'Tümü', subs_sub: '0 abonelik',
      search_placeholder: 'Abonelik ara…', filter_all: 'Tümü',
      notif_eyebrow: 'Bildirimler', notif_title: 'Uyarılar', notif_sub: 'Ödemeden önce uyarı gelir',
      budget_eyebrow: 'Bütçe', budget_title: 'Aylıq limit', budget_sub: 'Kullanıcı başına 1 aktif limit',
      budget_limit_label: 'Limit tutarı', budget_currency_label: 'Para birimi', budget_spent_label: 'Harcanan (hesab_mebleqi)',
      budget_update_btn: 'Limiti güncelle', budget_save_btn: 'Kaydet', budget_cancel_btn: 'Vazgeç',
      settings_eyebrow: 'Ayarlar', settings_title: 'Hesabım',
      settings_currency: 'Ana para birimi', settings_notif: 'Bildirim yöntemi', settings_lang: 'Dil',
      settings_theme: 'Görünüm', theme_dark: 'Koyu', theme_light: 'Açık',
      settings_theme_color: 'Tema rengi',
      sheet_title: 'Yeni abonelik', field_name: 'Ad', field_price: 'Fiyat', field_currency: 'Para birimi',
      field_freq: 'Sıklık', field_start: 'Başlangıç tarihi', field_category: 'Kategori',
      freq_monthly: 'Aylık', freq_yearly: 'Yıllık', freq_quarterly: 'Üç aylık', freq_weekly: 'Haftalık',
      btn_cancel: 'Vazgeç', btn_add: 'Ekle', price_error: 'Fiyat 0\'dan büyük olmalıdır.',
      hint: 'Abunəm v1.1 · Tüm veriler username üzerinden senkronize edilir',
      auth_subtitle: 'Aboneliklerinizi kolayca yönetin',
      auth_select_user: 'Mevcut kullanıcı seç',
      settings_logout: 'Çıkış yap',
      field_status: 'Durum',
      status_active: 'Aktif',
      status_deactive: 'Durduruldu',
      btn_delete: 'Aboneliği Sil',
      tab_history: 'Geçmiş', tab_cards: 'Kartlar',
      field_card: 'Ödeme kartı'
    }
  };

  function applyLanguage(lang) {
    const dict = translations[lang] || translations.az;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) {
        if (key === 'dashboard_title' && currentUser) {
          el.textContent = dict[key] + ', ' + currentUser.ad.split(' ')[0];
        } else {
          el.textContent = dict[key];
        }
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (dict[key] !== undefined) el.placeholder = dict[key];
    });
    document.documentElement.lang = lang;
    const langSelect = document.getElementById('setting-lang');
    if (langSelect) langSelect.value = lang;
  }

  // On page load
  window.addEventListener('DOMContentLoaded', () => {
    // Read local storage for logged user
    const storedUser = localStorage.getItem('abunelik_user');
    const storedToken = localStorage.getItem('abunelik_token');
    if (storedUser && storedToken) {
      try {
        currentUser = JSON.parse(storedUser);
        showApp();
      } catch (e) {
        handleLogout();
      }
    } else {
      handleLogout();
    }

    // Real-time Card Preview Listeners
    const cardNameInp = document.getElementById('card-name');
    const cardPanInp = document.getElementById('card-pan');
    const cardExpiryInp = document.getElementById('card-expiry');
    const cardCvvInp = document.getElementById('card-cvv');
    const livePreviewCard = document.getElementById('live-preview-card');

    if (cardNameInp) {
      cardNameInp.addEventListener('input', (e) => {
        const bankName = e.target.value;
        document.getElementById('preview-bank-name').textContent = bankName.toUpperCase() || 'BANK ADI';
        
        const pan = cardPanInp ? cardPanInp.value : '';
        const brand = detectCardBrandFromPan(pan);
        const style = getCardStyleByName(bankName, brand);
        const cardFront = document.querySelector('#live-preview-card .preview-card-front');
        if (cardFront) {
          cardFront.style.background = style.bg;
          cardFront.style.color = style.color;
          cardFront.style.boxShadow = style.shadow;
        }
      });
    }
    if (cardPanInp) {
      cardPanInp.addEventListener('input', (e) => {
        const pan = e.target.value;
        document.getElementById('preview-card-number').textContent = pan || '•••• •••• •••• ••••';
        
        const brand = detectCardBrandFromPan(pan);
        const bankName = cardNameInp ? cardNameInp.value : '';
        const style = getCardStyleByName(bankName, brand);
        const cardFront = document.querySelector('#live-preview-card .preview-card-front');
        if (cardFront) {
          cardFront.style.background = style.bg;
          cardFront.style.color = style.color;
          cardFront.style.boxShadow = style.shadow;
        }
      });
    }
    if (cardExpiryInp) {
      cardExpiryInp.addEventListener('input', (e) => {
        let val = e.target.value;
        if (val.length === 2 && !val.includes('/')) {
          val = val + '/';
          e.target.value = val;
        }
        document.getElementById('preview-card-expiry').textContent = val || 'AA/İİ';
      });
    }
    if (cardCvvInp) {
      cardCvvInp.addEventListener('input', (e) => {
        document.getElementById('preview-card-cvv').textContent = e.target.value || '•••';
      });
      cardCvvInp.addEventListener('focus', () => {
        livePreviewCard.classList.add('flipped');
      });
      cardCvvInp.addEventListener('blur', () => {
        livePreviewCard.classList.remove('flipped');
      });
    }

    // iOS/iPhone scroll and rubber-banding fix for modals
    document.querySelectorAll('.sheet-overlay').forEach(overlay => {
      overlay.addEventListener('touchmove', e => {
        if (!e.target.closest('.sheet')) {
          e.preventDefault();
        }
      }, { passive: false });
    });
  });
