import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  mkdir,
  rm,
  writeFile,
  appendFile,
  readFile,
  readdir,
  stat,
  copyFile,
  rename,
} from 'node:fs/promises';
import { FileSystem } from './types.js';

export class RealFileSystem implements FileSystem {
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, { recursive: options?.recursive ?? false });
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await rm(path, { recursive: options?.recursive ?? false, force: options?.force ?? false });
  }

  async copyFile(source: string, destination: string): Promise<void> {
    await copyFile(source, destination);
  }

  async rename(source: string, destination: string): Promise<void> {
    await rename(source, destination);
  }

  async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data, 'utf8');
  }

  async appendFile(path: string, data: string): Promise<void> {
    await appendFile(path, data, 'utf8');
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  async readdir(path: string): Promise<string[]> {
    return readdir(path);
  }

  async stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }> {
    return stat(path);
  }

  async hashFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Streamed rather than buffered: backup archives reach hundreds of
      // megabytes, and a restore-side digest must match the bytes on disk.
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
