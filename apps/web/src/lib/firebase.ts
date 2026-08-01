import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

function requireEnv(key: keyof ImportMetaEnv, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${key}. Firebase config lives in apps/web/.env.local (gitignored) — ` +
        `see docs/manual-setup.md §3.`,
    );
  }
  return value;
}

/*
 * No storageBucket: Firebase Storage requires the Blaze plan and is never used
 * here. Project SVGs and thumbnails are stored inline on the Firestore document
 * instead (see docs/requirements.md §6).
 */
const app = initializeApp({
  apiKey: requireEnv('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: requireEnv('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  messagingSenderId: requireEnv(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: requireEnv('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
