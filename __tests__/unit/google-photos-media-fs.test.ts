import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RealMediaFs } from '../../src/google-photos-media-fs.js';

describe('RealMediaFs', () => {
  let root: string;
  let mediaFs: RealMediaFs;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'backup-manager-media-fs-'));
    mediaFs = new RealMediaFs();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates directories recursively and reports existence', async () => {
    const dir = path.join(root, 'slices/extracted');

    await mediaFs.mkdirRecursive(dir);

    expect(existsSync(dir)).toBe(true);
    await expect(mediaFs.exists(dir)).resolves.toBe(true);
    await expect(mediaFs.exists(path.join(root, 'missing'))).resolves.toBe(false);
  });

  it('removes directories recursively', async () => {
    const file = path.join(root, 'extracted/photo.jpg');
    await mediaFs.mkdirRecursive(path.dirname(file));
    await mediaFs.writeTextFile(file, 'bytes');

    await mediaFs.rmRecursive(path.join(root, 'extracted'));

    expect(existsSync(file)).toBe(false);
  });

  it('lists files recursively as paths relative to the root', async () => {
    const nested = path.join(root, 'Takeout/Google Photos/Photos from 2019');
    await mediaFs.mkdirRecursive(nested);
    await mediaFs.writeTextFile(path.join(nested, 'IMG_1.jpg'), 'a');
    await mediaFs.writeTextFile(path.join(root, 'top.jpg'), 'b');

    const files = await mediaFs.readdirRecursive(root);

    expect(files.sort()).toEqual(['Takeout/Google Photos/Photos from 2019/IMG_1.jpg', 'top.jpg']);
  });

  it('reports file sizes in bytes', async () => {
    const file = path.join(root, 'slice.zip');
    await mediaFs.writeTextFile(file, '12345');

    await expect(mediaFs.size(file)).resolves.toBe(5);
  });

  it('renames files', async () => {
    const part = path.join(root, 'slice.zip.part');
    const final = path.join(root, 'slice.zip');
    await mediaFs.writeTextFile(part, 'complete');

    await mediaFs.rename(part, final);

    await expect(mediaFs.readTextFile(final)).resolves.toBe('complete');
    await expect(mediaFs.exists(part)).resolves.toBe(false);
  });

  it('copies and unlinks files', async () => {
    const source = path.join(root, 'photo.jpg');
    const copy = path.join(root, 'copy.jpg');
    await mediaFs.writeTextFile(source, 'image');

    await mediaFs.copyFile(source, copy);
    await mediaFs.unlink(source);

    await expect(mediaFs.readTextFile(copy)).resolves.toBe('image');
    await expect(mediaFs.exists(source)).resolves.toBe(false);
  });

  it('hashes file content as sha256', async () => {
    const file = path.join(root, 'photo.jpg');
    const content = 'x'.repeat(1024 * 64);
    await mediaFs.writeTextFile(file, content);

    await expect(mediaFs.hashFile(file)).resolves.toBe(
      createHash('sha256').update(content).digest('hex'),
    );
  });

  it('reports free space for an existing directory', async () => {
    await expect(mediaFs.freeSpace(root)).resolves.toBeGreaterThan(0);
  });
});
