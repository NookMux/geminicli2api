// Minimal TOML parser tailored for credential imports
// Supports [[table]] arrays, strings, booleans, numbers, and simple arrays.

function stripInlineComment(line) {
  let inString = false;
  let escaped = false;
  let result = '';

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '\\' && inString && !escaped) {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"' && !escaped) {
      inString = !inString;
    }

    if (char === '#' && !inString) {
      return result.trimEnd();
    }

    escaped = false;
    result += char;
  }

  return result.trimEnd();
}

function parsePrimitive(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;

  if (/^[+-]?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }

  return value;
}

function parseValue(raw) {
  const value = raw.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];

    const parts = [];
    let current = '';
    let inString = false;

    for (let i = 0; i < inner.length; i += 1) {
      const char = inner[i];
      if (char === '"') {
        inString = !inString;
        current += char;
      } else if (char === ',' && !inString) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim() !== '') parts.push(current.trim());

    return parts.map(parseValue);
  }

  return parsePrimitive(value);
}

export function parseToml(input) {
  const result = {};
  let currentArray = null;
  let currentObject = null;

  const sanitizedInput = input.replace(/^\uFEFF/, '');
  const lines = sanitizedInput.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine.trim());
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[[') && line.endsWith(']]')) {
      const section = line.slice(2, -2).trim();
      if (!result[section]) result[section] = [];
      currentArray = result[section];
      currentObject = {};
      currentArray.push(currentObject);
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = parseValue(line.slice(eqIndex + 1));

    if (currentObject) {
      currentObject[key] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

export default { parseToml };
