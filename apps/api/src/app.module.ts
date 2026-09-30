import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { AuthModule } from './auth/auth.module';
import { BasketsController } from './baskets/baskets.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CsrfGuard } from './common/csrf.guard';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { DbModule } from './db/db.module';
import { MaintenanceService } from './jobs/maintenance.service';
import { MeController } from './me/me.controller';
import { PublicController } from './public/public.controller';
import { BlobStore } from './reports/blob-store';
import { ReportsController } from './reports/reports.controller';
import { MeiliIndexer } from './search/meili.indexer';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';

@Module({
  imports: [
    DbModule,
    AuthModule,
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 120) },
    ]),
  ],
  controllers: [
    PublicController,
    SearchController,
    CatalogController,
    BasketsController,
    MeController,
    AlertsController,
    ReportsController,
    AdminController,
  ],
  providers: [
    SearchService,
    MeiliIndexer,
    AlertsService,
    MaintenanceService,
    BlobStore,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [AlertsService, MeiliIndexer, BlobStore],
})
export class AppModule {}
