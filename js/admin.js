'use strict';

/* عدّل هذا البريد إذا تغيّر بريد الإدارة (ولازم تعدّل نفس القيمة بملف firestore.rules) */
const ADMIN_EMAIL = 'harethhareth55@gmail.com';

const PLAN_DAYS = { monthly: 30, yearly: 365 };
const PLAN_LABELS = { monthly: 'شهري', yearly: 'سنوي' };
const METHOD_LABELS = { zaincash: 'ZainCash', rafidain: 'ماستر كارد الرافدين', fib: 'FIB' };

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

const authError = document.getElementById('admin-auth-error');
const authLoading = document.getElementById('admin-auth-loading');

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

document.getElementById('admin-login-form').addEventListener('submit', async e => {
  e.preventDefault();
  authError.classList.add('hidden');
  authLoading.classList.remove('hidden');
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;

  try {
    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      // Firebase الحديث يرجّع auth/invalid-credential لعدم وجود الحساب أو لكلمة مرور خاطئة معًا
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        await auth.createUserWithEmailAndPassword(email, password);
      } else {
        throw err;
      }
    }
  } catch (err) {
    showAuthError('خطأ: ' + err.message);
  } finally {
    authLoading.classList.add('hidden');
  }
});

document.getElementById('admin-logout').addEventListener('click', () => auth.signOut());

let unsubRequests = null;
let unsubStores = null;
let storesCache = {};
let pendingRequests = [];

auth.onAuthStateChanged(user => {
  if (user && user.email === ADMIN_EMAIL) {
    document.getElementById('admin-auth').classList.add('hidden');
    document.getElementById('admin-shell').classList.remove('hidden');
    loadData();
  } else {
    if (user) {
      showAuthError('هذا الحساب ما عنده صلاحية دخول لوحة الإدارة');
      auth.signOut();
    }
    document.getElementById('admin-shell').classList.add('hidden');
    document.getElementById('admin-auth').classList.remove('hidden');
    if (unsubRequests) unsubRequests();
    if (unsubStores) unsubStores();
    unsubRequests = unsubStores = null;
    storesCache = {};
    pendingRequests = [];
  }
});

function loadData() {
  unsubStores = db.collection('stores').onSnapshot(snap => {
    storesCache = {};
    snap.docs.forEach(d => { storesCache[d.id] = { id: d.id, ...d.data() }; });
    renderStores();
    renderRequests();
  }, err => alert('خطأ بتحميل المحلات: ' + err.message));

  unsubRequests = db.collection('subscriptionRequests')
    .where('status', '==', 'pending')
    .onSnapshot(snap => {
      pendingRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderRequests();
    }, err => alert('خطأ بتحميل الطلبات: ' + err.message));
}

function renderRequests() {
  const body = document.getElementById('admin-requests-body');
  body.innerHTML = '';
  document.getElementById('admin-requests-empty').classList.toggle('hidden', pendingRequests.length > 0);

  pendingRequests.forEach(r => {
    const store = storesCache[r.storeId];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${store ? escapeHtml(store.name) : r.storeId}</td>
      <td>${PLAN_LABELS[r.plan] || r.plan}</td>
      <td>${Number(r.amount || 0).toLocaleString('en-US')}</td>
      <td>${METHOD_LABELS[r.method] || r.method}</td>
      <td>${escapeHtml(r.reference)}</td>
      <td>${escapeHtml(r.note || '')}</td>
      <td>${new Date(r.submittedAt).toLocaleString('ar-EG')}</td>
      <td>
        <button class="btn primary small" data-approve="${r.id}">قبول</button>
        <button class="btn danger small" data-reject="${r.id}">رفض</button>
      </td>`;
    body.appendChild(tr);
  });

  body.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveRequest(btn.dataset.approve));
  });
  body.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', () => rejectRequest(btn.dataset.reject));
  });
}

async function approveRequest(reqId) {
  const req = pendingRequests.find(r => r.id === reqId);
  if (!req) return;
  if (!confirm('تأكيد استلام الدفع وتفعيل الاشتراك؟')) return;

  const days = PLAN_DAYS[req.plan] || 30;
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  try {
    await db.collection('stores').doc(req.storeId).update({
      subscription: { status: 'active', plan: req.plan, trialEndsAt: null, expiresAt },
    });
    await db.collection('subscriptionRequests').doc(reqId).update({ status: 'approved' });
  } catch (err) {
    alert('خطأ: ' + err.message);
  }
}

async function rejectRequest(reqId) {
  if (!confirm('رفض هذا الطلب؟')) return;
  try {
    await db.collection('subscriptionRequests').doc(reqId).update({ status: 'rejected' });
  } catch (err) {
    alert('خطأ: ' + err.message);
  }
}

function renderStores() {
  const body = document.getElementById('admin-stores-body');
  body.innerHTML = '';
  const statusLabels = { trial: 'تجربة مجانية', active: 'مفعّل', expired: 'منتهي' };

  Object.values(storesCache)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .forEach(s => {
      const sub = s.subscription || {};
      const untilDate = sub.status === 'active' ? sub.expiresAt : sub.trialEndsAt;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(s.name)}</td>
        <td>${statusLabels[sub.status] || '—'}</td>
        <td>${PLAN_LABELS[sub.plan] || '—'}</td>
        <td>${untilDate ? new Date(untilDate).toLocaleDateString('ar-EG') : '—'}</td>
      `;
      body.appendChild(tr);
    });
}
