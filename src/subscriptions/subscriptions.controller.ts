import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Req,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '../firebase/firebase.module';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
  ) {}

  /**
   * GET /subscriptions/me
   * Returns: UserProfile subscription status and usage count from Firestore
   */
  @Get('me')
  @UseGuards(FirebaseAuthGuard)
  async getSubscriptionStatus(@Req() req: any) {
    const userDoc = await this.firestore.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User profile not found');
    }
    const data = userDoc.data();
    return {
      uid: req.user.uid,
      email: data?.email || '',
      displayName: data?.displayName || '',
      plan: data?.plan || 'free',
      searchesUsed: data?.searchesUsed || 0,
      razorpayCustomerId:      data?.razorpayCustomerId || '',
      razorpaySubscriptionId:  data?.razorpaySubscriptionId || '',
      subscriptionActivatedAt: data?.subscriptionActivatedAt || null,
      subscriptionExpiresAt:   data?.subscriptionExpiresAt || null,
    };
  }

  /**
   * POST /subscriptions/checkout
   * Expects { planId: string } in body
   * Returns: { url: string } containing Razorpay subscription checkout URL
   */
  @Post('checkout')
  @UseGuards(FirebaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async checkout(
    @Req() req: any,
    @Body('planId') planId: string,
  ) {
    if (!planId) {
      throw new BadRequestException('planId is required');
    }
    return this.subscriptionsService.createCheckoutSession(req.user.uid, planId);
  }

  /**
   * POST /subscriptions/portal
   * Returns: { url: string } containing Razorpay Customer Portal / Self-Service URL
   */
  @Post('portal')
  @UseGuards(FirebaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async portal(@Req() req: any) {
    return this.subscriptionsService.createCustomerPortalSession(req.user.uid);
  }

  /**
   * POST /subscriptions/webhook
   * Raw body endpoint for Razorpay / Stripe webhook processing
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    this.logger.log('Webhook endpoint called.');
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Webhook payload is missing the raw body.');
      throw new BadRequestException('Missing raw body');
    }

    const bodyString = rawBody.toString('utf8');

    // Verify signature if the signature header is present
    if (signature) {
      const isValid = this.subscriptionsService.verifyWebhookSignature(bodyString, signature);
      if (!isValid) {
        this.logger.error('Webhook signature validation failed.');
        throw new BadRequestException('Invalid webhook signature');
      }
    } else {
      this.logger.warn('Webhook request received without x-razorpay-signature header.');
    }

    // Parse the webhook payload
    let event: any;
    try {
      event = JSON.parse(bodyString);
    } catch (err: any) {
      this.logger.error(`Failed to parse raw body JSON: ${err.message}`);
      throw new BadRequestException(`Invalid JSON payload: ${err.message}`);
    }

    // Process the event
    await this.subscriptionsService.handleWebhook(event);

    return { status: 'success' };
  }
}
