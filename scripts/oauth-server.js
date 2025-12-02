import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import log from '../src/utils/logger.js';
import { buildAuthUrl, exchangeCodeForToken } from '../src/auth/oauth_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'accounts.json');
const STATE = crypto.randomUUID();

// 本地起一个最简 HTTP 服务，只用于让浏览器有地方可以跳转回调页面。
// 不再在这里解析 code，而是让用户复制地址栏 URL 粘贴回终端。
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
  log.info('授权完成后，复制浏览器地址栏中的完整回调 URL，粘贴回终端。');

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

    // 与发起授权时保持一致：使用粘贴 URL 的 origin + pathname 作为 redirect_uri
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

