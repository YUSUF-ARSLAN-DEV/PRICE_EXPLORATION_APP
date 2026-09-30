import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { BlobServiceClient } from '@azure/storage-blob';
import { CONFIG, Config } from '../config';

/** Private storage for receipt images: Azure Blob (prod/Azurite) or a local directory (dev). */
@Injectable()
export class BlobStore {
  private readonly container?: ReturnType<BlobServiceClient['getContainerClient']>;
  private ready?: Promise<unknown>;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    if (cfg.azure) {
      this.container = BlobServiceClient.fromConnectionString(
        cfg.azure.connectionString,
      ).getContainerClient(cfg.azure.container);
    }
  }

  async put(ext: string, data: Buffer): Promise<string> {
    const name = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    if (this.container) {
      this.ready ??= this.container.createIfNotExists();
      await this.ready;
      await this.container
        .getBlockBlobClient(name)
        .uploadData(data, { blobHTTPHeaders: { blobContentType: `image/${ext}` } });
      return `azblob://${this.cfg.azure!.container}/${name}`;
    }
    const file = path.join(this.cfg.receiptDir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { mode: 0o600 });
    return `file://${file}`;
  }

  async delete(uri: string): Promise<void> {
    if (uri.startsWith('azblob://') && this.container) {
      const name = uri.replace(`azblob://${this.cfg.azure!.container}/`, '');
      await this.container.getBlockBlobClient(name).deleteIfExists();
    } else if (uri.startsWith('file://')) {
      await unlink(uri.slice('file://'.length)).catch(() => undefined);
    }
  }
}
