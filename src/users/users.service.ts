import { Inject, Injectable, Logger } from '@nestjs/common';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '../firebase/firebase.module';
import { CreateUserDto, UserProfile } from './dto/user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly COLLECTION = 'users';

  // Firestore is a concrete class → safe with isolatedModules + emitDecoratorMetadata
  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
  ) {}

  /**
   * Returns the user document if it already exists, otherwise creates a new
   * one with default "free" plan fields and returns it.
   */
  async findOrCreate(dto: CreateUserDto): Promise<UserProfile> {
    try {
      const docRef = this.firestore.collection(this.COLLECTION).doc(dto.uid);
      const snapshot = await docRef.get();

      if (snapshot.exists) {
        this.logger.debug(`Returning existing user: ${dto.uid}`);
        return snapshot.data() as UserProfile;
      }

      const newUser = {
        uid: dto.uid,
        email: dto.email,
        displayName: dto.displayName,
        plan: 'free' as const,
        createdAt: FieldValue.serverTimestamp(),
        searchesUsed: 0,
      };

      await docRef.set(newUser);
      this.logger.log(`Created new user: ${dto.uid}`);

      const created = await docRef.get();
      return created.data() as UserProfile;
    } catch (error: any) {
      if (error.code === 5 || error.message?.includes('NOT_FOUND')) {
        this.logger.error(
          `\n\n🚨 FIRESTORE DATABASE NOT FOUND (Error 5) 🚨\n` +
          `The Firebase Admin SDK cannot find your Firestore database.\n` +
          `1. Ensure you actually clicked "Create Database" in the Firebase Console.\n` +
          `2. Ensure it was created in "Native Mode" (not Datastore mode).\n` +
          `3. If you just created it, it can take 5-10 minutes for Google Cloud to propagate the gRPC endpoints.\n` +
          `4. Verify that the project ID in your firebase-service-account.json matches the one in the console.\n\n`
        );
      }
      throw error;
    }
  }

  /** Fetch a user by UID. Returns null if not found. */
  async findByUid(uid: string): Promise<UserProfile | null> {
    const snapshot = await this.firestore
      .collection(this.COLLECTION)
      .doc(uid)
      .get();
    return snapshot.exists ? (snapshot.data() as UserProfile) : null;
  }
}
