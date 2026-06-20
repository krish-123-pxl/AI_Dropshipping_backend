import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Auth } from 'firebase-admin/auth';
import { Request } from 'express';
import { FIREBASE_AUTH } from '../../firebase/firebase.module';

/** Shape of the decoded Firebase token attached to every authenticated request */
export interface AuthenticatedRequest extends Request {
  user: {
    uid: string;
    email: string;
    name?: string;
  };
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  // Auth is a concrete class → safe with isolatedModules + emitDecoratorMetadata
  constructor(@Inject(FIREBASE_AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      const decodedToken = await this.auth.verifyIdToken(token);

      request.user = {
        uid: decodedToken.uid,
        email: decodedToken.email ?? '',
        name: decodedToken.name as string | undefined,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase ID token');
    }
  }

  private extractBearerToken(request: Request): string | null {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.slice(7);
  }
}
