import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile as rawWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RealFileSystem } from '../../src/fs.js';

describe('RealFileSystem', () => {
  let root: string;
  let fs: RealFileSystem;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'backup-manager-fs-'));
    fs = new RealFileSystem();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates directories recursively and reports their existence', async () => {
    const dir = path.join(root, 'a/b/c');

    await fs.mkdir(dir, { recursive: true });

    expect(existsSync(dir)).toBe(true);
    await expect(fs.exists(dir)).resolves.toBe(true);
    await expect(fs.exists(path.join(root, 'missing'))).resolves.toBe(false);
  });

  it('writes, appends, and reads text files', async () => {
    const file = path.join(root, 'notes.txt');

    await fs.writeFile(file, 'one');
    await fs.appendFile(file, '-two');

    await expect(fs.readFile(file)).resolves.toBe('one-two');
  });

  it('copies and renames files', async () => {
    const source = path.join(root, 'source.txt');
    const copy = path.join(root, 'copy.txt');
    const moved = path.join(root, 'moved.txt');
    await fs.writeFile(source, 'content');

    await fs.copyFile(source, copy);
    await fs.rename(source, moved);

    await expect(fs.readFile(copy)).resolves.toBe('content');
    await expect(fs.readFile(moved)).resolves.toBe('content');
    await expect(fs.exists(source)).resolves.toBe(false);
  });

  it('removes directories recursively', async () => {
    const dir = path.join(root, 'tree/nested');
    const file = path.join(dir, 'leaf.txt');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, 'leaf');

    await fs.rm(path.join(root, 'tree'), { recursive: true, force: true });

    expect(existsSync(file)).toBe(false);
  });

  it('lists directory entries', async () => {
    await fs.mkdir(path.join(root, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(root, 'file.txt'), 'x');

    const entries = await fs.readdir(root);

    expect(entries.sort()).toEqual(['file.txt', 'subdir']);
  });

  it('reports file and directory kinds through stat', async () => {
    await fs.writeFile(path.join(root, 'file.txt'), 'x');

    const fileStat = await fs.stat(path.join(root, 'file.txt'));
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.isDirectory()).toBe(false);

    const rootStat = await fs.stat(root);
    expect(rootStat.isDirectory()).toBe(true);
  });

  it('hashes file content as sha256 without buffering it whole', async () => {
    const file = path.join(root, 'blob.bin');
    // Larger than a stream chunk so the streamed hash really loops.
    const content = 'x'.repeat(1024 * 64);
    await rawWriteFile(file, content, 'utf8');

    await expect(fs.hashFile(file)).resolves.toBe(
      createHash('sha256').update(content).digest('hex'),
    );
  });

  it('rejects hashing a missing file', async () => {
    await expect(fs.hashFile(path.join(root, 'missing.bin'))).rejects.toThrow();
  });
});
