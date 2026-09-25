import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Verifies tokens from the SAME Firebase project the frontend (VOC repo,
// src/firebase.js) already signs users into. We keep Firebase Auth as-is —
// only the data layer (RTDB) is being replaced by this API + Postgres.
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export const firebaseAuth = getAuth();
