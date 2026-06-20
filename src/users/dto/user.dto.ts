export type Plan = 'free' | 'starter' | 'pro' | 'agency';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  plan: Plan;
  createdAt: FirebaseFirestore.Timestamp;
  searchesUsed: number;
  razorpayCustomerId?: string;
  razorpaySubscriptionId?: string;
  subscriptionActivatedAt?: string; // ISO date string
  subscriptionExpiresAt?: string;   // ISO date string — checked by SubscriptionGuard
}

export interface CreateUserDto {
  uid: string;
  email: string;
  displayName: string;
}
