import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '../../firebase/firebase.module';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.uid;

    if (!userId) {
      throw new ForbiddenException('User is not authenticated. Please log in.');
    }

    // Retrieve the user profile from Firestore
    const userDoc = await this.firestore.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new ForbiddenException('User profile not found in database.');
    }

    const userData = userDoc.data();
    let plan = userData?.plan || 'free';
    const searchesUsed = userData?.searchesUsed || 0;

    // Check if a dev-mode (or any) subscription has expired.
    // subscriptionExpiresAt is set for dev activations (and can also be set for production
    // subscriptions if you choose to track it). If it has passed, revert to free.
    const expiresAt = userData?.subscriptionExpiresAt;
    if (expiresAt && plan !== 'free') {
      const expiryDate = new Date(expiresAt);
      if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
        // Subscription has expired — downgrade in Firestore and enforce free limits
        await this.firestore.collection('users').doc(userId).update({ plan: 'free' });
        plan = 'free';
      }
    }

    // Define the search limits per plan
    const LIMITS: Record<string, number> = {
      free: 10,
      starter: 20,
      pro: 100,
      agency: Infinity, // Unlimited
    };

    const limit = LIMITS[plan] !== undefined ? LIMITS[plan] : LIMITS.free;

    if (searchesUsed >= limit) {
      throw new ForbiddenException(
        `Monthly usage limit exceeded. Your current plan (${plan}) allows up to ${limit} searches, and you have used ${searchesUsed}. Please upgrade your subscription to continue using this feature.`,
      );
    }

    return true;
  }
}
