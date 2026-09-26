'use strict';

/* ---------- إعدادات الاشتراك (عدّل الأسعار وأرقام الحسابات هنا) ---------- */
/* عدد أيام التجربة المجانية معرّف بملف js/admin.js (TRIAL_DAYS) لأن العد يبدأ لحظة موافقة الإدارة */

const PLANS = {
  monthly: { label: 'شهري', price: 80, currency: '$', days: 30 },
  yearly: { label: 'سنوي', price: 500, currency: '$', days: 365 },
};

const PAYMENT_INFO = {
  zaincash: '07709322035',
  rafidain: '917302257758 (ماستر كارد)',
  fib: '07709322035',
};

/* ---------- حالة التطبيق ---------- */

let currentUser = null;
let currentStoreId = null;

let products = []; // {id, barcode, name, price}
let sales = []; // {id, date, items, total}
let settings = { storeName: '', currency: 'د.ع' };
let subscription = { status: 'trial', plan: null, trialEndsAt: null, expiresAt: null };
let accessState = 'trial'; // trial | active | locked
let cart = []; // {barcode, name, price, qty}  -- محلي فقط، ما يُخزَّن بالسحابة

let unsubProducts = null;
let unsubSales = null;
let unsubStore = null;
let unsubPendingApproval = null;

/* ---------- أدوات مساعدة ---------- */

function findProductByBarcode(barcode) {
  return products.find(p => p.barcode === barcode);
}

function formatMoney(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function cartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapAuthError(code) {
  const map = {
    'auth/email-already-in-use': 'هذا البريد مستخدم مسبقًا',
    'auth/invalid-email': 'صيغة البريد غير صحيحة',
    'auth/weak-password': 'كلمة المرور ضعيفة (٦ أحرف على الأقل)',
    'auth/user-not-found': 'الحساب غير موجود',
    'auth/wrong-password': 'كلمة المرور غير صحيحة',
    'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
    'auth/network-request-failed': 'تحقق من اتصال الإنترنت',
    'auth/too-many-requests': 'محاولات كثيرة، حاول لاحقًا',
  };
  return map[code] || 'حدث خطأ، حاول مرة ثانية';
}

/* ---------- شاشة تسجيل الدخول ---------- */

const authScreen = document.getElementById('view-auth');
const appShell = document.getElementById('app-shell');
const pendingApprovalScreen = document.getElementById('view-pending-approval');
const authError = document.getElementById('auth-error');
const authSuccess = document.getElementById('auth-success');
const authLoading = document.getElementById('auth-loading');

function showAuthError(msg) {
  authSuccess.classList.add('hidden');
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

function showAuthSuccess(msg) {
  authError.classList.add('hidden');
  authSuccess.textContent = msg;
  authSuccess.classList.remove('hidden');
}

function clearAuthError() {
  authError.classList.add('hidden');
  authSuccess.classList.add('hidden');
}

function setAuthLoading(isLoading) {
  authLoading.classList.toggle('hidden', !isLoading);
}

function switchAuthTab(tabName) {
  document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.auth-form-tab').forEach(f => f.classList.add('hidden'));
  document.getElementById(tabName + '-form').classList.remove('hidden');
}

document.querySelectorAll('.auth-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchAuthTab(btn.dataset.tab);
    clearAuthError();
  });
});

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearAuthError();
  setAuthLoading(true);
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    showAuthError(mapAuthError(err.code));
  } finally {
    setAuthLoading(false);
  }
});

document.getElementById('btn-forgot-password').addEventListener('click', async () => {
  clearAuthError();
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    showAuthError('اكتب بريدك الإلكتروني بالحقل فوق أول، وبعدين اضغط "نسيت كلمة المرور"');
    return;
  }
  setAuthLoading(true);
  try {
    await auth.sendPasswordResetEmail(email);
    showAuthSuccess('✅ تم إرسال رابط استعادة كلمة المرور لبريدك. افتح بريدك واضغط الرابط.');
  } catch (err) {
    showAuthError(mapAuthError(err.code));
  } finally {
    setAuthLoading(false);
  }
});

// نمنع مستمع onAuthStateChanged من محاولة الدخول أثناء إنشاء مستندات المحل/العضوية
// لأن Firebase يُطلق حدث تسجيل الدخول فور إنشاء الحساب، قبل ما نخلص كتابة بيانات المحل
let suppressAuthListener = false;

document.getElementById('new-store-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearAuthError();
  setAuthLoading(true);
  suppressAuthListener = true;
  const storeName = document.getElementById('ns-store-name').value.trim();
  const email = document.getElementById('ns-email').value.trim();
  const password = document.getElementById('ns-password').value;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    const storeRef = await db.collection('stores').add({
      name: storeName,
      currency: 'د.ع',
      ownerUid: uid,
      createdAt: new Date().toISOString(),
      approvalStatus: 'pending',
      subscription: {
        status: 'trial',
        plan: null,
        trialEndsAt: null,
        expiresAt: null,
      },
    });
    await storeRef.collection('members').doc(uid).set({ role: 'owner', email });
    await db.collection('users').doc(uid).set({ storeId: storeRef.id });
    currentUser = cred.user;
    currentStoreId = storeRef.id;
    proceedAfterStoreResolved(storeRef.id);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      switchAuthTab('login');
      document.getElementById('login-email').value = email;
      showAuthError('هذا البريد عنده حساب مسجّل مسبقًا. سجّل دخول بكلمة مرورك، أو اضغط "نسيت كلمة المرور؟" إذا ما تتذكرها.');
    } else {
      showAuthError(mapAuthError(err.code));
    }
  } finally {
    suppressAuthListener = false;
    setAuthLoading(false);
  }
});

document.getElementById('join-store-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearAuthError();
  setAuthLoading(true);
  suppressAuthListener = true;
  const storeCode = document.getElementById('js-store-code').value.trim();
  const email = document.getElementById('js-email').value.trim();
  const password = document.getElementById('js-password').value;
  try {
    const storeDoc = await db.collection('stores').doc(storeCode).get();
    if (!storeDoc.exists) {
      showAuthError('كود المحل غير صحيح');
      return;
    }
    const storeApproval = storeDoc.data().approvalStatus || 'approved';
    if (storeApproval !== 'approved') {
      showAuthError('هذا المحل لسا قيد المراجعة من الإدارة، ما تكدر تنضم إله الحين');
      return;
    }
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    await db.collection('stores').doc(storeCode).collection('members').doc(uid).set({ role: 'cashier', email });
    await db.collection('users').doc(uid).set({ storeId: storeCode });
    currentUser = cred.user;
    currentStoreId = storeCode;
    proceedAfterStoreResolved(storeCode);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      switchAuthTab('login');
      document.getElementById('login-email').value = email;
      showAuthError('هذا البريد عنده حساب مسجّل مسبقًا. سجّل دخول بكلمة مرورك، أو اضغط "نسيت كلمة المرور؟" إذا ما تتذكرها.');
    } else {
      showAuthError(mapAuthError(err.code));
    }
  } finally {
    suppressAuthListener = false;
    setAuthLoading(false);
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  if (confirm('تسجيل الخروج؟')) {
    await auth.signOut();
  }
});

/* ---------- مراقبة حالة تسجيل الدخول ---------- */

auth.onAuthStateChanged(async user => {
  if (suppressAuthListener) return;
  setAuthLoading(false);
  if (user) {
    currentUser = user;
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      if (!userDoc.exists) {
        showAuthError('لا يوجد محل مرتبط بهذا الحساب');
        await auth.signOut();
        return;
      }
      currentStoreId = userDoc.data().storeId;
      proceedAfterStoreResolved(currentStoreId);
    } catch (err) {
      showAuthError(mapAuthError(err.code));
    }
  } else {
    currentUser = null;
    currentStoreId = null;
    detachListeners();
    products = [];
    sales = [];
    cart = [];
    subscription = { status: 'trial', plan: null, trialEndsAt: null, expiresAt: null };
    accessState = 'trial';
    document.getElementById('trial-banner').classList.add('hidden');
    hidePendingApprovalScreen();
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
  }
});

function detachListeners() {
  if (unsubProducts) unsubProducts();
  if (unsubSales) unsubSales();
  if (unsubStore) unsubStore();
  if (unsubPendingApproval) unsubPendingApproval();
  unsubProducts = unsubSales = unsubStore = unsubPendingApproval = null;
}

/* ---------- مراجعة تسجيل المحل قبل الدخول (يستمع مباشرة، فيدخل تلقائيًا فور الموافقة) ---------- */

function proceedAfterStoreResolved(storeId) {
  if (unsubPendingApproval) unsubPendingApproval();

  unsubPendingApproval = db.collection('stores').doc(storeId).onSnapshot(doc => {
    const approvalStatus = doc.exists ? (doc.data().approvalStatus || 'approved') : 'approved';

    if (approvalStatus === 'pending') {
      showPendingApprovalScreen('pending');
    } else if (approvalStatus === 'rejected') {
      showPendingApprovalScreen('rejected');
    } else {
      if (unsubPendingApproval) { unsubPendingApproval(); unsubPendingApproval = null; }
      hidePendingApprovalScreen();
      enterApp();
    }
  }, err => alert('خطأ بالتحقق من حالة المحل: ' + err.message));
}

function showPendingApprovalScreen(status) {
  authScreen.classList.add('hidden');
  appShell.classList.add('hidden');
  pendingApprovalScreen.classList.remove('hidden');

  const content = document.getElementById('pending-approval-content');
  if (status === 'pending') {
    content.innerHTML = '<p>⏳ طلب تسجيل محلك قيد المراجعة من الإدارة حاليًا. بترجع تقدر تسجّل دخول عادي أول ما توافَق عليه.</p>';
  } else {
    content.innerHTML = '<p>⛔ تم رفض طلب تسجيل هذا المحل.</p>';
  }
}

function hidePendingApprovalScreen() {
  pendingApprovalScreen.classList.add('hidden');
}

document.getElementById('btn-pending-logout').addEventListener('click', () => auth.signOut());

function enterApp() {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  clearAuthError();
  document.getElementById('login-form').reset();
  document.getElementById('new-store-form').reset();
  document.getElementById('join-store-form').reset();

  document.getElementById('store-code-text').textContent = currentStoreId;

  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-sale').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="view-sale"]').classList.add('active');

  unsubStore = db.collection('stores').doc(currentStoreId).onSnapshot(doc => {
    const data = doc.data();
    if (!data) return;
    settings.storeName = data.name || '';
    settings.currency = data.currency || 'د.ع';
    document.getElementById('st-store-name').value = settings.storeName;
    document.getElementById('st-currency').value = settings.currency;
    document.getElementById('currency-label-1').textContent = settings.currency;
    subscription = data.subscription || { status: 'trial', plan: null, trialEndsAt: null, expiresAt: null };
    accessState = computeAccessState(subscription);
    applyAccessGate();
    renderCart();
  });

  unsubProducts = db.collection('stores').doc(currentStoreId).collection('products')
    .onSnapshot(snap => {
      products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderProducts(document.getElementById('product-search').value);
    }, err => alert('خطأ بتحميل المنتجات: ' + err.message));

  unsubSales = db.collection('stores').doc(currentStoreId).collection('sales')
    .onSnapshot(snap => {
      sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      sales.sort((a, b) => new Date(a.date) - new Date(b.date));
      renderSales();
    }, err => alert('خطأ بتحميل الفواتير: ' + err.message));

  renderCart();
  barcodeInput.focus();
}

/* ---------- التنقل بين الشاشات ---------- */

const views = document.querySelectorAll('.view');
const navButtons = document.querySelectorAll('.nav-btn');

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (accessState === 'locked' && btn.dataset.view !== 'view-subscription') return;
    navButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    views.forEach(v => v.classList.add('hidden'));
    document.getElementById(btn.dataset.view).classList.remove('hidden');
    if (btn.dataset.view === 'view-products') renderProducts();
    if (btn.dataset.view === 'view-reports') renderSales();
    if (btn.dataset.view === 'view-subscription') renderSubscriptionScreen();
    if (btn.dataset.view === 'view-sale') document.getElementById('barcode-input').focus();
  });
});

/* ---------- الاشتراك: حساب الحالة وتطبيق القفل ---------- */

function computeAccessState(sub) {
  const now = new Date();
  if (sub.status === 'active' && sub.expiresAt && new Date(sub.expiresAt) > now) return 'active';
  if (sub.status === 'trial' && sub.trialEndsAt && new Date(sub.trialEndsAt) > now) return 'trial';
  return 'locked';
}

function applyAccessGate() {
  const locked = accessState === 'locked';

  if (locked) {
    views.forEach(v => v.classList.add('hidden'));
    document.getElementById('view-subscription').classList.remove('hidden');
    navButtons.forEach(b => b.classList.remove('active'));
    document.querySelector('.nav-btn[data-view="view-subscription"]').classList.add('active');
  }

  renderTrialBanner();
  renderSubscriptionScreen();
}

function renderTrialBanner() {
  const banner = document.getElementById('trial-banner');
  if (accessState === 'trial') {
    const daysLeft = Math.max(0, Math.ceil((new Date(subscription.trialEndsAt) - new Date()) / 86400000));
    banner.textContent = `🎁 تجربة مجانية — باقي ${daysLeft} يوم`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function renderSubscriptionScreen() {
  document.getElementById('plan-price-monthly').textContent = PLANS.monthly.currency + formatMoney(PLANS.monthly.price);
  document.getElementById('plan-price-yearly').textContent = PLANS.yearly.currency + formatMoney(PLANS.yearly.price);
  document.getElementById('pm-zaincash').textContent = PAYMENT_INFO.zaincash;
  document.getElementById('pm-rafidain').textContent = PAYMENT_INFO.rafidain;
  document.getElementById('pm-fib').textContent = PAYMENT_INFO.fib;

  const card = document.getElementById('sub-status-card');
  card.classList.remove('status-trial', 'status-active', 'status-expired');

  if (accessState === 'trial') {
    const daysLeft = Math.max(0, Math.ceil((new Date(subscription.trialEndsAt) - new Date()) / 86400000));
    card.classList.add('status-trial');
    card.innerHTML = `<span class="status-title">🎁 فترة تجربة مجانية</span>باقي ${daysLeft} يوم — اختر خطة وادفع بأي وقت قبل انتهائها.`;
  } else if (accessState === 'active') {
    card.classList.add('status-active');
    const until = new Date(subscription.expiresAt).toLocaleDateString('ar-EG');
    card.innerHTML = `<span class="status-title">✅ الاشتراك مفعّل</span>الخطة: ${PLANS[subscription.plan]?.label || '—'} — ينتهي بتاريخ ${until}`;
  } else {
    card.classList.add('status-expired');
    card.innerHTML = `<span class="status-title">⛔ انتهت الفترة</span>فعّل اشتراكك بالأسفل عشان تكمل استخدام التطبيق.`;
  }
}

document.getElementById('subscription-form').addEventListener('submit', async e => {
  e.preventDefault();
  const plan = document.querySelector('input[name="sub-plan"]:checked').value;
  const method = document.getElementById('sub-method').value;
  const reference = document.getElementById('sub-reference').value.trim();
  const note = document.getElementById('sub-note').value.trim();
  const msgEl = document.getElementById('sub-form-msg');

  try {
    await db.collection('subscriptionRequests').add({
      storeId: currentStoreId,
      plan,
      method,
      reference,
      note,
      amount: PLANS[plan].price,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    });
    msgEl.textContent = '✅ تم إرسال طلبك، بانتظار التأكيد من الإدارة خلال وقت قصير.';
    msgEl.classList.remove('hidden');
    e.target.reset();
  } catch (err) {
    alert('تعذر إرسال الطلب: ' + err.message);
  }
});

/* ---------- وضع المسح: يدوي/ماسح USB مقابل كاميرا ---------- */

const btnModeManual = document.getElementById('btn-mode-manual');
const btnModeCamera = document.getElementById('btn-mode-camera');
const manualPanel = document.getElementById('manual-scan-panel');
const cameraPanel = document.getElementById('camera-scan-panel');
const barcodeInput = document.getElementById('barcode-input');
let html5QrCode = null;

btnModeManual.addEventListener('click', () => {
  btnModeManual.classList.add('active');
  btnModeCamera.classList.remove('active');
  manualPanel.classList.remove('hidden');
  cameraPanel.classList.add('hidden');
  stopCamera();
  barcodeInput.focus();
});

btnModeCamera.addEventListener('click', () => {
  btnModeCamera.classList.add('active');
  btnModeManual.classList.remove('active');
  cameraPanel.classList.remove('hidden');
  manualPanel.classList.add('hidden');
  startCamera();
});

function startCamera() {
  html5QrCode = new Html5Qrcode('reader');
  html5QrCode
    .start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      decodedText => handleScannedCode(decodedText)
    )
    .catch(() => {
      alert('تعذر تشغيل الكاميرا. تأكد من إعطاء إذن الكاميرا للمتصفح.');
    });
}

function stopCamera() {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }
}

document.getElementById('btn-stop-camera').addEventListener('click', () => {
  btnModeManual.click();
});

barcodeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const code = barcodeInput.value.trim();
    barcodeInput.value = '';
    if (code) handleScannedCode(code);
  }
});

/* ---------- معالجة كود ممسوح ---------- */

let lastScanTime = 0;
function handleScannedCode(code) {
  const now = Date.now();
  if (now - lastScanTime < 800) return; // تجنّب التكرار السريع من الكاميرا
  lastScanTime = now;

  const product = findProductByBarcode(code);
  if (product) {
    addToCart(product);
  } else {
    openUnknownProductModal(code);
  }
}

/* ---------- سلة الفاتورة ---------- */

const cartBody = document.getElementById('cart-body');
const cartEmptyMsg = document.getElementById('cart-empty-msg');
const currentTotalEl = document.getElementById('current-total');

function addToCart(product, qty = 1) {
  const existing = cart.find(i => i.barcode === product.barcode);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ barcode: product.barcode, name: product.name, price: Number(product.price), qty });
  }
  renderCart();
}

function renderCart() {
  cartBody.innerHTML = '';
  cartEmptyMsg.classList.toggle('hidden', cart.length > 0);

  cart.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${formatMoney(item.price)}</td>
      <td><input type="number" min="1" class="qty-input" value="${item.qty}" data-idx="${idx}"></td>
      <td>${formatMoney(item.price * item.qty)}</td>
      <td><button class="row-delete-btn" data-idx="${idx}">✕</button></td>
    `;
    cartBody.appendChild(tr);
  });

  cartBody.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = Number(input.dataset.idx);
      const qty = Math.max(1, Number(input.value) || 1);
      cart[idx].qty = qty;
      renderCart();
    });
  });

  cartBody.querySelectorAll('.row-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cart.splice(Number(btn.dataset.idx), 1);
      renderCart();
    });
  });

  const total = cartTotal();
  currentTotalEl.textContent = formatMoney(total);
  document.querySelectorAll('#currency-label-1').forEach(el => el.textContent = settings.currency);
}

document.getElementById('btn-clear-sale').addEventListener('click', () => {
  if (cart.length === 0) return;
  if (confirm('إلغاء الفاتورة الحالية؟')) {
    cart = [];
    renderCart();
  }
});

document.getElementById('btn-add-manual-item').addEventListener('click', () => {
  openUnknownProductModal('', true);
});

/* ---------- منتج غير مسجل / إضافة يدوية ---------- */

const unknownModal = document.getElementById('unknown-product-modal');
const unknownBarcodeText = document.getElementById('unknown-barcode-text');
const unknownForm = document.getElementById('unknown-product-form');
let unknownBarcodeValue = '';
let manualEntryNoBarcode = false;

function openUnknownProductModal(barcode, manualNoBarcode = false) {
  manualEntryNoBarcode = manualNoBarcode;
  unknownBarcodeValue = barcode;
  unknownBarcodeText.textContent = manualNoBarcode ? '(بدون باركود)' : barcode;
  document.getElementById('up-name').value = '';
  document.getElementById('up-price').value = '';
  unknownModal.classList.remove('hidden');
  document.getElementById('up-name').focus();
}

document.getElementById('btn-cancel-unknown').addEventListener('click', () => {
  unknownModal.classList.add('hidden');
  barcodeInput.focus();
});

unknownForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('up-name').value.trim();
  const price = Number(document.getElementById('up-price').value);
  const barcode = manualEntryNoBarcode ? 'MANUAL-' + Date.now() : unknownBarcodeValue;

  const product = { barcode, name, price };
  if (!manualEntryNoBarcode) {
    try {
      await db.collection('stores').doc(currentStoreId).collection('products').add(product);
    } catch (err) {
      alert('تعذر حفظ المنتج: ' + err.message);
    }
  }
  addToCart(product);
  unknownModal.classList.add('hidden');
  barcodeInput.focus();
});

/* ---------- إنهاء البيع ---------- */

const receiptModal = document.getElementById('receipt-modal');
let lastSale = null;

document.getElementById('btn-finish-sale').addEventListener('click', async () => {
  if (cart.length === 0) {
    alert('السلة فارغة');
    return;
  }
  const saleData = {
    date: new Date().toISOString(),
    items: cart.map(i => ({ ...i })),
    total: cartTotal(),
  };

  try {
    const docRef = await db.collection('stores').doc(currentStoreId).collection('sales').add(saleData);
    lastSale = { id: docRef.id, ...saleData };

    document.getElementById('receipt-total-text').textContent = formatMoney(saleData.total) + ' ' + settings.currency;
    receiptModal.classList.remove('hidden');

    cart = [];
    renderCart();
  } catch (err) {
    alert('تعذر حفظ الفاتورة (تحقق من الإنترنت): ' + err.message);
  }
});

document.getElementById('btn-new-sale').addEventListener('click', () => {
  receiptModal.classList.add('hidden');
  barcodeInput.focus();
});

document.getElementById('btn-export-receipt').addEventListener('click', () => {
  if (lastSale) exportSalesToExcel([lastSale], `فاتورة-${lastSale.id}`);
});

/* ---------- شاشة المنتجات ---------- */

const productsBody = document.getElementById('products-body');
const productsEmptyMsg = document.getElementById('products-empty-msg');

function renderProducts(filter = '') {
  const term = filter.trim().toLowerCase();
  const list = term
    ? products.filter(p => p.name.toLowerCase().includes(term) || p.barcode.toLowerCase().includes(term))
    : products;

  productsBody.innerHTML = '';
  productsEmptyMsg.classList.toggle('hidden', products.length > 0);

  list.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.barcode)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${formatMoney(p.price)}</td>
      <td><button class="row-delete-btn" data-id="${p.id}">✕</button></td>
    `;
    productsBody.appendChild(tr);
  });

  productsBody.querySelectorAll('.row-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('حذف هذا المنتج؟')) {
        try {
          await db.collection('stores').doc(currentStoreId).collection('products').doc(btn.dataset.id).delete();
        } catch (err) {
          alert('تعذر الحذف: ' + err.message);
        }
      }
    });
  });
}

document.getElementById('product-search').addEventListener('input', e => {
  renderProducts(e.target.value);
});

document.getElementById('product-form').addEventListener('submit', async e => {
  e.preventDefault();
  const barcode = document.getElementById('pf-barcode').value.trim();
  const name = document.getElementById('pf-name').value.trim();
  const price = Number(document.getElementById('pf-price').value);

  try {
    const existing = findProductByBarcode(barcode);
    if (existing) {
      await db.collection('stores').doc(currentStoreId).collection('products').doc(existing.id).set({ barcode, name, price });
    } else {
      await db.collection('stores').doc(currentStoreId).collection('products').add({ barcode, name, price });
    }
    e.target.reset();
  } catch (err) {
    alert('تعذر حفظ المنتج: ' + err.message);
  }
});

/* ---------- استيراد / تصدير المنتجات عبر إكسل ---------- */

document.getElementById('btn-import-products').addEventListener('click', () => {
  document.getElementById('import-products-file').click();
});

document.getElementById('import-products-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async evt => {
    const data = new Uint8Array(evt.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const productsCol = db.collection('stores').doc(currentStoreId).collection('products');
    let imported = 0;

    for (const row of rows) {
      const barcode = String(findColumnValue(row, ['باركود', 'الباركود', 'barcode', 'code', 'الكود'])).trim();
      const name = String(findColumnValue(row, ['اسم', 'الاسم', 'name', 'المنتج'])).trim();
      const price = Number(findColumnValue(row, ['سعر', 'السعر', 'price']));

      if (!barcode || !name || isNaN(price)) continue;

      try {
        const existing = findProductByBarcode(barcode);
        if (existing) {
          await productsCol.doc(existing.id).set({ barcode, name, price });
        } else {
          await productsCol.add({ barcode, name, price });
        }
        imported++;
      } catch (err) {
        // تجاهل صف فاشل واستمر بالباقي
      }
    }

    alert(`تم استيراد ${imported} منتج بنجاح`);
    e.target.value = '';
  };
  reader.readAsArrayBuffer(file);
});

function findColumnValue(row, possibleKeys) {
  for (const key of Object.keys(row)) {
    if (possibleKeys.some(k => key.trim().toLowerCase() === k.toLowerCase())) {
      return row[key];
    }
  }
  return '';
}

document.getElementById('btn-export-products').addEventListener('click', () => {
  if (products.length === 0) {
    alert('لا توجد منتجات لتصديرها');
    return;
  }
  const rows = products.map(p => ({ الباركود: p.barcode, الاسم: p.name, السعر: p.price }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'المنتجات');
  XLSX.writeFile(workbook, `منتجات-${todayStr()}.xlsx`);
});

/* ---------- شاشة التقارير ---------- */

const salesBody = document.getElementById('sales-body');
const salesEmptyMsg = document.getElementById('sales-empty-msg');

function renderSales() {
  salesBody.innerHTML = '';
  salesEmptyMsg.classList.toggle('hidden', sales.length > 0);

  [...sales].reverse().forEach(sale => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sale.id}</td>
      <td>${new Date(sale.date).toLocaleString('ar-EG')}</td>
      <td>${sale.items.reduce((s, i) => s + i.qty, 0)}</td>
      <td>${formatMoney(sale.total)}</td>
    `;
    salesBody.appendChild(tr);
  });
}

document.getElementById('btn-export-today').addEventListener('click', () => {
  const today = new Date().toDateString();
  const todaySales = sales.filter(s => new Date(s.date).toDateString() === today);
  if (todaySales.length === 0) {
    alert('لا توجد مبيعات اليوم');
    return;
  }
  exportSalesToExcel(todaySales, `مبيعات-اليوم-${todayStr()}`);
});

document.getElementById('btn-export-all-sales').addEventListener('click', () => {
  if (sales.length === 0) {
    alert('لا توجد مبيعات');
    return;
  }
  exportSalesToExcel(sales, `كل-المبيعات-${todayStr()}`);
});

document.getElementById('btn-clear-sales').addEventListener('click', async () => {
  if (!confirm('حذف كل سجل الفواتير؟ لا يمكن التراجع.')) return;
  try {
    const batch = db.batch();
    const col = db.collection('stores').doc(currentStoreId).collection('sales');
    const snap = await col.get();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    alert('تعذر الحذف: ' + err.message);
  }
});

function exportSalesToExcel(salesList, filename) {
  const summaryRows = salesList.map(s => ({
    'رقم الفاتورة': s.id,
    'التاريخ والوقت': new Date(s.date).toLocaleString('ar-EG'),
    'عدد الأصناف': s.items.reduce((sum, i) => sum + i.qty, 0),
    'المجموع': s.total,
  }));

  const detailRows = [];
  salesList.forEach(s => {
    s.items.forEach(i => {
      detailRows.push({
        'رقم الفاتورة': s.id,
        'التاريخ': new Date(s.date).toLocaleString('ar-EG'),
        'الباركود': i.barcode,
        'الصنف': i.name,
        'السعر': i.price,
        'الكمية': i.qty,
        'الإجمالي': i.price * i.qty,
      });
    });
  });

  const workbook = XLSX.utils.book_new();
  if (settings.storeName) {
    const headerSheet = XLSX.utils.aoa_to_sheet([[settings.storeName], ['تقرير المبيعات'], [new Date().toLocaleString('ar-EG')]]);
    XLSX.utils.book_append_sheet(workbook, headerSheet, 'ملخص المحل');
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'ملخص الفواتير');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), 'تفاصيل الأصناف');
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

/* ---------- الإعدادات ---------- */

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const storeName = document.getElementById('st-store-name').value.trim();
  const currency = document.getElementById('st-currency').value.trim() || 'د.ع';
  try {
    await db.collection('stores').doc(currentStoreId).update({ name: storeName, currency });
    alert('تم حفظ الإعدادات');
  } catch (err) {
    alert('تعذر الحفظ: ' + err.message);
  }
});

document.getElementById('btn-reset-all').addEventListener('click', async () => {
  if (!confirm('سيتم حذف كل المنتجات والفواتير نهائيًا لهذا المحل. متأكد؟')) return;
  try {
    const batch = db.batch();
    const storeRef = db.collection('stores').doc(currentStoreId);
    const [productsSnap, salesSnap] = await Promise.all([
      storeRef.collection('products').get(),
      storeRef.collection('sales').get(),
    ]);
    productsSnap.docs.forEach(d => batch.delete(d.ref));
    salesSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    cart = [];
    renderCart();
    alert('تم مسح كل البيانات');
  } catch (err) {
    alert('تعذر الحذف: ' + err.message);
  }
});
