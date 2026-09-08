'use strict';

/* ---------- تخزين البيانات (localStorage) ---------- */

const STORAGE_KEYS = {
  products: 'pos_products',
  sales: 'pos_sales',
  settings: 'pos_settings',
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let products = loadJSON(STORAGE_KEYS.products, []); // {barcode, name, price}
let sales = loadJSON(STORAGE_KEYS.sales, []); // {id, date, items, total}
let settings = loadJSON(STORAGE_KEYS.settings, { storeName: '', currency: 'د.ع' });

let cart = []; // {barcode, name, price, qty}

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

function nextInvoiceId() {
  return 'INV-' + Date.now();
}

/* ---------- التنقل بين الشاشات ---------- */

const views = document.querySelectorAll('.view');
const navButtons = document.querySelectorAll('.nav-btn');

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    navButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    views.forEach(v => v.classList.add('hidden'));
    document.getElementById(btn.dataset.view).classList.remove('hidden');
    if (btn.dataset.view === 'view-products') renderProducts();
    if (btn.dataset.view === 'view-reports') renderSales();
    if (btn.dataset.view === 'view-sale') document.getElementById('barcode-input').focus();
  });
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

unknownForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('up-name').value.trim();
  const price = Number(document.getElementById('up-price').value);
  const barcode = manualEntryNoBarcode ? 'MANUAL-' + Date.now() : unknownBarcodeValue;

  const product = { barcode, name, price };
  if (!manualEntryNoBarcode) {
    products.push(product);
    saveJSON(STORAGE_KEYS.products, products);
  }
  addToCart(product);
  unknownModal.classList.add('hidden');
  barcodeInput.focus();
});

/* ---------- إنهاء البيع ---------- */

const receiptModal = document.getElementById('receipt-modal');
let lastSale = null;

document.getElementById('btn-finish-sale').addEventListener('click', () => {
  if (cart.length === 0) {
    alert('السلة فارغة');
    return;
  }
  const sale = {
    id: nextInvoiceId(),
    date: new Date().toISOString(),
    items: cart.map(i => ({ ...i })),
    total: cartTotal(),
  };
  sales.push(sale);
  saveJSON(STORAGE_KEYS.sales, sales);
  lastSale = sale;

  document.getElementById('receipt-total-text').textContent = formatMoney(sale.total) + ' ' + settings.currency;
  receiptModal.classList.remove('hidden');

  cart = [];
  renderCart();
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

  list.forEach((p) => {
    const realIdx = products.indexOf(p);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.barcode)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${formatMoney(p.price)}</td>
      <td><button class="row-delete-btn" data-idx="${realIdx}">✕</button></td>
    `;
    productsBody.appendChild(tr);
  });

  productsBody.querySelectorAll('.row-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('حذف هذا المنتج؟')) {
        products.splice(Number(btn.dataset.idx), 1);
        saveJSON(STORAGE_KEYS.products, products);
        renderProducts(document.getElementById('product-search').value);
      }
    });
  });
}

document.getElementById('product-search').addEventListener('input', e => {
  renderProducts(e.target.value);
});

document.getElementById('product-form').addEventListener('submit', e => {
  e.preventDefault();
  const barcode = document.getElementById('pf-barcode').value.trim();
  const name = document.getElementById('pf-name').value.trim();
  const price = Number(document.getElementById('pf-price').value);

  const existing = findProductByBarcode(barcode);
  if (existing) {
    existing.name = name;
    existing.price = price;
  } else {
    products.push({ barcode, name, price });
  }
  saveJSON(STORAGE_KEYS.products, products);
  e.target.reset();
  renderProducts();
});

/* ---------- استيراد / تصدير المنتجات عبر إكسل ---------- */

document.getElementById('btn-import-products').addEventListener('click', () => {
  document.getElementById('import-products-file').click();
});

document.getElementById('import-products-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = evt => {
    const data = new Uint8Array(evt.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    let imported = 0;
    rows.forEach(row => {
      const barcode = String(findColumnValue(row, ['باركود', 'الباركود', 'barcode', 'code', 'الكود'])).trim();
      const name = String(findColumnValue(row, ['اسم', 'الاسم', 'name', 'المنتج'])).trim();
      const price = Number(findColumnValue(row, ['سعر', 'السعر', 'price']));

      if (!barcode || !name || isNaN(price)) return;

      const existing = findProductByBarcode(barcode);
      if (existing) {
        existing.name = name;
        existing.price = price;
      } else {
        products.push({ barcode, name, price });
      }
      imported++;
    });

    saveJSON(STORAGE_KEYS.products, products);
    renderProducts();
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

document.getElementById('btn-clear-sales').addEventListener('click', () => {
  if (confirm('حذف كل سجل الفواتير؟ لا يمكن التراجع.')) {
    sales = [];
    saveJSON(STORAGE_KEYS.sales, sales);
    renderSales();
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

document.getElementById('st-store-name').value = settings.storeName;
document.getElementById('st-currency').value = settings.currency;

document.getElementById('settings-form').addEventListener('submit', e => {
  e.preventDefault();
  settings.storeName = document.getElementById('st-store-name').value.trim();
  settings.currency = document.getElementById('st-currency').value.trim() || 'د.ع';
  saveJSON(STORAGE_KEYS.settings, settings);
  renderCart();
  alert('تم حفظ الإعدادات');
});

document.getElementById('btn-reset-all').addEventListener('click', () => {
  if (confirm('سيتم حذف كل المنتجات والفواتير نهائيًا. متأكد؟')) {
    products = [];
    sales = [];
    cart = [];
    saveJSON(STORAGE_KEYS.products, products);
    saveJSON(STORAGE_KEYS.sales, sales);
    renderProducts();
    renderSales();
    renderCart();
    alert('تم مسح كل البيانات');
  }
});

/* ---------- أدوات عامة ---------- */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- بدء التشغيل ---------- */

renderCart();
renderProducts();
renderSales();
document.getElementById('currency-label-1').textContent = settings.currency;
barcodeInput.focus();
