import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  Req,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '../firebase/firebase.module';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';

@Controller('reports')
@UseGuards(FirebaseAuthGuard)
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
  ) {}

  /**
   * GET /reports
   *
   * Fetches saved product reports for the authenticated user.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getReports(@Req() req: any) {
    const userId = req.user.uid;
    this.logger.log(`GET /reports – userId: "${userId}"`);

    try {
      const snapshot = await this.firestore
        .collection('product_reports')
        .where('userId', '==', userId)
        .orderBy('generatedAt', 'desc')
        .get();

      const reports: any[] = [];
      snapshot.forEach((doc) => {
        reports.push({
          reportId: doc.id,
          ...doc.data(),
        });
      });

      return reports;
    } catch (err) {
      this.logger.warn(`Failed to fetch reports with orderBy, falling back to in-memory sort: ${err.message}`);
      // Fallback: get without ordering, then sort in memory to avoid index requirements
      try {
        const snapshot = await this.firestore
          .collection('product_reports')
          .where('userId', '==', userId)
          .get();

        const reports: any[] = [];
        snapshot.forEach((doc) => {
          reports.push({
            reportId: doc.id,
            ...doc.data(),
          });
        });

        reports.sort((a: any, b: any) => {
          const dateA = new Date(a.generatedAt || 0).getTime();
          const dateB = new Date(b.generatedAt || 0).getTime();
          return dateB - dateA;
        });

        return reports;
      } catch (fallbackErr) {
        this.logger.error(`Fallback fetch reports also failed`, fallbackErr);
        throw fallbackErr;
      }
    }
  }

  /**
   * DELETE /reports/:id
   *
   * Deletes a specific product report.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReport(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.uid;
    this.logger.log(`DELETE /reports/${id} – userId: "${userId}"`);

    const docRef = this.firestore.collection('product_reports').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Report not found');
    }

    if (doc.data()?.userId !== userId) {
      throw new NotFoundException('Report not found for this user');
    }

    await docRef.delete();
  }

  /**
   * GET /reports/saved-products
   *
   * Fetches saved products for the authenticated user.
   */
  @Get('saved-products')
  @HttpCode(HttpStatus.OK)
  async getSavedProducts(@Req() req: any) {
    const userId = req.user.uid;
    this.logger.log(`GET /reports/saved-products – userId: "${userId}"`);

    try {
      const snapshot = await this.firestore
        .collection('saved_products')
        .where('userId', '==', userId)
        .get();

      const products: any[] = [];
      snapshot.forEach((doc) => {
        products.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return products;
    } catch (err) {
      this.logger.error('Failed to fetch saved products', err);
      throw err;
    }
  }

  /**
   * POST /reports/save-product
   *
   * Saves or toggles saving a specific product.
   */
  @Post('save-product')
  @HttpCode(HttpStatus.OK)
  async saveProduct(
    @Body() body: { product: any },
    @Req() req: any,
  ) {
    const userId = req.user.uid;
    const { product } = body;
    this.logger.log(`POST /reports/save-product – userId: "${userId}", product: "${product?.name}"`);

    // Check if it's already saved to prevent duplicates
    const snapshot = await this.firestore
      .collection('saved_products')
      .where('userId', '==', userId)
      .where('product.name', '==', product.name)
      .get();

    if (!snapshot.empty) {
      // Already saved, let's delete (toggle behavior) or just return success
      const docId = snapshot.docs[0].id;
      await this.firestore.collection('saved_products').doc(docId).delete();
      return { saved: false, message: 'Product removed from saved list' };
    }

    // Add to saved products
    const docRef = await this.firestore.collection('saved_products').add({
      userId,
      product,
      savedAt: new Date().toISOString(),
    });

    return { saved: true, id: docRef.id, message: 'Product saved successfully' };
  }
}
