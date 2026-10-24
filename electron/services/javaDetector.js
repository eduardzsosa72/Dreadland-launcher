import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

// Everything here is async: spawnSync('java -version') and the sync directory scans used to
// freeze the whole launcher window for 200-600 ms on every Play click.
const javaVersionCache = new Map(); // cmd -> Promise<number|null>

function runCommand(command, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      resolve({ error, status: null, stdout, stderr });
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { } }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ error, status: null, stdout, stderr }); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ error: null, status, stdout, stderr }); });
  });
}

const pathExists = (p) => fs.promises.access(p).then(() => true, () => false);

async function readDirEntries(dir) {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function parseJavaMajorVersion(output) {
  const text = `${output || ''}`;
  const match = text.match(/version\s+"(?:(\d+)\.(\d+)\.|(\d+))(?:[^"]*)"/i);
  if (!match) return null;
  if (match[3]) return Number(match[3]);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 1 && Number.isFinite(minor)) return minor;
  return Number.isFinite(major) ? major : null;
}

export function resolveJavaCommand(javaPath) {
  if (javaPath && String(javaPath).trim()) return String(javaPath).trim();
  if (process.env.JAVA_HOME) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(process.env.JAVA_HOME, 'bin', `java${ext}`);
  }
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

export async function detectJavaMajor(javaCmd) {
  if (!javaCmd) return null;
  const normalized = String(javaCmd).trim();
  if (!javaVersionCache.has(normalized)) {
    javaVersionCache.set(normalized, runCommand(normalized, ['-version']).then((result) => {
      if (result.error) return null;
      return parseJavaMajorVersion(`${result.stderr || ''}\n${result.stdout || ''}`);
    }));
  }
  return javaVersionCache.get(normalized);
}

export function expandJavaExecutableCandidate(candidate) {
  if (!candidate) return [];
  const value = String(candidate).trim();
  if (!value) return [];
  const normalized = value.replace(/\/+$/g, '');
  const candidates = [normalized];
  const baseName = path.basename(normalized).toLowerCase();
  if (!baseName.endsWith('java') && !baseName.endsWith('java.exe')) {
    candidates.push(path.join(normalized, 'bin', `java${process.platform === 'win32' ? '.exe' : ''}`));
  }
  return candidates;
}

export async function collectCommonJavaCandidates() {
  const candidates = [];
  const add = (value) => {
    if (!value) return;
    const normalized = String(value).trim();
    if (normalized) candidates.push(normalized);
  };
  // Runtimes the launcher downloaded itself (see javaRuntime.js), listed first so they win ties
  try {
    const runtimesDir = path.join(app.getPath('userData'), 'runtime');
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';
    for (const entry of await readDirEntries(runtimesDir)) {
      if (!entry.isDirectory() || !/^java-\d+$/.test(entry.name)) continue;
      for (const candidate of [path.join(runtimesDir, entry.name, 'bin', exe), path.join(runtimesDir, entry.name, 'Contents', 'Home', 'bin', exe)]) {
        if (await pathExists(candidate)) add(candidate);
      }
    }
  } catch { }
  const pathCandidates = process.platform === 'win32' ? ['java.exe', 'java'] : ['java'];
  for (const executable of pathCandidates) {
    const lookup = await runCommand(process.platform === 'win32' ? 'where' : 'which', [executable]);
    if (!lookup.error && lookup.status === 0) {
      for (const line of String(lookup.stdout || '').split(/\r?\n/)) add(line);
    }
  }
  if (process.platform === 'darwin') {
    // 1. Query macOS /usr/libexec/java_home -V
    try {
      const jhLookup = await runCommand('/usr/libexec/java_home', ['-V']);
      const text = `${jhLookup.stderr || ''}\n${jhLookup.stdout || ''}`;
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/(\/[^\s]+(?:\/Contents\/Home)?)/);
        if (match && match[1]) {
          const homePath = match[1].trim();
          add(path.join(homePath, 'bin', 'java'));
        }
      }
    } catch { }

    // 2. Standard macOS JavaVirtualMachines and Homebrew directories
    const macJvmRoots = [
      '/Library/Java/JavaVirtualMachines',
      path.join(app.getPath('home'), 'Library', 'Java', 'JavaVirtualMachines'),
      '/opt/homebrew/opt',
      '/usr/local/opt',
    ];
    for (const root of macJvmRoots) {
      for (const entry of await readDirEntries(root)) {
        if (!entry.isDirectory()) continue;
        const entryPath = path.join(root, entry.name);
        const standardJava = path.join(entryPath, 'Contents', 'Home', 'bin', 'java');
        if (await pathExists(standardJava)) add(standardJava);
        const directJava = path.join(entryPath, 'bin', 'java');
        if (await pathExists(directJava)) add(directJava);
        const brewJvmJava = path.join(entryPath, 'libexec', 'openjdk.jdk', 'Contents', 'Home', 'bin', 'java');
        if (await pathExists(brewJvmJava)) add(brewJvmJava);
      }
    }

    // 3. SDKMAN and ASDF on macOS
    const home = app.getPath('home');
    const sdkmanPath = path.join(home, '.sdkman', 'candidates', 'java');
    const asdfPath = path.join(home, '.asdf', 'installs', 'java');
    for (const managerDir of [sdkmanPath, asdfPath]) {
      for (const entry of await readDirEntries(managerDir)) {
        if (entry.isDirectory()) {
          add(path.join(managerDir, entry.name, 'bin', 'java'));
          add(path.join(managerDir, entry.name, 'Contents', 'Home', 'bin', 'java'));
        }
      }
    }
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env.JAVA_HOME,
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\Amazon Corretto',
      'C:\\Program Files\\BellSoft',
      'C:\\Program Files\\OpenLogic',
      'C:\\Program Files\\AdoptOpenJDK',
      'C:\\Program Files (x86)\\Eclipse Adoptium',
      'C:\\Program Files (x86)\\Java',
    ].filter(Boolean);
    for (const root of roots) {
      for (const entry of await readDirEntries(root)) {
        if (!entry.isDirectory()) continue;
        const lower = entry.name.toLowerCase();
        if (!/(jdk|jre|java|temurin|adoptium|corretto|zulu|bellsoft|openlogic|microsoft)/.test(lower)) continue;
        add(path.join(root, entry.name, 'bin', 'java.exe'));
      }
    }
  }
  return Array.from(new Set(candidates.flatMap(expandJavaExecutableCandidate)));
}

export async function findJavaCommand(requiredMajor, preferredPath = '') {
  const preferredCandidates = expandJavaExecutableCandidate(preferredPath);
  const fallbackCandidates = await collectCommonJavaCandidates();
  const allCandidates = Array.from(new Set([...preferredCandidates, ...fallbackCandidates]));
  let bestCandidate = null;
  let bestMajor = null;
  for (const candidate of allCandidates) {
    const major = await detectJavaMajor(candidate);
    if (!major) continue;
    if (!bestCandidate || major > bestMajor) {
      bestCandidate = candidate;
      bestMajor = major;
    }
    if (!requiredMajor || major >= requiredMajor) {
      return { javaCmd: candidate, javaMajor: major };
    }
  }
  return { javaCmd: bestCandidate || resolveJavaCommand(preferredPath), javaMajor: bestMajor };
}
