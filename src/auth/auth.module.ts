import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [FirebaseAuthGuard],
  exports: [FirebaseAuthGuard], // Export so other modules can use @UseGuards(FirebaseAuthGuard)
})
export class AuthModule {}
