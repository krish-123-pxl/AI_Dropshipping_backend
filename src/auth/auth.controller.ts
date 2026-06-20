import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Auth } from 'firebase-admin/auth';
import { FIREBASE_AUTH } from '../firebase/firebase.module';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { UserProfile } from '../users/dto/user.dto';

@Controller('auth')
export class AuthController {
  // Auth is a concrete class → safe with isolatedModules + emitDecoratorMetadata
  constructor(
    @Inject(FIREBASE_AUTH) private readonly auth: Auth,
    private readonly usersService: UsersService,
  ) {}

  /**
   * POST /auth/login
   *
   * Accepts a Firebase ID token, verifies it with Firebase Admin SDK,
   * creates the user in Firestore if they don't exist yet, and returns
   * the full user profile.
   *
   * Body:     { idToken: string }
   * Response: UserProfile
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() { idToken }: LoginDto): Promise<UserProfile> {
    let decodedToken: Awaited<ReturnType<Auth['verifyIdToken']>>;

    try {
      decodedToken = await this.auth.verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase ID token');
    }

    const { uid, email = '', name = '' } = decodedToken;

    return this.usersService.findOrCreate({
      uid,
      email,
      displayName: name,
    });
  }
}
