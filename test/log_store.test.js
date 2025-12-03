import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const tempDir = path.join(tmpdir(), 'log-store-tests');
fs.mkdirSync(tempDir, { recursive: true });
const logFile = path.join(tempDir, `request_logs_${randomUUID()}.json`);

process.env.REQUEST_LOG_FILE = logFile;

const { appendLog, readLogs, getRecentLogs, getUsageCountsWithinWindow } = await import(
  '../src/utils/log_store.js'
);

test.beforeEach(() => {
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }
});

test.after(() => {
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }
});

test('appendLog writes entries that can be read back', () => {
  const entry = { timestamp: new Date().toISOString(), projectId: 'projA', success: true };
  appendLog(entry);

  const logs = readLogs();
  assert.strictEqual(logs.length, 1);
  assert.deepStrictEqual(logs[0], entry);
});

test('getRecentLogs returns newest-first limited list', () => {
  const now = Date.now();
  appendLog({ timestamp: new Date(now - 2000).toISOString(), projectId: 'projA', success: true });
  appendLog({ timestamp: new Date(now - 1000).toISOString(), projectId: 'projB', success: false });
  appendLog({ timestamp: new Date(now).toISOString(), projectId: 'projC', success: true });

  const recent = getRecentLogs(2);
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].projectId, 'projC');
  assert.strictEqual(recent[1].projectId, 'projB');
});

test('getUsageCountsWithinWindow aggregates recent successes and failures', () => {
  const now = Date.now();
  const withinWindow = new Date(now - 5 * 60 * 1000).toISOString();
  const older = new Date(now - 40 * 60 * 1000).toISOString();

  appendLog({ timestamp: withinWindow, projectId: 'projA', success: true });
  appendLog({ timestamp: withinWindow, projectId: 'projA', success: false });
  appendLog({ timestamp: older, success: true }); // 未知项目，超出窗口

  const usage = getUsageCountsWithinWindow(30 * 60 * 1000);
  assert.strictEqual(usage.length, 1);
  assert.strictEqual(usage[0].projectId, 'projA');
  assert.strictEqual(usage[0].count, 2);
  assert.strictEqual(usage[0].success, 1);
  assert.strictEqual(usage[0].failed, 1);
  assert.strictEqual(usage[0].lastUsedAt, withinWindow);
});
