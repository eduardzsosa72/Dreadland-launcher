import path from 'path';

// Everything that arrives over IPC comes from the renderer and is treated as untrusted.
// Handlers validate with these helpers; a failure becomes { error: 'InvalidInput' }.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function fail(message) {
  throw new ValidationError(message);
}

export function asObject(value, label = 'payload') {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

export function asString(value, label, { max = 512, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(`${label} is required.`);
  }
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  if (value.length > max) fail(`${label} is too long.`);
  if (value.includes('\0')) fail(`${label} contains invalid characters.`);
  return value;
}

// A single path segment: no separators, no "." or "..". Blocks path traversal like "../../x".
export function isSafeSegment(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (/[\\/\0]/.test(trimmed)) return false;
  if (/^[a-zA-Z]:/.test(trimmed)) return false;
  return path.basename(trimmed) === trimmed;
}

export function asFileName(value, label = 'fileName') {
  const name = asString(value, label, { max: 255 });
  if (!isSafeSegment(name)) fail(`${label} is not a valid file name.`);
  return name;
}

// null/'' means "the base .minecraft folder", which the services already support
export function asInstanceId(value, { optional = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail('instanceId is required.');
  }
  if (!isSafeSegment(value)) fail('instanceId is not valid.');
  return value;
}

export function asHttpUrl(value, label = 'url', { hosts = null } = {}) {
  const raw = asString(value, label, { max: 4096 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${label} is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') fail(`${label} must be http(s).`);
  if (hosts && !hosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    fail(`${label} host is not allowed.`);
  }
  return parsed.toString();
}

export function asAbsolutePath(value, label = 'path') {
  const raw = asString(value, label, { max: 4096 });
  if (!path.isAbsolute(raw)) fail(`${label} must be an absolute path.`);
  return raw;
}

export function asPositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(`${label} must be a positive integer.`);
  return n;
}

// Wraps a handler so validation errors come back as a normal error result
// instead of a rejected promise the UI may not catch.
export function validated(handler) {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      if (error instanceof ValidationError) {
        console.warn(`[ipc] rejected input: ${error.message}`);
        return { error: 'InvalidInput', message: error.message };
      }
      throw error;
    }
  };
}
