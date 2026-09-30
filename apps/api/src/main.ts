import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { CONFIG, Config } from './config';

async function bootstrap() {
  const app = await createApp();
  const cfg = app.get<Config>(CONFIG);
  app.enableShutdownHooks();
  await app.listen(cfg.port, '0.0.0.0');
  new Logger('bootstrap').log(`API listening on :${cfg.port} (${cfg.env})`);
}
void bootstrap();
