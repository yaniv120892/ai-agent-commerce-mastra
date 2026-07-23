import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findProjectRootDirectory } from './project-root';

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-root-'));
  temporaryDirectories.push(directory);

  return directory;
}

function writePackageJson(directory: string, contents: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), contents);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('findProjectRootDirectory', () => {
  it('finds the project root from the real mastra dev cwd', () => {
    const mastraDevWorkingDirectory = path.join(process.cwd(), 'src', 'mastra', 'public');

    expect(findProjectRootDirectory(mastraDevWorkingDirectory)).toBe(process.cwd());
  });

  it('walks up past a decoy package.json with a different name', () => {
    const root = makeTemporaryDirectory();
    writePackageJson(root, JSON.stringify({ name: 'ai-agent-commerce-mastra' }));

    const bundleOutput = path.join(root, '.mastra', 'output');
    writePackageJson(bundleOutput, JSON.stringify({ name: 'server' }));

    expect(findProjectRootDirectory(bundleOutput)).toBe(root);
  });

  it('walks up past a package.json that is not valid JSON', () => {
    const root = makeTemporaryDirectory();
    writePackageJson(root, JSON.stringify({ name: 'ai-agent-commerce-mastra' }));

    const nested = path.join(root, 'nested');
    writePackageJson(nested, 'not json at all');

    expect(findProjectRootDirectory(nested)).toBe(root);
  });

  it('throws an actionable error when no matching package.json exists', () => {
    const orphan = makeTemporaryDirectory();

    expect(() => findProjectRootDirectory(orphan)).toThrowError(orphan);
  });
});
