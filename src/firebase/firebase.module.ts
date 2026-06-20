import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import {
  initializeApp,
  getApps,
  getApp,
  cert,
} from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import * as path from 'path';

// ── Injection tokens ──────────────────────────────────────────────────────────
/** Inject the Firebase Auth service */
export const FIREBASE_AUTH = 'FIREBASE_AUTH';

/** Inject the Firestore database service */
export const FIREBASE_FIRESTORE = 'FIREBASE_FIRESTORE';

// ── Providers ─────────────────────────────────────────────────────────────────
const firebaseAppProvider = {
  provide: 'FIREBASE_APP_INIT',
  useFactory: () => {
    if (getApps().length > 0) {
      return getApp();
    }
    const serviceAccountPath = path.resolve(
      process.cwd(),
      'firebase-service-account.json',
    );
    // Explicitly pass projectId from service account to ensure it doesn't try
    // to guess it from the environment incorrectly.
    const serviceAccount = require(serviceAccountPath);
    
    return initializeApp({
      credential: cert(serviceAccountPath),
      projectId: serviceAccount.project_id,
    });
  },
};

/**
 * Auth provider — depends on the app being initialised first.
 */
const firebaseAuthProvider = {
  provide: FIREBASE_AUTH,
  useFactory: (): Auth => getAuth(getApp()),
  inject: ['FIREBASE_APP_INIT'],
};

/**
 * Firestore provider — same note: Firestore is a concrete class.
 */
const firebaseFirestoreProvider = {
  provide: FIREBASE_FIRESTORE,
  // The user explicitly named the database "default" (without parentheses)
  useFactory: (): Firestore => getFirestore(getApp(), 'default'),
  inject: ['FIREBASE_APP_INIT'],
};

@Global()
@Module({
  providers: [
    firebaseAppProvider,
    firebaseAuthProvider,
    firebaseFirestoreProvider,
  ],
  exports: [FIREBASE_AUTH, FIREBASE_FIRESTORE],
})
export class FirebaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(getApps().map((app) => (app as any).delete()));
  }
}
