import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  /** True until the first onAuthStateChanged callback resolves. */
  loading: boolean;
  /** Set when the last sign-in/sign-out attempt failed; cleared on retry. */
  error: string | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Creates users/{uid} on first sight of an account (data model in
 * requirements §6). Reads before writing so a returning user costs one
 * Firestore read per page load rather than a write — the Spark plan's daily
 * write quota is the scarcer of the two.
 *
 * `refreshProfile` is set only after an explicit sign-in, where the Google
 * profile may legitimately have changed since last time.
 */
async function ensureUserDoc(user: User, refreshProfile: boolean): Promise<void> {
  const ref = doc(db, 'users', user.uid);
  const profile = {
    displayName: user.displayName ?? '',
    email: user.email ?? '',
    photoURL: user.photoURL ?? '',
  };

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
  } else if (refreshProfile) {
    await setDoc(ref, profile, { merge: true });
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);

      if (nextUser) {
        // Never block rendering on the bootstrap write; a failure here means
        // the profile doc lags, not that the session is invalid.
        void ensureUserDoc(nextUser, false).catch((cause) => {
          console.error('Failed to bootstrap users/{uid} document', cause);
        });
      }
    });
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      await ensureUserDoc(credential.user, true);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      // Closing the popup is a normal user action, not an error worth showing.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      setError(
        code === 'auth/unauthorized-domain'
          ? 'This domain is not in the Firebase authorized-domains list (see docs/manual-setup.md §4).'
          : 'Sign-in failed. Please try again.',
      );
      console.error('Google sign-in failed', cause);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (cause) {
      setError('Sign-out failed. Please try again.');
      console.error('Sign-out failed', cause);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, signIn, signOutUser }),
    [user, loading, error, signIn, signOutUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return context;
}
