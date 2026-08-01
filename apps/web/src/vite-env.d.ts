/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  /*
   * VITE_FIREBASE_STORAGE_BUCKET and VITE_FIREBASE_MEASUREMENT_ID exist in
   * .env.local because the Firebase console emits them, but they are
   * deliberately not declared or read: Storage requires the Blaze plan and is
   * out of scope, and Analytics would add bundle weight for no current benefit.
   */
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
