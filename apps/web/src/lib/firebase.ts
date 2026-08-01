import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/*
 * Missing config must never take the whole app down. Requirements §4 allows the
 * entire pipeline — upload through STL export — to run anonymously, so a
 * deployment without Firebase credentials should still be a working editor with
 * sign-in unavailable, not a blank page.
 *
 * This previously threw at module scope, which ran before React mounted and
 * blanked production, because .env.local is gitignored and the deploy
 * environment had no variables set.
 *
 * These values are not secrets — Firebase web config ships in every client
 * bundle by design, and access is controlled by firestore.rules plus the
 * authorized-domains list.
 */
function readConfig(): FirebaseOptions | null {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error(
      `Firebase is not configured — sign-in and saving are disabled. Missing: ${missing.join(', ')}. ` +
        `Set these as build environment variables in the Cloudflare project (they are ` +
        `read at build time by Vite, and apps/web/.env.local is gitignored so it never ` +
        `reaches the deploy).`,
    );
    return null;
  }

  return config as FirebaseOptions;
}

const config = readConfig();
const app = config ? initializeApp(config) : null;

/** False when the deployment has no Firebase credentials; auth/db are null. */
export const isFirebaseConfigured = app !== null;

export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Firestore | null = app ? getFirestore(app) : null;
export const googleProvider = app ? new GoogleAuthProvider() : null;
