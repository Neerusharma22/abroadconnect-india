import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleAuthProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { setInMemoryToken } from '../api';
import type { User } from '../types';

export interface JourneyChecklistItem {
  id: string;
  uid: string;
  title: string;
  category: 'Documents' | 'Language' | 'University' | 'Visa' | 'Housing' | 'Finance';
  countrySlug: string;
  status: 'todo' | 'in_progress' | 'done' | 'archived';
  notes: string;
}

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  firebaseAuthReady: boolean;
  firebaseIdToken: string | null;
  checklistItems: JourneyChecklistItem[];
  signInWithGoogle: () => Promise<{ token: string; user: User; idToken: string }>;
  signOutFirebase: () => Promise<void>;
  refreshIdToken: () => Promise<string | null>;
  addChecklistItem: (input: {
    title: string;
    category: JourneyChecklistItem['category'];
    countrySlug: string;
    notes: string;
  }) => Promise<void>;
  updateChecklistStatus: (itemId: string, status: JourneyChecklistItem['status']) => Promise<void>;
  deleteChecklistItem: (itemId: string) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [firebaseIdToken, setFirebaseIdToken] = useState<string | null>(null);
  const [checklistItems, setChecklistItems] = useState<JourneyChecklistItem[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        try {
          const token = await fbUser.getIdToken();
          setFirebaseIdToken(token);
        } catch {
          setFirebaseIdToken(null);
        }
      } else {
        setFirebaseIdToken(null);
        setChecklistItems([]);
      }
      setFirebaseAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!firebaseAuthReady || !firebaseUser || !firebaseUser.emailVerified) {
      return;
    }

    const path = `users/${firebaseUser.uid}/journeyItems`;
    const q = query(
      collection(db, path),
      where('uid', '==', firebaseUser.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: JourneyChecklistItem[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            uid: String(d.uid || ''),
            title: String(d.title || ''),
            category: (d.category as JourneyChecklistItem['category']) || 'Documents',
            countrySlug: String(d.countrySlug || 'germany'),
            status: (d.status as JourneyChecklistItem['status']) || 'todo',
            notes: String(d.notes || ''),
          };
        });
        setChecklistItems(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, [firebaseAuthReady, firebaseUser]);

  const refreshIdToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken(true);
    setFirebaseIdToken(token);
    return token;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const credential = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await credential.user.getIdToken();
    setFirebaseIdToken(idToken);

    const syncRes = await fetch('/api/v1/auth/firebase-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AbroadConnect',
        Authorization: `Bearer ${idToken}`,
      },
      credentials: 'include',
    });

    const syncData = await syncRes.json().catch(() => ({}));
    if (!syncRes.ok || !syncData.user) {
      throw new Error(typeof syncData.error === 'string' ? syncData.error : 'Unable to complete Google Sign-In.');
    }

    setInMemoryToken(syncData.token);

    if (credential.user.emailVerified) {
      const uid = credential.user.uid;
      const publicPath = `users/${uid}/public/card`;
      const privatePath = `users/${uid}/private/info`;

      try {
        const existingPublic = await getDoc(doc(db, publicPath));
        const displayName = (credential.user.displayName || syncData.user.display_name || 'Member').slice(0, 80);
        if (!existingPublic.exists()) {
          await setDoc(doc(db, publicPath), {
            uid,
            displayName,
            targetCountry: 'germany',
            purpose: 'Study',
            intake: 'Winter 2027',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(doc(db, publicPath), {
            displayName,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, publicPath);
      }

      try {
        const existingPrivate = await getDoc(doc(db, privatePath));
        const email = (credential.user.email || '').slice(0, 160);
        if (!existingPrivate.exists()) {
          await setDoc(doc(db, privatePath), {
            uid,
            email,
            preferredLanguage: 'en',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(doc(db, privatePath), {
            email,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, privatePath);
      }
    }

    return {
      token: syncData.token as string,
      user: syncData.user as User,
      idToken,
    };
  }, []);

  const signOutFirebase = useCallback(async () => {
    await signOut(auth).catch(() => {});
    setFirebaseIdToken(null);
    setChecklistItems([]);
  }, []);

  const addChecklistItem = useCallback(
    async (input: {
      title: string;
      category: JourneyChecklistItem['category'];
      countrySlug: string;
      notes: string;
    }) => {
      if (!auth.currentUser) {
        throw new Error('Please sign in with Google to save cloud checklist items.');
      }
      const uid = auth.currentUser.uid;
      const path = `users/${uid}/journeyItems`;
      const sanitizedCountry = input.countrySlug
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 64) || 'germany';

      try {
        await addDoc(collection(db, path), {
          uid,
          title: input.title.trim().slice(0, 140),
          category: input.category,
          countrySlug: sanitizedCountry,
          status: 'todo',
          notes: input.notes.trim().slice(0, 600),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    []
  );

  const updateChecklistStatus = useCallback(
    async (itemId: string, status: JourneyChecklistItem['status']) => {
      if (!auth.currentUser) {
        throw new Error('Sign in with Google first.');
      }
      const path = `users/${auth.currentUser.uid}/journeyItems/${itemId}`;
      try {
        await updateDoc(doc(db, path), {
          status,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    []
  );

  const deleteChecklistItem = useCallback(async (itemId: string) => {
    if (!auth.currentUser) {
      throw new Error('Sign in with Google first.');
    }
    const path = `users/${auth.currentUser.uid}/journeyItems/${itemId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }, []);

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        firebaseAuthReady,
        firebaseIdToken,
        checklistItems,
        signInWithGoogle,
        signOutFirebase,
        refreshIdToken,
        addChecklistItem,
        updateChecklistStatus,
        deleteChecklistItem,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
