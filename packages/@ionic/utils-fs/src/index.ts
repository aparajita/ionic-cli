import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as makeDir from 'make-dir';
import * as ζncp from 'ncp';
import * as wfa from 'write-file-atomic';

interface Promisify {
  <T>(func: (callback: (err: any, result?: T) => void) => void): () => Promise<T>;
  <T, A1>(func: (arg1: A1, callback: (err: any, result?: T) => void) => void): (arg1: A1) => Promise<T>;
  <T, A1, A2>(func: (arg1: A1, arg2: A2, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2) => Promise<T>;
  <T, A1, A2, A3>(func: (arg1: A1, arg2: A2, arg3: A3, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2, arg3: A3) => Promise<T>;
  <T, A1, A2, A3, A4>(func: (arg1: A1, arg2: A2, arg3: A3, arg4: A4, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2, arg3: A3, arg4: A4) => Promise<T>;
  <T, A1, A2, A3, A4, A5>(func: (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5) => Promise<T>;
}

const promisify: Promisify = (func: any) => {
  return (...args: any[]) => {
    return new Promise((resolve, reject) => {
      func(...args, (err: any, response: any) => {
        if (err) {
          return reject(err);
        }

        resolve(response);
      });
    });
  };
};

export interface FSReadFileOptions {
  encoding: string;
  flag?: string;
}

export interface FSWriteFileOptions {
  encoding: string;
  mode?: number;
  flag?: string;
}

export const fsAccess = promisify<void, string, number>(fs.access);
export const fsMkdir = promisify<void, string, number>(fs.mkdir);
export const fsOpen = promisify<number, string, string>(fs.open);
export const fsStat = promisify<fs.Stats, string>(fs.stat);
export const fsUnlink = promisify<void, string>(fs.unlink);
export const fsReadFile = promisify<string, string, FSReadFileOptions>(fs.readFile);
export const fsWriteFile = promisify<void, string, any, FSWriteFileOptions>(fs.writeFile);
export const fsReadDir = promisify<string[], string>(fs.readdir);

export const writeFileAtomic = promisify<void, string, string | Buffer, wfa.Options>(wfa);
export const writeFileAtomicSync = wfa.sync;

export { makeDir };

/**
 * Error-less, promisified `fs.readdir` with an option to recurse into
 * subdirectories.
 *
 * This function will not throw errors. If there is an issue with the
 * directory, an empty array is returned.
 *
 * @param dir The path to the directory to read.
 * @param options.recursive If true, compile an array of all files in all
 *                          subdirectories.
 */
export async function readDir(dir: string, options?: { recursive?: boolean; }): Promise<string[]> {
  options = options ? options : {};

  if (options.recursive) {
    const klaw = await import('klaw');

    return new Promise<string[]>((resolve, reject) => {
      const items: string[] = [];

      klaw(dir)
        .on('error', err => { /* ignore */ })
        .on('data', item => items.push(item.path))
        .on('end', () => resolve(items));
    });
  } else {
    try {
      return await fsReadDir(dir);
    } catch (e) {
      return [];
    }
  }
}

export async function fsReadJsonFile(filePath: string, options: FSReadFileOptions = { encoding: 'utf8' }): Promise<{ [key: string]: any }> {
  const f = await fsReadFile(filePath, options);
  return JSON.parse(f);
}

export async function fsWriteJsonFile(filePath: string, json: { [key: string]: any; }, options: FSWriteFileOptions): Promise<void> {
  return fsWriteFile(filePath, JSON.stringify(json, undefined, 2) + '\n', options);
}

export async function fileToString(filePath: string): Promise<string> {
  try {
    return await fsReadFile(filePath, { encoding: 'utf8' });
  } catch (e) {
    if (e.code === 'ENOENT') {
      return '';
    }

    throw e;
  }
}

export async function fsMkdirp(p: string, mode = 0o777): Promise<void> {
  const absPath = path.resolve(p);
  const pathObj = path.parse(absPath);
  const dirnames = absPath.split(path.sep).splice(1);
  const dirs = dirnames.map((v, i) => path.resolve(pathObj.root, ...dirnames.slice(0, i), v));

  for (const dir of dirs) {
    try {
      await fsMkdir(dir, mode);
    } catch (e) {
      if (e.code !== 'EEXIST') {
        throw e;
      }
    }
  }
}

export async function getFileChecksum(filePath: string): Promise<string> {
  const crypto = await import('crypto');

  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const input = fs.createReadStream(filePath);

    input.on('error', (err: Error) => {
      reject(err);
    });

    hash.once('readable', () => {
      const fullChecksum = (hash.read() as Buffer).toString('hex');
      resolve(fullChecksum);
    });

    input.pipe(hash);
  });
}

/**
 * Return true and cached checksums for a file by its path.
 *
 * Cached checksums are stored as `.md5` files next to the original file. If
 * the cache file is missing, the cached checksum is undefined.
 *
 * @param p The file path
 * @return Promise<[true checksum, cached checksum or undefined if cache file missing]>
 */
export async function getFileChecksums(p: string): Promise<[string, string | undefined]> {
  return Promise.all([
    getFileChecksum(p),
    (async () => {
      try {
        const md5 = await fsReadFile(`${p}.md5`, { encoding: 'utf8' });
        return md5.trim();
      } catch (e) {
        if (e.code !== 'ENOENT') {
          throw e;
        }
      }
    })(),
  ]);
}

/**
 * Store a cache file containing the source file's md5 checksum hash.
 *
 * @param p The file path
 * @param checksum The checksum. If excluded, the checksum is computed
 */
export async function cacheFileChecksum(p: string, checksum?: string): Promise<void> {
  const md5 = await getFileChecksum(p);
  await fsWriteFile(`${p}.md5`, md5, { encoding: 'utf8' });
}

export function writeStreamToFile(stream: NodeJS.ReadableStream, destination: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destination);
    stream.pipe(dest);
    dest.on('error', reject);
    dest.on('finish', resolve);
  });
}

export async function copyDirectory(source: string, destination: string, options: ζncp.Options = {}): Promise<void> {
  const ncp = await import('ncp');

  return new Promise<void>((resolve, reject) => {
    ncp.ncp(source, destination, options, err => {
      if (err) {
        reject(err);
      }

      resolve();
    });
  });
}

export async function removeDirectory(dir: string): Promise<void> {
  const rimraf = await import('rimraf');
  const rimrafp = promisify<void, string>(rimraf);
  await rimrafp(dir);
}

export function copyFile(fileName: string, target: string, mode = 0o666) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(fileName);
    const ws = fs.createWriteStream(target, { mode });

    rs.on('error', reject);
    ws.on('error', reject);

    ws.on('open', () => {
      rs.pipe(ws);
    });

    ws.once('finish', resolve);
  });
}

export async function pathAccessible(filePath: string, mode: number): Promise<boolean> {
  try {
    await fsAccess(filePath, mode);
  } catch (e) {
    return false;
  }

  return true;
}

export async function pathExists(filePath: string): Promise<boolean> {
  return pathAccessible(filePath, fs.constants.F_OK);
}

/**
 * Find the base directory based on the path given and a marker file to look for.
 */
export async function findBaseDirectory(dir: string, file: string): Promise<string | undefined> {
  if (!dir || !file) {
    return;
  }

  for (const d of compilePaths(dir)) {
    const results = await fsReadDir(d);

    if (results.includes(file)) {
      return d;
    }
  }
}

/**
 * Generate a random file path within the computer's temporary directory.
 *
 * @param prefix Optionally provide a filename prefix.
 */
export function tmpfilepath(prefix?: string): string {
  const rn = Math.random().toString(16).substring(2, 8);
  const p = path.resolve(os.tmpdir(), prefix ? `${prefix}-${rn}` : rn);

  return p;
}

/**
 * Given an absolute system path, compile an array of paths working backwards
 * one directory at a time, always ending in the root directory.
 *
 * For example, `'/some/dir'` => `['/some/dir', '/some', '/']`
 *
 * @param filePath Absolute system base path.
 */
export function compilePaths(filePath: string): string[] {
  filePath = path.normalize(filePath);

  if (!path.isAbsolute(filePath)) {
    throw new Error(`${filePath} is not an absolute path`);
  }

  const parsed = path.parse(filePath);

  if (filePath === parsed.root) {
    return [filePath];
  }

  return filePath
    .slice(parsed.root.length)
    .split(path.sep)
    .map((segment, i, array) => parsed.root + path.join(...array.slice(0, array.length - i)))
    .concat(parsed.root);
}