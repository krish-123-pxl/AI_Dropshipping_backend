import { Inject, Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '../firebase/firebase.module';
import Razorpay from 'razorpay';

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);
  private razorpay: Razorpay;

  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const keyId = this.configService.get<string>('RAZORPAY_API_KEY');
    const keySecret = this.configService.get<string>('RAZORPAY_SECRET_KEY');

    if (!keyId || !keySecret) {
      this.logger.warn(
        'Razorpay credentials (RAZORPAY_API_KEY or RAZORPAY_SECRET_KEY) are missing in the environment config.',
      );
    }

    this.razorpay = new Razorpay({
      key_id: keyId || 'mock_key_id',
      key_secret: keySecret || 'mock_key_secret',
    });
  }

  /**
   * Helper to map a Razorpay plan ID back to our app's plan names ('starter', 'pro', 'agency').
   */
  private getPlanFromRazorpayPlanId(razorpayPlanId: string): string {
    const starterPlan = this.configService.get<string>('RAZORPAY_PLAN_STARTER');
    const proPlan = this.configService.get<string>('RAZORPAY_PLAN_PRO');
    const agencyPlan = this.configService.get<string>('RAZORPAY_PLAN_AGENCY');

    if (razorpayPlanId === starterPlan) return 'starter';
    if (razorpayPlanId === proPlan) return 'pro';
    if (razorpayPlanId === agencyPlan) return 'agency';

    // If it's not a known Razorpay plan ID, check if it's already one of our plan names
    if (['starter', 'pro', 'agency', 'free'].includes(razorpayPlanId)) {
      return razorpayPlanId;
    }
    return 'free';
  }

  /**
   * Creates a Razorpay Subscription and returns the hosted payment short_url.
   *
   * Production flow:
   *   1. Plans are pre-created in the Razorpay Dashboard → get real plan_XXXX IDs
   *   2. Store those IDs in RAZORPAY_PLAN_STARTER / _PRO / _AGENCY env vars
   *   3. This method creates a Subscription under that Plan and returns the short_url
   *   4. Frontend redirects user to short_url → Razorpay hosted checkout
   *   5. After payment, Razorpay calls the webhook to activate the subscription
   *   6. Razorpay also redirects the user back to callback_url with ?success=true
   */
  async createCheckoutSession(userId: string, planId: string): Promise<{ url: string }> {
    // Verify user exists in Firestore
    const userDoc = await this.firestore.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new BadRequestException(`User profile with ID ${userId} does not exist.`);
    }

    // Map planId → Razorpay Plan ID from environment config
    const PLAN_ENV_MAP: Record<string, string> = {
      starter: 'RAZORPAY_PLAN_STARTER',
      pro:     'RAZORPAY_PLAN_PRO',
      agency:  'RAZORPAY_PLAN_AGENCY',
    };

    if (!PLAN_ENV_MAP[planId]) {
      throw new BadRequestException(
        `Invalid planId "${planId}". Supported values: starter, pro, agency.`,
      );
    }

    const razorpayPlanId = this.configService.get<string>(PLAN_ENV_MAP[planId]);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const callbackUrl = `${frontendUrl}/billing?success=true`;

    // ── DEV MODE BYPASS ────────────────────────────────────────────────────────
    // Real Razorpay Plan IDs match: plan_<14+ alphanumeric chars>
    // e.g.  plan_KFHncnJbGwMsKk  ✓
    //       plan_REPLACE_WITH_PRO_ID  ✗  (contains underscores + uppercase words)
    //       plan_starter_id           ✗  (contains underscores)
    // If the ID doesn't match the real format, skip Razorpay and activate directly
    // in Firestore with a 30-day expiry. In production: set real plan IDs.
    const REAL_PLAN_ID_REGEX = /^plan_[A-Za-z0-9]{14,}$/;
    const isDevMode = !razorpayPlanId || !REAL_PLAN_ID_REGEX.test(razorpayPlanId);

    if (isDevMode) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

      this.logger.warn(
        `[DEV MODE] ${PLAN_ENV_MAP[planId]} is not a real Razorpay Plan ID. ` +
        `Directly activating plan "${planId}" for user ${userId} with 30-day expiry (${expiresAt.toISOString()}).`,
      );

      await this.firestore.collection('users').doc(userId).update({
        plan: planId,
        subscriptionActivatedAt: now.toISOString(),
        subscriptionExpiresAt:   expiresAt.toISOString(),
        razorpaySubscriptionId:  `dev_sub_${planId}_${userId.slice(0, 8)}`,
        razorpayCustomerId:      `dev_cust_${userId.slice(0, 8)}`,
      });

      this.logger.log(`[DEV MODE] User ${userId} plan set to "${planId}", expires ${expiresAt.toISOString()}`);

      // Return the billing success URL directly — frontend handles the ?success=true banner
      return { url: callbackUrl };
    }
    // ── END DEV MODE ──────────────────────────────────────────────────────────

    try {
      this.logger.log(
        `Creating Razorpay subscription for user ${userId}, plan "${planId}" (Razorpay plan: ${razorpayPlanId})`,
      );

      const subscription = await this.razorpay.subscriptions.create({
        plan_id:         razorpayPlanId,
        total_count:     120,           // 120 billing cycles ≈ 10 years
        quantity:        1,
        customer_notify: 1,             // Razorpay emails/SMS customer automatically
        notes: {
          userId,
          planId,
        },
      });

      this.logger.log(`Razorpay subscription created: ${subscription.id}`);

      if (!subscription.short_url) {
        throw new Error('Razorpay subscription response did not include a short_url');
      }

      // Append the callback_url as a query parameter — Razorpay appends it after the payment
      // so the user is redirected back to your billing page with ?success=true
      const paymentUrl = `${subscription.short_url}?callback_url=${encodeURIComponent(callbackUrl)}`;

      return { url: paymentUrl };
    } catch (error: any) {
      // Razorpay SDK wraps API errors: the real error detail is in error.error (Axios response body)
      // not in error.message (which is often just "Request failed with status 400")
      const razorpayError =
        error?.error?.description ||           // Razorpay API error description field
        error?.error?.reason ||                // Razorpay API reason field
        (typeof error?.error === 'string' ? error.error : null) ||
        error?.response?.data?.error?.description ||
        error?.message ||
        'Unknown error from Razorpay API';

      this.logger.error(
        `Razorpay subscription creation failed for user ${userId}, plan "${planId}": ${razorpayError}`,
        JSON.stringify(error?.error || error?.response?.data || {}),
      );

      throw new BadRequestException(
        `Razorpay subscription creation failed: ${razorpayError}`,
      );
    }
  }

  /**
   * Returns a Razorpay Customer Portal URL for managing subscription.
   */
  async createCustomerPortalSession(userId: string): Promise<{ url: string }> {
    const userDoc = await this.firestore.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new BadRequestException(`User profile with ID ${userId} does not exist.`);
    }

    const userData = userDoc.data();
    const subscriptionId = userData?.razorpaySubscriptionId;
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    // If customer has no active subscription or is on free plan, redirect to the billing UI
    if (!subscriptionId || userData?.plan === 'free') {
      return { url: `${frontendUrl}/dashboard/billing?error=no_active_subscription` };
    }

    // Since Razorpay has no native hosted customer portal API, return the self-service page
    // where customers can log in to manage their e-mandates or subscriptions.
    const portalUrl = `https://dashboard.razorpay.com/self-service/subscriptions?subscription_id=${subscriptionId}`;
    return { url: portalUrl };
  }

  /**
   * Verifies the signature of the incoming webhook using Razorpay SDK utility.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const webhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      this.logger.warn(
        'RAZORPAY_WEBHOOK_SECRET is not configured. Webhook signature verification skipped (assumed valid).',
      );
      return true;
    }

    try {
      return Razorpay.validateWebhookSignature(rawBody, signature, webhookSecret);
    } catch (error: any) {
      this.logger.error(`Razorpay webhook signature verification failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Handles webhook events to sync user plan and billing details in Firestore.
   */
  async handleWebhook(event: any): Promise<void> {
    const eventName = event.event || event.type;
    const payload = event.payload || event.data;

    this.logger.log(`Processing webhook event: ${eventName}`);

    // Robust extraction helper supporting both Razorpay subscription payload & Stripe format fallback
    const getNotes = () => {
      if (payload?.subscription?.entity?.notes) return payload.subscription.entity.notes;
      if (payload?.payment?.entity?.notes) return payload.payment.entity.notes;
      if (payload?.object?.metadata) return payload.object.metadata;
      if (payload?.object?.notes) return payload.object.notes;
      return null;
    };

    const notes = getNotes();
    const userId = notes?.userId || notes?.user_id || payload?.object?.client_reference_id;

    let planId = notes?.planId || notes?.plan_id;
    if (!planId) {
      const razorpayPlanId = payload?.subscription?.entity?.plan_id;
      if (razorpayPlanId) {
        planId = this.getPlanFromRazorpayPlanId(razorpayPlanId);
      }
    }

    const customerId =
      payload?.subscription?.entity?.customer_id ||
      payload?.payment?.entity?.customer_id ||
      payload?.object?.customer;

    const subscriptionId =
      payload?.subscription?.entity?.id ||
      payload?.object?.subscription;

    // 1. Subscription activation / completion events
    if (
      eventName === 'checkout.session.completed' ||
      eventName === 'subscription.activated' ||
      eventName === 'subscription.charged' ||
      eventName === 'order.paid'
    ) {
      if (!userId) {
        this.logger.warn(`No userId found in checkout/activation webhook payload.`);
        return;
      }

      const planName = planId || 'free';
      this.logger.log(
        `Upgrading user ${userId} to plan ${planName}. SubID: ${subscriptionId}, CustID: ${customerId}`,
      );

      await this.firestore
        .collection('users')
        .doc(userId)
        .update({
          plan: planName,
          razorpayCustomerId: customerId || '',
          razorpaySubscriptionId: subscriptionId || '',
        });
    }
    // 2. Subscription updated events
    else if (
      eventName === 'customer.subscription.updated' ||
      eventName === 'subscription.updated' ||
      eventName === 'subscription.resumed'
    ) {
      if (!userId) {
        this.logger.warn(`No userId found in subscription update webhook payload.`);
        return;
      }

      const planName = planId || 'free';
      this.logger.log(`Updating user ${userId} plan details to ${planName}`);

      await this.firestore
        .collection('users')
        .doc(userId)
        .update({
          plan: planName,
        });
    }
    // 3. Subscription deleted/cancelled events
    else if (
      eventName === 'customer.subscription.deleted' ||
      eventName === 'subscription.deleted' ||
      eventName === 'subscription.cancelled'
    ) {
      let targetUserId = userId;

      // Fallback: If userId is missing in webhook, lookup user by subscription ID
      if (!targetUserId && subscriptionId) {
        const usersSnapshot = await this.firestore
          .collection('users')
          .where('razorpaySubscriptionId', '==', subscriptionId)
          .limit(1)
          .get();

        if (!usersSnapshot.empty) {
          targetUserId = usersSnapshot.docs[0].id;
        }
      }

      if (!targetUserId) {
        this.logger.warn(
          `Could not identify user to downgrade. Subscription ID: ${subscriptionId}`,
        );
        return;
      }

      this.logger.log(`Downgrading user ${targetUserId} to free plan due to subscription cancellation.`);

      await this.firestore
        .collection('users')
        .doc(targetUserId)
        .update({
          plan: 'free',
        });
    } else {
      this.logger.debug(`Ignored unhandled webhook event type: ${eventName}`);
    }
  }
}
