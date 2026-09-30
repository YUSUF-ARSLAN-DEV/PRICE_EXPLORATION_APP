import { Global, Module } from '@nestjs/common';
import { Mailer, SmtpMailer } from '../mail/mailer';
import { AdminGuard, AuthGuard, AuthResolver, OptionalAuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthResolver,
    AuthGuard,
    AdminGuard,
    OptionalAuthGuard,
    { provide: Mailer, useClass: SmtpMailer },
  ],
  exports: [AuthService, AuthResolver, AuthGuard, AdminGuard, OptionalAuthGuard, Mailer],
})
export class AuthModule {}
