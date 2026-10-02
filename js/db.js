'use strict';

const DB_NAME = 'delivery-accountant';
const DB_VERSION = 1;

let dbPromise = null;

function wrap(err) {
  if (err && (err.name === 'QuotaExceededError')) {
    return new Error('ما قدرنا نحفظ. مساحة تخزين المتصفح ممتلية.');
  }
  if (err && /[\u0600-\u06FF]/.test(err.message || '')) return err;
  const friendly = new Error('تعذر حفظ البيانات على هذا الجهاز. تأكد إن المتصفح يسمح بالتخزين ومو بوضع التصفح الخاص.');
  friendly.cause = err;
  return friendly;
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('هذا المتصفح ما يدعم حفظ البيانات'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('drivers')) db.createObjectStore('drivers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('orders')) db.createObjectStore('orders', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settlements')) db.createObjectStore('settlements', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(wrap(req.error));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function run(storeNames, mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try {
      result = work(tx);
    } catch (err) {
      reject(wrap(err));
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(wrap(tx.error));
    tx.onabort = () => reject(wrap(tx.error));
  }));
}

export async function loadAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['kv', 'drivers', 'orders', 'settlements', 'items'], 'readonly');
    const out = { shop: null, drivers: [], orders: [], settlements: [], items: [] };
    const shopReq = tx.objectStore('kv').get('shop');
    shopReq.onsuccess = () => { out.shop = shopReq.result || null; };
    const driversReq = tx.objectStore('drivers').getAll();
    driversReq.onsuccess = () => { out.drivers = driversReq.result || []; };
    const ordersReq = tx.objectStore('orders').getAll();
    ordersReq.onsuccess = () => { out.orders = ordersReq.result || []; };
    const settlementsReq = tx.objectStore('settlements').getAll();
    settlementsReq.onsuccess = () => { out.settlements = settlementsReq.result || []; };
    const itemsReq = tx.objectStore('items').getAll();
    itemsReq.onsuccess = () => { out.items = itemsReq.result || []; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(wrap(tx.error));
  });
}

export function saveShop(shop) {
  return run(['kv'], 'readwrite', (tx) => {
    tx.objectStore('kv').put(shop, 'shop');
  });
}

export function saveNewOrder(shop, order) {
  const nextShop = { ...shop, nextOrderSeq: Math.max(shop.nextOrderSeq || 1, (order.number || 0) + 1) };
  return run(['kv', 'orders'], 'readwrite', (tx) => {
    tx.objectStore('orders').put(order);
    tx.objectStore('kv').put(nextShop, 'shop');
  }).then(() => nextShop);
}

export function saveOrder(order) {
  return run(['orders'], 'readwrite', (tx) => {
    tx.objectStore('orders').put(order);
  });
}

export function saveDriver(driver) {
  return run(['drivers'], 'readwrite', (tx) => {
    tx.objectStore('drivers').put(driver);
  });
}

export function saveItem(item) {
  return run(['items'], 'readwrite', (tx) => {
    tx.objectStore('items').put(item);
  });
}

export function deleteItem(id) {
  return run(['items'], 'readwrite', (tx) => {
    tx.objectStore('items').delete(id);
  });
}

export function commitSettlement(settlement, orders) {
  const idSet = new Set(settlement.orderIds);
  return run(['orders', 'settlements'], 'readwrite', (tx) => {
    tx.objectStore('settlements').put(settlement);
    for (const order of orders) {
      if (idSet.has(order.id)) {
        tx.objectStore('orders').put({ ...order, settlementId: settlement.id });
      }
    }
  });
}

export function voidSettlement(settlement, orders) {
  const idSet = new Set(settlement.orderIds);
  return run(['orders', 'settlements'], 'readwrite', (tx) => {
    tx.objectStore('settlements').delete(settlement.id);
    for (const order of orders) {
      if (idSet.has(order.id)) tx.objectStore('orders').put({ ...order, settlementId: null });
    }
  });
}

export function replaceAll(data) {
  return run(['kv', 'drivers', 'orders', 'settlements', 'items'], 'readwrite', (tx) => {
    tx.objectStore('kv').clear();
    tx.objectStore('drivers').clear();
    tx.objectStore('orders').clear();
    tx.objectStore('settlements').clear();
    tx.objectStore('items').clear();
    tx.objectStore('kv').put(data.shop, 'shop');
    for (const driver of data.drivers) tx.objectStore('drivers').put(driver);
    for (const order of data.orders) tx.objectStore('orders').put(order);
    for (const settlement of data.settlements) tx.objectStore('settlements').put(settlement);
    for (const item of data.items || []) tx.objectStore('items').put(item);
  });
}

export async function wipeDatabase() {
  const db = await open().catch(() => null);
  if (db) db.close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(wrap(req.error));
    req.onblocked = () => reject(new Error('أغلق أي نافذة ثانية للتطبيق ثم أعد المسح'));
  });
}
