import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  generateAssistantResponse,
  generateAssistantResponseNoStream,
  getAvailableModels,
  closeRequester
} from '../api/client.js';
import { generateRequestBody } from '../utils/utils.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import tokenManager from '../auth/token_manager.js';
import { buildAuthUrl, exchangeCodeForToken } from '../auth/oauth_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const ACCOUNTS_FILE = path.join(__dirname, '..', '..', 'data', 'accounts.json');
const OAUTH_STATE = crypto.randomUUID();
const PANEL_USER = process.env.PANEL_USER || 'admin';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || null;
const PANEL_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 管理面板登录有效期：2 小时

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

const createStreamChunk = (id, created, model, delta, finish_reason = null) => ({
  id,
  object: 'chat.completion.chunk',
  created,
  model,
  choices: [{ index: 0, delta, finish_reason }]
});

const writeStreamData = (res, data) => {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const endStream = (res, id, created, model, finish_reason) => {
  writeStreamData(res, createStreamChunk(id, created, model, {}, finish_reason));
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

// API key check for /v1/* endpoints（API_KEY 在启动时强制要求配置）
app.use((req, res, next) => {
  if (req.path.startsWith('/v1/')) {
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
      expiresIn: acc.expires_in || null
    }));
  } catch (e) {
    logger.error(`读取 accounts.json 失败: ${e.message}`);
    return [];
  }
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
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .toString()
    .split(',')[0];
  const base = `${proto}://${host}`;
  const redirectUri = `${base}/auth/oauth/callback`;

  const url = buildAuthUrl(redirectUri, OAUTH_STATE);
  res.json({ url });
});

// 仅作为提示页面使用：不再在这里直接交换 token
// 用户在完成授权后，需要复制浏览器地址栏中的完整 URL，回到管理面板粘贴，由新的解析接口处理
app.get('/auth/oauth/callback', (req, res) => {
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
  const { url } = req.body || {};

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
    accounts.push(account);

    const dir = path.dirname(ACCOUNTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));

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

// Simple JSON list of accounts for front-end
app.get('/auth/accounts', requirePanelAuthApi, (req, res) => {
  res.json({ accounts: readAccountsSafe() });
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

app.get('/v1/models', async (req, res) => {
  try {
    const models = await getAvailableModels();
    res.json(models);
  } catch (error) {
    logger.error('获取模型列表失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model, stream = true, tools, ...params } = req.body || {};

  try {
    if (!messages) {
      return res.status(400).json({ error: 'messages is required' });
    }

    const token = await tokenManager.getToken();
    if (!token) {
      throw new Error('没有可用的 token，请先通过 OAuth 面板或 npm run login 获取。');
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
        const { content } = await generateAssistantResponseNoStream(requestBody, token);
        writeStreamData(res, createStreamChunk(id, created, model, { content }));
        endStream(res, id, created, model, 'stop');
      } else {
        let hasToolCall = false;
        await generateAssistantResponse(requestBody, token, data => {
          const delta =
            data.type === 'tool_calls'
              ? { tool_calls: data.tool_calls }
              : { content: data.content };
          if (data.type === 'tool_calls') hasToolCall = true;
          writeStreamData(res, createStreamChunk(id, created, model, delta));
        });
        endStream(res, id, created, model, hasToolCall ? 'tool_calls' : 'stop');
      }
    } else {
      const { content, toolCalls } = await generateAssistantResponseNoStream(
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
        ]
      });
    }
  } catch (error) {
    logger.error('生成响应失败:', error.message);
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
        res.json({
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
