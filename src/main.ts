import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable global DTO validation via class-validator decorators
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Strip unknown properties
      forbidNonWhitelisted: true,
      transform: true,       // Auto-transform payloads to DTO instances
    }),
  );

  // Allow the React frontend to call the API during development
  app.enableCors();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
