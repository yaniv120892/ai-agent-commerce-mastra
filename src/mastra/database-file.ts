import fs from 'node:fs';
import path from 'node:path';

// Every SQLite database begins with this 16-byte header, NUL terminator included.
// A file that exists but does not start with it was truncated or overwritten by
// something that is not SQLite, and libsql throws on the first query rather than
// at open time — which would surface as an opaque 500 on an unrelated route.
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

export type DatabaseFileState = 'created' | 'usable' | 'quarantined';

export function ensureUsableDatabaseFile(filePath: string): DatabaseFileState {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    return 'created';
  }

  if (isReadableSqliteFile(filePath)) {
    return 'usable';
  }

  fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);

  return 'quarantined';
}

function isReadableSqliteFile(filePath: string): boolean {
  const stats = fs.statSync(filePath);

  // libsql creates the file before writing the header, so a zero-length file is a
  // fresh database rather than a corrupt one.
  if (stats.size === 0) {
    return true;
  }
  if (stats.size < SQLITE_HEADER.length) {
    return false;
  }

  const header = Buffer.alloc(SQLITE_HEADER.length);
  const handle = fs.openSync(filePath, 'r');
  try {
    fs.readSync(handle, header, 0, SQLITE_HEADER.length, 0);
  } finally {
    fs.closeSync(handle);
  }

  return header.equals(SQLITE_HEADER);
}
