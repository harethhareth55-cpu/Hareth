const DB_NAME = 'cashier-pos';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cashiers')) db.createObjectStore('cashiers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('products')) {
        const store = db.createObjectStore('products', { keyPath: 'id' });
        store.createIndex('barcode', 'barcode', { unique: false });
      }
      if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('customerId', 'customerId', { unique: false });
      }
      if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('returns')) db.createObjectStore('returns', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('purchases')) db.createObjectStore('purchases', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shifts')) db.createObjectStore('shifts', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('فشلت العملية'));
  });
}

export async function loadState() {
  const db = await openDb();
  const names = ['cashiers', 'categories', 'products', 'customers', 'entries', 'sales', 'returns', 'purchases', 'shifts'];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['kv', ...names], 'readonly');
    const shopReq = tx.objectStore('kv').get('shop');
    const bags = {};
    for (const name of names) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => { bags[name] = req.result || []; };
    }
    let shop = null;
    shopReq.onsuccess = () => { shop = shopReq.result || null; };
    tx.oncomplete = () => {
      db.close();
      resolve({ shop, ...bags });
    };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveShop(shop) {
  const db = await openDb();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(shop, 'shop');
  await txDone(tx);
  db.close();
}

export async function putRecord(store, record) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(record);
  await txDone(tx);
  db.close();
}

export async function deleteRecord(store, id) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await txDone(tx);
  db.close();
}

export async function completeSale({ shop, sale, products, entry, removeHeldId }) {
  const db = await openDb();
  const tx = db.transaction(['kv', 'sales', 'products', 'entries'], 'readwrite');
  tx.objectStore('kv').put(shop, 'shop');
  if (removeHeldId) tx.objectStore('sales').delete(removeHeldId);
  tx.objectStore('sales').put(sale);
  for (const product of products) tx.objectStore('products').put(product);
  if (entry) tx.objectStore('entries').put(entry);
  await txDone(tx);
  db.close();
}

export async function completeReturn({ sale, returnDoc, products, entry }) {
  const db = await openDb();
  const stores = ['sales', 'returns', 'products', ...(entry ? ['entries'] : [])];
  const tx = db.transaction(stores, 'readwrite');
  tx.objectStore('sales').put(sale);
  tx.objectStore('returns').put(returnDoc);
  for (const product of products) tx.objectStore('products').put(product);
  if (entry) tx.objectStore('entries').put(entry);
  await txDone(tx);
  db.close();
}

export async function completePurchase({ purchase, products }) {
  const db = await openDb();
  const tx = db.transaction(['purchases', 'products'], 'readwrite');
  tx.objectStore('purchases').put(purchase);
  for (const product of products) tx.objectStore('products').put(product);
  await txDone(tx);
  db.close();
}

export async function recordDebtPayment(entry) {
  const db = await openDb();
  const tx = db.transaction('entries', 'readwrite');
  tx.objectStore('entries').put(entry);
  await txDone(tx);
  db.close();
}

export async function replaceAll(snapshot) {
  const db = await openDb();
  const names = ['cashiers', 'categories', 'products', 'customers', 'entries', 'sales', 'returns', 'purchases', 'shifts'];
  const tx = db.transaction(['kv', ...names], 'readwrite');
  tx.objectStore('kv').put(snapshot.shop, 'shop');
  for (const name of names) {
    const store = tx.objectStore(name);
    store.clear();
    for (const row of snapshot[name] || []) store.put(row);
  }
  await txDone(tx);
  db.close();
}

export async function clearAll() {
  const db = await openDb();
  const names = ['kv', 'cashiers', 'categories', 'products', 'customers', 'entries', 'sales', 'returns', 'purchases', 'shifts'];
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) tx.objectStore(name).clear();
  await txDone(tx);
  db.close();
}
