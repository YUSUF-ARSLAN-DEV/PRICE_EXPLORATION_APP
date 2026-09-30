import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { forgotBody, loginBody, registerBody, resetBody, tokenBody } from '@qarib/shared';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { AuthService } from './auth.service';

const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 10);
const strict = { default: { limit: AUTH_LIMIT, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
@Throttle(strict)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Create an account (needs acceptTerms). Always 202: no account enumeration.',
  })
  @ApiZodBody(registerBody)
  async register(
    @Req() req: Request,
    @Body(new ZodPipe(registerBody)) body: ReturnType<typeof registerBody.parse>,
  ) {
    await this.auth.register(req, body);
    return { message: 'If the address is valid, a confirmation email has been sent.' };
  }

  @Post('verify-email')
  @HttpCode(204)
  @ApiZodBody(tokenBody)
  async verify(@Body(new ZodPipe(tokenBody)) body: ReturnType<typeof tokenBody.parse>) {
    await this.auth.verifyEmail(body.token);
  }

  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginBody)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(loginBody)) body: ReturnType<typeof loginBody.parse>,
  ) {
    return { user: await this.auth.login(req, res, body.email, body.password) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return { user: await this.auth.refresh(req, res) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req, res);
  }

  @Post('forgot-password')
  @HttpCode(202)
  @ApiZodBody(forgotBody)
  async forgot(@Body(new ZodPipe(forgotBody)) body: ReturnType<typeof forgotBody.parse>) {
    await this.auth.forgotPassword(body.email);
    return { message: 'If an account exists, a reset email has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(204)
  @ApiZodBody(resetBody)
  async reset(@Body(new ZodPipe(resetBody)) body: ReturnType<typeof resetBody.parse>) {
    await this.auth.resetPassword(body.token, body.password);
  }
}
