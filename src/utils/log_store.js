import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = process.env.REQUEST_LOG_FILE
  ? path.resolve(process.env.REQUEST_LOG_FILE)
  : path.join(__dirname, '..', '..', 'data', 'request_logs.json');
const MAX_LOGS = 5000;

function ensureDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = fs.readFileSync(LOG_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function appendLog(entry) {
  ensureDir();
  const logs = readLogs();
  logs.push(entry);
  const sliced = logs.slice(-MAX_LOGS);
  fs.writeFileSync(LOG_FILE, JSON.stringify(sliced, null, 2));
  return sliced;
}

export function getRecentLogs(limit = 200) {
  const logs = readLogs();
  if (!limit || Number.isNaN(limit)) return logs;
  return logs.slice(-limit).reverse();
}

export function getUsageCountsWithinWindow(windowMs = 60 * 60 * 1000) {
  const since = Date.now() - Math.abs(windowMs);
  const summary = {};

  readLogs().forEach(log => {
    const timestamp = Date.parse(log.timestamp || '');
    if (Number.isNaN(timestamp) || timestamp < since) return;

    const key = log.projectId || '未知项目';
    if (!summary[key]) {
      summary[key] = { count: 0, success: 0, failed: 0, lastUsedAt: null };
    }

    summary[key].count += 1;
    summary[key].lastUsedAt = log.timestamp || summary[key].lastUsedAt;
    if (log.success) {
      summary[key].success += 1;
    } else {
      summary[key].failed += 1;
    }
  });

  return Object.entries(summary)
    .map(([projectId, stats]) => ({ projectId, ...stats }))
    .sort((a, b) => b.count - a.count);
}

export function getUsageCountSince(projectId, sinceTimestampMs) {
  if (!projectId) return 0;

  const since = Number.isFinite(Number(sinceTimestampMs))
    ? Number(sinceTimestampMs)
    : Date.now() - 60 * 60 * 1000;

  return readLogs().filter(log => {
    if (!log?.projectId || log.projectId !== projectId) return false;
    if (log.success === false) return false;

    const timestamp = Date.parse(log.timestamp || '');
    if (Number.isNaN(timestamp)) return false;

    return timestamp >= since;
  }).length;
}

export function getUsageSummary() {
  const logs = readLogs();
  const summary = {};

  logs.forEach(log => {
    const key = log.projectId || '未知项目';
    if (!summary[key]) {
      summary[key] = {
        total: 0,
        success: 0,
        failed: 0,
        lastUsedAt: null,
        models: new Set()
      };
    }

    summary[key].total += 1;
    summary[key].models.add(log.model || '未指定模型');
    if (log.success) {
      summary[key].success += 1;
    } else {
      summary[key].failed += 1;
    }
    summary[key].lastUsedAt = log.timestamp || summary[key].lastUsedAt;
  });

  // Convert Set to array for serialization convenience
  Object.keys(summary).forEach(key => {
    summary[key].models = Array.from(summary[key].models);
  });

  return summary;
}

