import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseToml } from '../utils/tomlParser.js';
import {
  generateAssistantResponse,
  generateAssistantResponseNoStream,
  getAvailableModels,
  closeRequester,
  generateGeminiContent,
  streamGeminiContent
} from '../api/client.js';
import { generateRequestBody } from '../utils/utils.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import tokenManager from '../auth/token_manager.js';
import { buildAuthUrl, exchangeCodeForToken } from '../auth/oauth_client.js';
import {
  appendLog,
  getRecentLogs,
  getUsageCountsWithinWindow,
  getUsageSummary
} from '../utils/log_store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const ACCOUNTS_FILE = path.join(__dirname, '..', '..', 'data', 'accounts.json');
const OAUTH_STATE = crypto.randomUUID();
const PANEL_USER = process.env.PANEL_USER || 'admin';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || null;
const PANEL_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 管理面板登录有效期：2 小时

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function maskSecret(value) {
  if (value === undefined || value === null) return null;
  const str = String(value);
  if (!str) return null;
  if (str.length <= 4) return '****';
  return `${str.slice(0, 2)}${'*'.repeat(Math.max(4, str.length - 4))}${str.slice(-2)}`;
}

function buildSettingsSummary() {
  const groups = new Map();

  SETTINGS_DEFINITIONS.forEach(def => {
    const envValue = process.env[def.key];
    const envNormalized = normalizeValue(envValue);
    const defaultNormalized = normalizeValue(def.defaultValue ?? null);
    const resolved = normalizeValue(def.valueResolver ? def.valueResolver() : envValue ?? def.defaultValue);

    const isDefault =
      envValue === undefined ||
      envValue === null ||
      envValue === '' ||
      (defaultNormalized !== null && envNormalized === String(defaultNormalized));

    const item = {
      key: def.key,
      label: def.label || def.key,
      value: def.sensitive ? maskSecret(resolved) : resolved,
      defaultValue: defaultNormalized,
      source: isDefault ? 'default' : 'env',
      sensitive: !!def.sensitive,
      isDefault,
      isMissing: resolved === null,
      description: def.description || ''
    };

    const groupName = def.category || '未分组';
    if (!groups.has(groupName)) {
      groups.set(groupName, { name: groupName, items: [] });
    }
    groups.get(groupName).items.push(item);
  });

  return Array.from(groups.values());
}

const SETTINGS_DEFINITIONS = [
  {
    key: 'PANEL_USER',
    label: '面板登录用户名',
    category: '面板与安全',
    defaultValue: 'admin',
    valueResolver: () => PANEL_USER
  },
  {
    key: 'PANEL_PASSWORD',
    label: '面板登录密码',
    category: '面板与安全',
    defaultValue: null,
    sensitive: true,
    valueResolver: () => (PANEL_PASSWORD ? '已配置' : null),
    description: '用于保护管理界面，未配置将拒绝启动'
  },
  {
    key: 'API_KEY',
    label: 'API 密钥',
    category: '面板与安全',
    defaultValue: null,
    sensitive: true,
    valueResolver: () => process.env.API_KEY || null,
    description: '保护 /v1/* 端点的访问'
  },
  {
    key: 'MAX_REQUEST_SIZE',
    label: '最大请求体',
    category: '面板与安全',
    defaultValue: '50mb',
    valueResolver: () => config.security.maxRequestSize
  },
  {
    key: 'PORT',
    label: '服务端口',
    category: '服务与网络',
    defaultValue: 8045,
    valueResolver: () => config.server.port
  },
  {
    key: 'HOST',
    label: '监听地址',
    category: '服务与网络',
    defaultValue: '0.0.0.0',
    valueResolver: () => process.env.HOST || config.server.host
  },
  {
    key: 'API_URL',
    label: '流式接口 URL',
    category: '服务与网络',
    defaultValue:
      'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
    valueResolver: () => config.api.url
  },
  {
    key: 'API_MODELS_URL',
    label: '模型列表 URL',
    category: '服务与网络',
    defaultValue: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
    valueResolver: () => config.api.modelsUrl
  },
  {
    key: 'API_NO_STREAM_URL',
    label: '非流式接口 URL',
    category: '服务与网络',
    defaultValue:
      'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
    valueResolver: () => config.api.noStreamUrl
  },
  {
    key: 'API_HOST',
    label: 'API Host 头',
    category: '服务与网络',
    defaultValue: 'daily-cloudcode-pa.sandbox.googleapis.com',
    valueResolver: () => config.api.host
  },
  {
    key: 'API_USER_AGENT',
    label: 'User-Agent',
    category: '服务与网络',
    defaultValue: 'antigravity/1.11.3 windows/amd64',
    valueResolver: () => config.api.userAgent
  },
  {
    key: 'PROXY',
    label: 'HTTP 代理',
    category: '服务与网络',
    defaultValue: null,
    valueResolver: () => config.proxy
  },
  {
    key: 'TIMEOUT',
    label: '请求超时(ms)',
    category: '服务与网络',
    defaultValue: 180000,
    valueResolver: () => config.timeout
  },
  {
    key: 'USE_NATIVE_AXIOS',
    label: '使用原生 Axios',
    category: '服务与网络',
    defaultValue: 'false',
    valueResolver: () => config.useNativeAxios
  },
  {
    key: 'DEFAULT_TEMPERATURE',
    label: '默认温度',
    category: '生成参数',
    defaultValue: 1,
    valueResolver: () => config.defaults.temperature
  },
  {
    key: 'DEFAULT_TOP_P',
    label: '默认 top_p',
    category: '生成参数',
    defaultValue: 0.85,
    valueResolver: () => config.defaults.top_p
  },
  {
    key: 'DEFAULT_TOP_K',
    label: '默认 top_k',
    category: '生成参数',
    defaultValue: 50,
    valueResolver: () => config.defaults.top_k
  },
  {
    key: 'DEFAULT_MAX_TOKENS',
    label: '默认最大 Tokens',
    category: '生成参数',
    defaultValue: 8096,
    valueResolver: () => config.defaults.max_tokens
  },
  {
    key: 'SYSTEM_INSTRUCTION',
    label: '系统提示词',
    category: '生成参数',
    defaultValue:
      '你是聊天机器人，名字叫萌萌，如同名字这般，你的性格是软软糯糯萌萌哒的，专门为用户提供聊天和情绪价值，协助进行小说创作或者角色扮演',
    valueResolver: () => config.systemInstruction
  },
  {
    key: 'CREDENTIAL_MAX_USAGE_PER_HOUR',
    label: '凭证每小时调用上限',
    category: '限额与重试',
    defaultValue: 20,
    valueResolver: () => config.credentials.maxUsagePerHour
  },
  {
    key: 'RETRY_STATUS_CODES',
    label: '重试状态码',
    category: '限额与重试',
    defaultValue: '429,500',
    valueResolver: () => config.retry.statusCodes
  },
  {
    key: 'RETRY_MAX_ATTEMPTS',
    label: '最大重试次数',
    category: '限额与重试',
    defaultValue: 3,
    valueResolver: () => config.retry.maxAttempts
  },
  {
    key: 'MAX_IMAGES',
    label: '图片保存上限',
    category: '限额与重试',
    defaultValue: 10,
    valueResolver: () => config.maxImages
  },
  {
    key: 'IMAGE_BASE_URL',
    label: '图片访问基础 URL',
    category: '限额与重试',
    defaultValue: null,
    valueResolver: () => config.imageBaseUrl
  }
];

// 为了防止误配置导致管理面板完全裸露，这里强制要求配置 PANEL_PASSWORD
if (!PANEL_PASSWORD) {
  logger.error(
    'PANEL_PASSWORD 环境变量未配置，出于安全考虑服务将不会启动，请在 .env 或环境变量中设置 PANEL_PASSWORD。'
  );
  process.exit(1);
}

// 启动时校验必须存在的环境变量，防止无认证暴露
if (!process.env.PANEL_USER) {
  logger.error(
    'PANEL_USER 环境变量未配置，出于安全考虑服务将不会启动，请在 .env 或环境变量中设置 PANEL_USER。'
  );
  process.exit(1);
}

if (!process.env.API_KEY) {
  logger.error(
    'API_KEY 环境变量未配置，出于安全考虑服务将不会启动，请在 .env 或环境变量中设置 API_KEY。'
  );
  process.exit(1);
}

const PANEL_AUTH_ENABLED = !!PANEL_PASSWORD;
// 使用内存 Map 保存会话：token -> 过期时间戳
const panelSessions = new Map();

// ===== Helper functions for OpenAI-compatible responses =====

const createResponseMeta = () => ({
  id: `chatcmpl-${Date.now()}`,
  created: Math.floor(Date.now() / 1000)
});

const setStreamHeaders = res => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
};

const createStreamChunk = (id, created, model, delta, finish_reason = null, usage = null) => ({
  id,
  object: 'chat.completion.chunk',
  created,
  model,
  choices: [{ index: 0, delta, finish_reason }],
  ...(usage ? { usage } : {})
});

const writeStreamData = (res, data) => {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const endStream = (res, id, created, model, finish_reason, usage = null) => {
  writeStreamData(res, createStreamChunk(id, created, model, {}, finish_reason, usage));
  res.write('data: [DONE]\n\n');
  res.end();
};

// ===== Global middleware =====

app.use(express.json({ limit: config.security.maxRequestSize }));
app.use(express.urlencoded({ extended: false }));

// Static images for generated image URLs
app.use('/images', express.static(path.join(__dirname, '../../public/images')));

// Request body size error handler
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ error: `Request entity too large, max ${config.security.maxRequestSize}` });
  }
  return next(err);
});

// Basic request logging (skip images / favicon)
app.use((req, res, next) => {
  if (!req.path.startsWith('/images') && !req.path.startsWith('/favicon.ico')) {
    const start = Date.now();
    res.on('finish', () => {
      logger.request(req.method, req.path, res.statusCode, Date.now() - start);
    });
  }
  next();
});

// 根路径：未登录时跳转登录页，已登录则进入管理面板
app.get('/', (req, res) => {
  if (isPanelAuthed(req)) {
    return res.redirect('/admin/oauth');
  }
  return res.redirect('/admin/login');
});

// API key check for /v1/*、/gemini/* 以及 /{credential}/v1/* endpoints（API_KEY 在启动时强制要求配置）
const isProtectedApiPath = pathname => {
  const normalized = pathname || '';
  return /^\/(?:[\w-]+\/)?v1\//.test(normalized) || normalized.startsWith('/gemini/');
};

app.use((req, res, next) => {
  if (isProtectedApiPath(req.path)) {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
      const authHeader = req.headers.authorization;
      const providedKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;
      if (providedKey !== apiKey) {
        logger.warn(`API Key验证失败: ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Invalid API Key' });
      }
    }
  }
  next();
});

// 简单健康检查接口，用于 Docker / 监控探活
app.get('/healthz', (req, res) => {
  const now = new Date();
  const serverTime = now.toISOString();
  const deltaMinutes = 8 * 60 + now.getTimezoneOffset();
  const chinaDate = new Date(now.getTime() + deltaMinutes * 60000);
  const chinaTime = chinaDate.toISOString();

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    serverTime,
    chinaTime
  });
});

// ===== OAuth + simple admin panel =====

function getSessionTokenFromReq(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const item = cookie
    .split(';')
    .map(s => s.trim())
    .find(c => c.startsWith('panel_session='));
  if (!item) return null;
  return decodeURIComponent(item.slice('panel_session='.length));
}

function isPanelAuthed(req) {
  if (!PANEL_AUTH_ENABLED) return true;
  const token = getSessionTokenFromReq(req);
  if (!token) return false;

  const expiresAt = panelSessions.get(token);
  if (!expiresAt) return false;

  // 超过有效期自动失效并清理
  if (Date.now() > expiresAt) {
    panelSessions.delete(token);
    return false;
  }

  return true;
}

function requirePanelAuthPage(req, res, next) {
  if (!PANEL_AUTH_ENABLED) return next();
  if (isPanelAuthed(req)) return next();
  return res.redirect('/admin/login');
}

function requirePanelAuthApi(req, res, next) {
  if (!PANEL_AUTH_ENABLED) return next();
  if (isPanelAuthed(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function readAccountsSafe() {
  const usageMap = getUsageSummary();
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return [];
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((acc, index) => ({
      index,
      projectId: acc.projectId || null,
      enable: acc.enable !== false,
      hasRefreshToken: !!acc.refresh_token,
      createdAt: acc.timestamp || null,
      expiresIn: acc.expires_in || null,
      usage: usageMap[acc.projectId] || {
        total: 0,
        success: 0,
        failed: 0,
        lastUsedAt: null,
        models: []
      }
    }));
  } catch (e) {
    logger.error(`读取 accounts.json 失败: ${e.message}`);
    return [];
  }
}

function parseTimestamp(raw) {
  if (raw && Number.isFinite(Number(raw.timestamp))) {
    return Number(raw.timestamp);
  }

  const dateString = raw?.created_at || raw?.createdAt;
  if (dateString) {
    const parsed = Date.parse(dateString);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return Date.now();
}

function normalizeTomlAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const accessToken = raw.access_token ?? raw.accessToken;
  const refreshToken = raw.refresh_token ?? raw.refreshToken;

  // 只导入在 TOML 中显式标记 disabled = true 的账号，其它全部跳过
  if (raw.disabled !== true) return null;

  if (!accessToken || !refreshToken) return null;

  const normalized = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number.isFinite(Number(raw.expires_in ?? raw.expiresIn))
      ? Number(raw.expires_in ?? raw.expiresIn)
      : 3600,
    timestamp: parseTimestamp(raw),
    // 导入后在本系统中默认启用
    enable: true
  };

  const projectId = raw.projectId ?? raw.project_id;
  if (projectId) normalized.projectId = projectId;

  const copyPairs = [
    ['email', 'email'],
    ['user_id', 'user_id'],
    ['userId', 'user_id'],
    ['user_email', 'user_email'],
    ['userEmail', 'user_email'],
    ['last_used', 'last_used'],
    ['lastUsed', 'last_used'],
    ['created_at', 'created_at'],
    ['createdAt', 'created_at'],
    ['next_reset_time', 'next_reset_time'],
    ['nextResetTime', 'next_reset_time'],
    ['daily_limit_claude', 'daily_limit_claude'],
    ['dailyLimitClaude', 'daily_limit_claude'],
    ['daily_limit_gemini', 'daily_limit_gemini'],
    ['dailyLimitGemini', 'daily_limit_gemini'],
    ['daily_limit_total', 'daily_limit_total'],
    ['dailyLimitTotal', 'daily_limit_total'],
    ['claude_sonnet_4_5_calls', 'claude_sonnet_4_5_calls'],
    ['gemini_3_pro_calls', 'gemini_3_pro_calls'],
    ['total_calls', 'total_calls'],
    ['last_success', 'last_success'],
    ['error_codes', 'error_codes'],
    ['gemini_3_series_banned_until', 'gemini_3_series_banned_until']
  ];

  for (const [source, target] of copyPairs) {
    if (raw[source] !== undefined) {
      normalized[target] = raw[source];
    }
  }

  return normalized;
}

function mergeAccounts(existing, incoming, replaceExisting = false) {
  if (replaceExisting) return incoming;

  const map = new Map();

  existing.forEach((acc, idx) => {
    const key = acc.refresh_token || acc.access_token || `existing-${idx}`;
    map.set(key, acc);
  });

  incoming.forEach((acc, idx) => {
    const key = acc.refresh_token || acc.access_token || `incoming-${idx}`;
    const current = map.get(key) || {};
    map.set(key, { ...current, ...acc });
  });

  return Array.from(map.values());
}

// Simple login page for admin panel
app.get('/admin/login', (req, res) => {
  if (!PANEL_AUTH_ENABLED) {
    return res.send(
      '<h1>管理面板未启用登录</h1><p>未配置 PANEL_PASSWORD 环境变量，当前不启用面板密码保护。</p><p><a href="/admin/oauth">进入 OAuth 管理面板</a></p>'
    );
  }

  if (isPanelAuthed(req)) {
    return res.redirect('/admin/oauth');
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Antigravity 管理登录</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f5f7fb; margin:0; padding:0; }
    .container { max-width: 420px; margin:80px auto; background:#ffffff; border-radius:12px; box-shadow:0 8px 24px rgba(15,23,42,0.08); padding:24px 28px; }
    h1 { font-size:20px; margin:0 0 12px; color:#111827; }
    label { display:block; margin-top:12px; font-size:13px; color:#374151; }
    input { width:100%; margin-top:4px; padding:8px 10px; font-size:14px; border-radius:8px; border:1px solid #d1d5db; box-sizing:border-box; }
    button { margin-top:18px; width:100%; background:#3b82f6; color:#fff; border:none; border-radius:999px; padding:10px 18px; font-size:14px; cursor:pointer; }
    button:hover { background:#2563eb; }
    .hint { font-size:12px; color:#6b7280; margin-top:8px; }
    .error { font-size:13px; color:#b91c1c; margin-top:8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>管理登录</h1>
    <form method="POST" action="/admin/login">
      <label>用户名
        <input name="username" autocomplete="username" value="admin" />
      </label>
      <label>密码
        <input type="password" name="password" autocomplete="current-password" />
      </label>
      <button type="submit">登录</button>
      <div class="hint">默认用户名为 admin，密码由环境变量 PANEL_PASSWORD 配置。</div>
    </form>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.post('/admin/login', (req, res) => {
  if (!PANEL_AUTH_ENABLED) {
    return res.redirect('/admin/oauth');
  }

  const { username, password } = req.body || {};
  if (username === PANEL_USER && password === PANEL_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + PANEL_SESSION_TTL_MS;
    panelSessions.set(token, expiresAt);
    res.setHeader(
      'Set-Cookie',
      `panel_session=${encodeURIComponent(
        token
      )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
        PANEL_SESSION_TTL_MS / 1000
      )}`
    );
    return res.redirect('/admin/oauth');
  }

  return res
    .status(401)
    .send('<h1>登录失败</h1><p>用户名或密码错误。</p><p><a href="/admin/login">返回重试</a></p>');
});

// Logout endpoint for admin panel
app.post('/admin/logout', (req, res) => {
  const token = getSessionTokenFromReq(req);
  if (token) {
    panelSessions.delete(token);
  }

  res.setHeader(
    'Set-Cookie',
    'panel_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  );

  if (req.accepts('json')) {
    return res.json({ success: true });
  }

  return res.redirect('/admin/login');
});

// Return Google OAuth URL as JSON for front-end
// 前端现在采用“手动粘贴回调 URL”模式，这里仍然返回带 redirect_uri 的完整授权链接
  app.get('/auth/oauth/url', requirePanelAuthApi, (req, res) => {
    const redirectUri = `http://localhost:${config.server.port}/oauth-callback`;

    const url = buildAuthUrl(redirectUri, OAUTH_STATE);
    res.json({ url });
  });

// 仅作为提示页面使用：不再在这里直接交换 token
// 用户在完成授权后，需要复制浏览器地址栏中的完整 URL，回到管理面板粘贴，由新的解析接口处理
app.get(['/oauth-callback', '/auth/oauth/callback'], (req, res) => {
  return res.send(
    '<!DOCTYPE html>' +
      '<html lang="zh-CN"><head><meta charset="utf-8" />' +
      '<title>授权回调 - 请复制地址栏 URL</title>' +
      '<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f9fafb;margin:0;padding:24px;color:#111827;}h1{font-size:20px;margin:0 0 12px;}p{margin:6px 0;}code{padding:2px 4px;background:#e5e7eb;border-radius:4px;}</style>' +
      '</head><body>' +
      '<h1>授权流程已返回回调地址</h1>' +
      '<p>请复制当前页面浏览器地址栏中的完整 URL，回到 <code>Antigravity</code> 管理面板，在“粘贴回调 URL”输入框中粘贴并提交。</p>' +
      '<p>提交后，服务端会解析 URL 中的 <code>code</code> 参数并完成账户添加。</p>' +
      '</body></html>'
  );
});

// 解析用户粘贴的回调 URL，交换 code 为 token，写入 accounts.json 并刷新 TokenManager
app.post('/auth/oauth/parse-url', requirePanelAuthApi, async (req, res) => {
  const { url, replaceIndex } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url 字段必填且必须为字符串' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: '无效的 URL，无法解析' });
  }

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');

  if (!code) {
    return res.status(400).json({ error: 'URL 中缺少 code 参数' });
  }

  if (state && state !== OAUTH_STATE) {
    logger.warn('OAuth state mismatch in pasted URL, possible CSRF or wrong URL.');
    return res.status(400).json({ error: 'state 校验失败，请确认粘贴的是最新的授权回调地址' });
  }

  // redirectUri 必须与构造授权链接时保持一致，这里直接使用粘贴 URL 的 origin + pathname
  const redirectUri = `${parsed.origin}${parsed.pathname}`;

  try {
    const tokenData = await exchangeCodeForToken(code, redirectUri);
    const account = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      timestamp: Date.now()
    };

    let accounts = [];
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      }
    } catch {
      logger.warn('Failed to read accounts.json, will create new file');
    }

    if (!Array.isArray(accounts)) accounts = [];
    if (Number.isInteger(replaceIndex) && replaceIndex >= 0 && replaceIndex < accounts.length) {
      accounts[replaceIndex] = account;
    } else {
      accounts.push(account);
    }

    const dir = path.dirname(ACCOUNTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');

    // Reload TokenManager so new account becomes usable without restart
    if (typeof tokenManager.initialize === 'function') {
      tokenManager.initialize();
    }

    logger.info(`Token 已保存到 ${ACCOUNTS_FILE}`);

    return res.json({ success: true });
  } catch (e) {
    logger.error('OAuth 交换 token 失败:', e.message);
    return res.status(500).json({ error: `交换 token 失败: ${e.message}` });
  }
});

// Import accounts from TOML and merge into accounts.json
app.post('/auth/accounts/import-toml', requirePanelAuthApi, (req, res) => {
  const { toml: tomlContent, replaceExisting = false } = req.body || {};

  if (!tomlContent || typeof tomlContent !== 'string') {
    return res.status(400).json({ error: 'toml 字段必填且必须为字符串' });
  }

  let parsed;
  try {
    parsed = parseToml(tomlContent);
  } catch (e) {
    return res.status(400).json({ error: `TOML 解析失败: ${e.message}` });
  }

  const accountsFromToml = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  if (accountsFromToml.length === 0) {
    return res.status(400).json({ error: '未在 TOML 中找到 accounts 列表' });
  }

  const normalized = [];
  let skipped = 0;

  for (const raw of accountsFromToml) {
    const acc = normalizeTomlAccount(raw);
    if (acc) {
      normalized.push(acc);
    } else {
      skipped += 1;
    }
  }

  if (normalized.length === 0) {
    return res.status(400).json({ error: 'TOML 中没有有效的账号信息' });
  }

  let existing = [];
  if (!replaceExisting && fs.existsSync(ACCOUNTS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      if (!Array.isArray(existing)) existing = [];
    } catch (e) {
      logger.warn(`读取 accounts.json 失败，将忽略已有账号: ${e.message}`);
      existing = [];
    }
  }

  const merged = mergeAccounts(existing, normalized, replaceExisting);

  const dir = path.dirname(ACCOUNTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(merged, null, 2), 'utf-8');

  if (typeof tokenManager.initialize === 'function') {
    tokenManager.initialize();
  }

  return res.json({
    success: true,
    imported: normalized.length,
    skipped,
    total: merged.length
  });
});

// Simple JSON list of accounts for front-end
app.get('/auth/accounts', requirePanelAuthApi, (req, res) => {
  res.json({ accounts: readAccountsSafe() });
});

// Manually refresh a single account by index
app.post('/auth/accounts/:index/refresh', requirePanelAuthApi, async (req, res) => {
  const index = Number.parseInt(req.params.index, 10);
  if (Number.isNaN(index)) return res.status(400).json({ error: '无效的账号序号' });

  try {
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    const target = accounts[index];
    if (!target) return res.status(404).json({ error: '账号不存在' });
    await tokenManager.refreshToken(target);
    accounts[index] = target;
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
    tokenManager.initialize();
    res.json({ success: true });
  } catch (e) {
    logger.error('刷新账号失败', e.message);
    res.status(500).json({ error: e.message || '刷新失败' });
  }
});

// Delete an account
app.delete('/auth/accounts/:index', requirePanelAuthApi, (req, res) => {
  const index = Number.parseInt(req.params.index, 10);
  if (Number.isNaN(index)) return res.status(400).json({ error: '无效的账号序号' });

  try {
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    if (!accounts[index]) return res.status(404).json({ error: '账号不存在' });
    accounts.splice(index, 1);
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
    tokenManager.initialize();
    res.json({ success: true });
  } catch (e) {
    logger.error('删除账号失败', e.message);
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

// Toggle enable/disable for an account
app.post('/auth/accounts/:index/enable', requirePanelAuthApi, (req, res) => {
  const index = Number.parseInt(req.params.index, 10);
  const { enable = true } = req.body || {};
  if (Number.isNaN(index)) return res.status(400).json({ error: '无效的账号序号' });

  try {
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    if (!accounts[index]) return res.status(404).json({ error: '账号不存在' });
    accounts[index].enable = !!enable;
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
    tokenManager.initialize();
    res.json({ success: true });
  } catch (e) {
    logger.error('更新账号状态失败', e.message);
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

app.get('/admin/settings', requirePanelAuthApi, (req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    groups: buildSettingsSummary()
  });
});

app.get('/admin/logs/usage', requirePanelAuthApi, (req, res) => {
  const windowMinutes = 60;
  const limitPerCredential = 20;
  const usage = getUsageCountsWithinWindow(windowMinutes * 60 * 1000);

  res.json({ windowMinutes, limitPerCredential, usage, updatedAt: new Date().toISOString() });
});

// Recent request logs
app.get('/admin/logs', requirePanelAuthApi, (req, res) => {
  const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 200;
  res.json({ logs: getRecentLogs(limit) });
});

// Minimal HTML admin panel for OAuth (served as static file)
app.get('/admin/oauth', requirePanelAuthPage, (req, res) => {
  const filePath = path.join(__dirname, '..', '..', 'public', 'admin', 'index.html');
  res.sendFile(filePath);
});

// Static assets for admin panel（同样要求登录后才能访问）
const adminStatic = express.static(path.join(__dirname, '..', '..', 'public', 'admin'));
app.use('/admin', (req, res, next) => {
  // 复用页面级的鉴权逻辑，未登录则重定向到 /admin/login
  requirePanelAuthPage(req, res, err => {
    if (err) return next(err);
    return adminStatic(req, res, next);
  });
});

// ===== API routes =====

const createChatCompletionHandler = (resolveToken, options = {}) => async (req, res) => {
  const { messages, model, stream = true, tools, ...params } = req.body || {};

  let token = null;
  try {
    if (!messages) {
      return res.status(400).json({ error: 'messages is required' });
    }

    token = await resolveToken(req);
    if (!token) {
      const message =
        options.tokenMissingError || '没有可用的 token，请先通过 OAuth 面板或 npm run login 获取。';
      const status = options.tokenMissingStatus || 503;
      return res.status(status).json({ error: message });
    }

    const isImageModel = typeof model === 'string' && model.includes('-image');
    const requestBody = generateRequestBody(messages, model, params, tools, token);

    if (isImageModel) {
      requestBody.request.generationConfig = {
        candidateCount: 1
        // imageConfig: { aspectRatio: '1:1' }
      };
      requestBody.requestType = 'image_gen';
      requestBody.request.systemInstruction.parts[0].text +=
        '（当前作为图像生成模型使用，请根据描述生成图片）';
      delete requestBody.request.tools;
      delete requestBody.request.toolConfig;
    }

    const { id, created } = createResponseMeta();

    if (stream) {
      setStreamHeaders(res);

      if (isImageModel) {
        const { content, usage } = await generateAssistantResponseNoStream(requestBody, token);
        writeStreamData(res, createStreamChunk(id, created, model, { content }));
        endStream(res, id, created, model, 'stop', usage);
      } else {
        let hasToolCall = false;
        const { usage } = await generateAssistantResponse(requestBody, token, data => {
          const delta =
            data.type === 'tool_calls'
              ? { tool_calls: data.tool_calls }
              : { content: data.content };
          if (data.type === 'tool_calls') hasToolCall = true;
          writeStreamData(res, createStreamChunk(id, created, model, delta));
        });
        endStream(res, id, created, model, hasToolCall ? 'tool_calls' : 'stop', usage);
      }
    } else {
      const { content, toolCalls, usage } = await generateAssistantResponseNoStream(
        requestBody,
        token
      );
      const message = { role: 'assistant', content };
      if (toolCalls.length > 0) message.tool_calls = toolCalls;

      res.json({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message,
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
          }
        ],
        usage: usage || null
      });
    }

    appendLog({
      timestamp: new Date().toISOString(),
      model,
      projectId: token?.projectId || null,
      success: true
    });
  } catch (error) {
    logger.error('生成响应失败:', error.message);
    appendLog({
      timestamp: new Date().toISOString(),
      model: model || req.body?.model || 'unknown',
      projectId: token?.projectId || null,
      success: false,
      message: error.message
    });
    if (!res.headersSent) {
      const { id, created } = createResponseMeta();
      const errorContent = `错误: ${error.message}`;

      if (stream) {
        setStreamHeaders(res);
        writeStreamData(
          res,
          createStreamChunk(id, created, model || 'unknown', { content: errorContent })
        );
        endStream(res, id, created, model || 'unknown', 'stop');
      } else {
        const status = error.statusCode || 500;
        res.status(status).json({
          id,
          object: 'chat.completion',
          created,
          model: model || 'unknown',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: errorContent },
              finish_reason: 'stop'
            }
          ]
        });
      }
    }
  }
};

app.get('/v1/models', async (req, res) => {
  try {
    const models = await getAvailableModels();
    res.json(models);
  } catch (error) {
    logger.error('获取模型列表失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/v1/lits', (req, res) => {
  const limitPerCredential = Number.isFinite(Number(config.credentials?.maxUsagePerHour))
    ? Number(config.credentials.maxUsagePerHour)
    : null;
  const usageMap = new Map(
    getUsageCountsWithinWindow(60 * 60 * 1000).map(item => [item.projectId, item.count])
  );

  const credentials = (tokenManager.tokens || [])
    .filter(token => token.enable !== false)
    .map(token => {
      const used = usageMap.get(token.projectId) || 0;
      const remaining = limitPerCredential === null ? null : Math.max(limitPerCredential - used, 0);
      return {
        name: token.projectId,
        used_per_hour: used,
        remaining_per_hour: remaining
      };
    });

  res.json({
    credentials,
    windowMinutes: 60,
    limitPerCredential,
    updatedAt: new Date().toISOString()
  });
});

app.post('/v1/chat/completions', createChatCompletionHandler(() => tokenManager.getToken()));
app.post(
  '/:credential/v1/chat/completions',
  createChatCompletionHandler(
    req => tokenManager.getTokenByProjectId(req.params.credential),
    { tokenMissingError: '指定的凭证不存在或已停用，请检查凭证名。', tokenMissingStatus: 404 }
  )
);

app.post(/^\/gemini\/v1beta\/models\/([^/]+):streamGenerateContent$/, async (req, res) => {
  const model = req.params[0];

  try {
    const token = await tokenManager.getToken();
    if (!token) {
      throw new Error('没有可用的 token，请先通过 OAuth 面板或 npm run login 获取。');
    }

    setStreamHeaders(res);
    await streamGeminiContent(model, req.body || {}, token, chunk => res.write(chunk));
    res.end();
  } catch (error) {
    logger.error('Gemini 流式生成失败:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.post(/^\/gemini\/v1beta\/models\/([^/]+):generateContent$/, async (req, res) => {
  const model = req.params[0];

  try {
    const token = await tokenManager.getToken();
    if (!token) {
      throw new Error('没有可用的 token，请先通过 OAuth 面板或 npm run login 获取。');
    }

    const data = await generateGeminiContent(model, req.body || {}, token);
    res.json(data);
  } catch (error) {
    logger.error('Gemini 文本生成失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== Server bootstrap =====

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`服务已启动: ${config.server.host}:${config.server.port}`);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`端口 ${config.server.port} 已被占用`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    logger.error(`端口 ${config.server.port} 无权限访问`);
    process.exit(1);
  } else {
    logger.error('服务启动失败:', error.message);
    process.exit(1);
  }
});

const shutdown = () => {
  logger.info('正在关闭服务...');
  closeRequester();
  server.close(() => {
    logger.info('服务已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
