import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from '../config';
import { Db } from './db.service';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }, Db],
  exports: [CONFIG, Db],
})
export class DbModule {}
