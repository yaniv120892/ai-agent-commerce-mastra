import fs from 'node:fs';
import path from 'node:path';

// The nearest package.json is not enough of a marker: `mastra dev` runs with its cwd
// inside the project (src/mastra/public) today, but its bundle output at .mastra/output
// carries its own package.json (name: "server"). Matching the package name pins the walk
// to the real project root no matter which process — next dev, mastra dev, or vitest —
// resolved the path.
const PROJECT_PACKAGE_NAME = 'ai-agent-commerce-mastra';

export function findProjectRootDirectory(startDirectory: string = process.cwd()): string {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    if (readPackageName(currentDirectory) === PROJECT_PACKAGE_NAME) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(
        `No package.json named "${PROJECT_PACKAGE_NAME}" found walking up from ${path.resolve(startDirectory)}`,
      );
    }
    currentDirectory = parentDirectory;
  }
}

function readPackageName(directory: string): string | null {
  const packageJsonPath = path.join(directory, 'package.json');

  let rawContents: string;
  try {
    rawContents = fs.readFileSync(packageJsonPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContents);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || !('name' in parsed)) {
    return null;
  }

  const { name } = parsed;

  return typeof name === 'string' ? name : null;
}
