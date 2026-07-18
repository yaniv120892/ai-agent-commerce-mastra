import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureUsableDatabaseFile } from './database-file';

const temporaryDirectories: string[] = [];

function makeTemporaryPath(fileName = 'memory.db'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'database-file-'));
  temporaryDirectories.push(directory);

  return path.join(directory, fileName);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('ensureUsableDatabaseFile', () => {
  it('reports a missing file as created and makes its directory', () => {
    const filePath = path.join(makeTemporaryPath(), 'nested', 'memory.db');

    expect(ensureUsableDatabaseFile(filePath)).toBe('created');
    expect(fs.existsSync(path.dirname(filePath))).toBe(true);
  });

  it('leaves a real SQLite file alone', () => {
    const filePath = makeTemporaryPath();
    fs.writeFileSync(filePath, Buffer.from('SQLite format 3\0and then some payload', 'latin1'));

    expect(ensureUsableDatabaseFile(filePath)).toBe('usable');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('treats a zero-length file as a fresh database rather than corruption', () => {
    const filePath = makeTemporaryPath();
    fs.writeFileSync(filePath, '');

    expect(ensureUsableDatabaseFile(filePath)).toBe('usable');
  });

  it('quarantines a file whose header is not SQLite so libsql recreates it', () => {
    const filePath = makeTemporaryPath();
    fs.writeFileSync(filePath, 'this is definitely not a database');

    expect(ensureUsableDatabaseFile(filePath)).toBe('quarantined');
    expect(fs.existsSync(filePath)).toBe(false);

    const quarantined = fs
      .readdirSync(path.dirname(filePath))
      .filter((entry) => entry.includes('.corrupt-'));
    expect(quarantined).toHaveLength(1);
  });

  it('quarantines a file too short to carry a SQLite header', () => {
    const filePath = makeTemporaryPath();
    fs.writeFileSync(filePath, 'SQLite');

    expect(ensureUsableDatabaseFile(filePath)).toBe('quarantined');
  });
});
