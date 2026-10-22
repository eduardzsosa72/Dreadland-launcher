import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { saveResponseBodyToFile } from './minecraftInstaller.js';
import { detectJavaMajor, findJavaCommand } from './javaDetector.js';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const ADOPTIUM_ASSETS_URL = 'https://api.adoptium.net/v3/assets/latest';
const RUNTIME_MARKER = '.dreadland-runtime.json';

const activeDownloads = new Map();

// Lives in userData, not the Minecraft folder, so changing the game directory does not re-download Java
export function getRuntimesDir() {
  return path.join(app.getPath('userData'), 'runtime');
}

function javaExecutableName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function adoptiumOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function adoptiumArchitectures() {
  if (process.arch === 'arm64') {
    // Old Java builds have no ARM package on macOS; the x64 one runs under Rosetta
    return process.platform === 'darwin' ? ['aarch64', 'x64'] : ['aarch64'];
  }
  if (process.arch === 'ia32') return ['x32'];
  return ['x64'];
}

function findJavaInside(rootDir) {
  const exe = javaExecutableName();
  const candidates = [
    path.join(rootDir, 'bin', exe),
    path.join(rootDir, 'Contents', 'Home', 'bin', exe),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

export function getManagedJavaPath(major) {
  const runtimeDir = path.join(getRuntimesDir(), `java-${major}`);
  if (!fs.existsSync(path.join(runtimeDir, RUNTIME_MARKER))) return null;
  return findJavaInside(runtimeDir);
}

async function fetchRuntimePackage(major) {
  for (const architecture of adoptiumArchitectures()) {
    const query = new URLSearchParams({ architecture, image_type: 'jre', os: adoptiumOs(), vendor: 'eclipse' });
    const res = await fetch(`${ADOPTIUM_ASSETS_URL}/${major}/hotspot?${query}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) continue;
    const releases = await res.json();
    const pkg = releases?.[0]?.binary?.package;
    if (pkg?.link) return { ...pkg, releaseName: releases[0].release_name };
  }
  throw new Error(`No Java ${major} runtime is available for ${adoptiumOs()} ${process.arch}.`);
}

async function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

function extractTarGz(archivePath, outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`))));
  });
}

async function downloadRuntime(major, { onLog = null } = {}) {
  const runtimesDir = getRuntimesDir();
  const targetDir = path.join(runtimesDir, `java-${major}`);
  const workDir = path.join(runtimesDir, `.java-${major}-${Date.now()}`);
  await fs.promises.mkdir(workDir, { recursive: true });

  try {
    const pkg = await fetchRuntimePackage(major);
    const sizeMb = pkg.size ? ` (${Math.round(pkg.size / 1048576)} MB)` : '';
    onLog?.('info', `Downloading Java ${major} (${pkg.releaseName})${sizeMb}...`);

    const archivePath = path.join(workDir, pkg.name);
    const res = await fetch(pkg.link);
    if (!res.ok) throw new Error(`Java download failed: HTTP ${res.status}`);
    await saveResponseBodyToFile(res, archivePath);
    if (pkg.checksum && (await sha256OfFile(archivePath)) !== pkg.checksum) {
      throw new Error('Downloaded Java archive failed checksum verification.');
    }

    onLog?.('info', `Extracting Java ${major}...`);
    const extractDir = path.join(workDir, 'extract');
    await fs.promises.mkdir(extractDir, { recursive: true });
    if (pkg.name.toLowerCase().endsWith('.zip')) {
      new AdmZip(archivePath).extractAllTo(extractDir, true);
    } else {
      await extractTarGz(archivePath, extractDir);
    }

    // Archives contain a single top-level folder like jdk-17.0.20.1+1-jre
    const [topLevel] = (await fs.promises.readdir(extractDir, { withFileTypes: true })).filter(entry => entry.isDirectory());
    if (!topLevel) throw new Error('Java archive was empty.');
    const extractedRoot = path.join(extractDir, topLevel.name);
    const javaPath = findJavaInside(extractedRoot);
    if (!javaPath) throw new Error('Java executable not found in the downloaded archive.');
    if (process.platform !== 'win32') await fs.promises.chmod(javaPath, 0o755).catch(() => { });

    await fs.promises.writeFile(path.join(extractedRoot, RUNTIME_MARKER), JSON.stringify({ major, release: pkg.releaseName, checksum: pkg.checksum }, null, 2));
    await fs.promises.rm(targetDir, { recursive: true, force: true });
    await fs.promises.rename(extractedRoot, targetDir);

    const finalPath = findJavaInside(targetDir);
    const detected = detectJavaMajor(finalPath);
    if (detected !== Number(major)) throw new Error(`Downloaded Java reports version ${detected}, expected ${major}.`);
    onLog?.('success', `Java ${major} installed.`);
    return finalPath;
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => { });
  }
}

// Downloads at most once per major version, even if several launches/installs ask at the same time
export function ensureJavaRuntime(major, { onLog = null } = {}) {
  const key = String(major);
  const existing = getManagedJavaPath(key);
  if (existing) return Promise.resolve(existing);
  if (!activeDownloads.has(key)) {
    activeDownloads.set(key, downloadRuntime(key, { onLog }).finally(() => activeDownloads.delete(key)));
  }
  return activeDownloads.get(key);
}

// For installers (Fabric, Forge...) that only need some Java of at least minMajor
export async function resolveJavaForInstaller(minMajor, preferredPath = '', { onLog = null } = {}) {
  const found = findJavaCommand(minMajor, preferredPath);
  if (found?.javaCmd && found.javaMajor >= minMajor) return found.javaCmd;
  return ensureJavaRuntime(Math.max(minMajor, 17), { onLog });
}
