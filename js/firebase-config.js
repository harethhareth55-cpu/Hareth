'use strict';

/*
  عدّل القيم بالأسفل بمعلومات مشروع Firebase الخاص فيك.
  خطوات الحصول عليها موجودة بملف README.md بقسم "إعداد Firebase".
*/
const firebaseConfig = {
  apiKey: 'AIzaSyCGpcqEIcR_BUtNP1vo9kcUgaZmDC6xKiU',
  authDomain: 'kasher-d6733.firebaseapp.com',
  projectId: 'kasher-d6733',
  storageBucket: 'kasher-d6733.firebasestorage.app',
  messagingSenderId: '720865334062',
  appId: '1:720865334062:web:8e3af0d7d5c42d4e1460bf',
  measurementId: 'G-0WV3WVVM74',
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
