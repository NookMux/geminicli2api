import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import log from '../src/utils/logger.js';
import axios from 'axios';
import config from '../src/config/config.js';
import { generateProjectId } from '../src/utils/idGenerator.js';
import { buildAuthUrl, exchangeCodeForToken } from '../src/auth/oauth_client.js';
import { fetchUserEmail } from '../src/auth/project_id_resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'accounts.json');
const STATE = crypto.randomUUID();

function getAxiosConfig() {
  const axiosConfig = { timeout: config.timeout };
  if (config.proxy) {
    const proxyUrl = new URL(config.proxy);
    axiosConfig.proxy = {
      protocol: proxyUrl.protocol.replace(':', ''),
      host: proxyUrl.hostname,
      port: parseInt(proxyUrl.port, 10)
    };
  }
  return axiosConfig;
}

async function fetchProjectId(accessToken) {
  const response = await axios({
    method: 'POST',
    url: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
    headers: {
      Host: 'daily-cloudcode-pa.sandbox.googleapis.com',
      'User-Agent': 'antigravity/1.11.9 windows/amd64',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip'
    },
    data: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    ...getAxiosConfig()
  });
  return response.data?.cloudaicompanionProject;
}

// 本地起一个极简 HTTP 服务，只负责把浏览器重定向回来的回调 URL“接住”
// 不在这里直接解析 code，而是让用户复制地址栏完整 URL 回到终端
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    '<!DOCTYPE html>' +
      '<html lang="zh-CN"><head><meta charset="utf-8" />' +
      '<title>本地授权回调</title></head><body>' +
      '<h1>授权回调已到达本地</h1>' +
      '<p>请复制当前浏览器地址栏中的完整 URL，回到终端窗口粘贴并回车。</p>' +
      '<p>脚本会解析 URL 中的 code 并完成 Token 保存。</p>' +
      '</body></html>'
  );
});

server.listen(0, () => {
  const port = server.address().port;
  const redirectUri = `http://localhost:${port}/oauth-callback`;
  const authUrl = buildAuthUrl(redirectUri, STATE);

  log.info(`本地 OAuth 回调监听在 ${redirectUri}`);
  log.info('请在浏览器中打开下面的链接完成 Google 授权：');
  console.log(`\n${authUrl}\n`);
  log.info('授权完成后，复制浏览器地址栏中的完整回调 URL，粘贴回终端并回车。');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('粘贴回调 URL 后回车：', async answer => {
    rl.close();
    const pasted = (answer || '').trim();

    if (!pasted) {
      log.error('未输入回调 URL，退出。');
      server.close();
      process.exit(1);
    }

    let url;
    try {
      url = new URL(pasted);
    } catch (e) {
      log.error('无效的 URL，无法解析。');
      server.close();
      process.exit(1);
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      log.error('回调 URL 中缺少 code 参数，无法完成授权。');
      server.close();
      process.exit(1);
    }

    if (state && state !== STATE) {
      log.error('state 校验失败，可能复制了错误的回调地址。');
      server.close();
      process.exit(1);
    }

    // 与前端模式保持一致：redirect_uri 必须与最初构建授权 URL 时一致
    const finalRedirectUri = `${url.origin}${url.pathname}`;

    try {
      log.info('正在交换 Token...');
      const tokenData = await exchangeCodeForToken(code, finalRedirectUri);

      const account = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        timestamp: Date.now()
      };

      // 获取用户邮箱
      if (tokenData.access_token) {
        try {
          const userEmail = await fetchUserEmail(tokenData.access_token);
          if (userEmail) {
            account.email = userEmail;
            log.info(`成功获取用户邮箱: ${userEmail}`);
          }
        } catch (err) {
          log.warn(`获取用户邮箱失败: ${err?.message || err}`);
        }
      }

      if (config.skipProjectIdFetch) {
        account.projectId = generateProjectId();
        account.enable = true;
        log.info(
          'skipProjectIdFetch 已启用，跳过项目验证，使用随机生成的 projectId: ' +
            account.projectId
        );
      } else if (account.access_token) {
        log.info('正在验证账号配额并获取 projectId...');
        try {
          const projectId = await fetchProjectId(account.access_token);
          if (projectId === undefined) {
            log.warn(
              '该账号无法从 API 中获取 projectId，可能无配额或未开通相关服务，本次不写入 accounts.json。'
            );
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>账号无可用配额</h1><p>未获取到 projectId，本次未保存账号。</p>');
            setTimeout(() => server.close(), 1000);
            return;
          }
          account.projectId = projectId;
          account.enable = true;
          log.info('账号验证通过，已获取到 projectId，并写入账号配置。');
        } catch (err) {
          log.error('验证账号配额失败:', err.message);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<h1>验证失败</h1><p>无法验证账号配额或获取 projectId，请检查控制台日志与网络环境。</p>'
          );
          setTimeout(() => server.close(), 1000);
          return;
        }
      }

      let accounts = [];
      try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
          accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        }
      } catch (err) {
        log.warn('读取 accounts.json 失败，将创建新文件。');
      }

      accounts.push(account);

      const dir = path.dirname(ACCOUNTS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));

      log.info(`Token 已保存到 ${ACCOUNTS_FILE}`);
      server.close();
      process.exit(0);
    } catch (err) {
      log.error('Token 交换失败:', err.message);
      server.close();
      process.exit(1);
    }
  });
});

