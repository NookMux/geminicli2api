# 使用 Google 登录并对接 antigravity2api-nodejs API 的完整流程

本文档基于当前仓库代码编写，说明如何：

- 用 Google 账号完成 OAuth 登录并获取访问凭证
- 理解这些凭证在项目中的存储位置和作用
- 启动本程序，并通过 OpenAI 兼容的 `/v1/*` 接口对外提供 API 服务

所有步骤都以本项目实际实现为准（`scripts/oauth-server.js`, `src/auth/oauth_client.js`, `src/auth/token_manager.js`, `src/server/index.js` 等）。

---

## 一、整体架构和关键文件

1. 你的服务本质是一个「OpenAI 兼容的代理」：
   - 对外暴露 OpenAI 风格的 HTTP 接口：`/v1/models`、`/v1/chat/completions` 等（见 `src/server/index.js`）。
   - 对内调用 Google 内部的 Antigravity/CloudCode API（URL 配置在 `src/config/config.js` 与 `.env` 中）。

2. 访问 Google 后端需要 OAuth 凭证：
   - 登录时从 Google 拿到 `access_token`、`refresh_token` 等。
   - 全部保存在 `data/accounts.json` 文件里（由脚本和面板共同维护）。
   - 实际调用上游 API 时，通过 `src/auth/token_manager.js` 读取并自动刷新 token。

3. 对外调用你服务的客户端只需要：
   - 你的服务地址：例如 `http://localhost:8045`。
   - 一把服务内部的 `API_KEY`（用于保护 `/v1/*` 接口）。

Google 的 token 只用于你的服务与 Google 后端之间的通信，对外调用者不需要也不应该直接使用。

---

## 二、环境准备与基础配置

1. Node.js 版本  
   项目要求 `node >= 18`，见 `package.json` 的 `engines.node` 字段。

2. 安装依赖  
   在仓库根目录执行：

   ```bash
   npm install
   ```

3. `.env` 与默认配置  
   - `src/config/config.js` 会在项目根目录自动生成一个默认 `.env` 文件（如果不存在），里面包含：
     - 服务监听配置：`PORT=8045`、`HOST=0.0.0.0`
     - 上游 API 地址：`API_URL` / `API_MODELS_URL` / `API_NO_STREAM_URL` 等
     - 默认 `API_KEY=sk-text`
   - 生成后会打印日志：`配置加载成功`。

4. 管理面板登录账号（必配）  
   `src/server/index.js` 在启动时强制要求：

   - `PANEL_USER`：管理界面用户名（建议用 `admin`）
   - `PANEL_PASSWORD`：管理界面密码
   - `API_KEY`：访问 `/v1/*` 接口所需的密钥（默认已写在 `.env` 中为 `sk-text`，可以改）

   你需要在 `.env` 里手动增加，例如：

   ```ini
   PANEL_USER=admin
   PANEL_PASSWORD=your-strong-password
   API_KEY=sk-text
   ```

   没有配置 `PANEL_USER` 或 `PANEL_PASSWORD` 时，`src/server/index.js` 会直接 `process.exit(1)`，服务不会启动。

---

## 三、通过命令行完成 Google 登录（推荐给运维/开发）

对应代码：`scripts/oauth-server.js` + `src/auth/oauth_client.js`。

这个方式不需要打开管理面板，直接在终端里完成登录并写入 `data/accounts.json`。

### 3.1 启动本地 OAuth 回调小服务

在项目根目录执行：

```bash
npm run login
```

脚本逻辑（见 `scripts/oauth-server.js`）：

1. 启动一个本地 HTTP 服务，监听随机端口，例如 `http://localhost:54321/oauth-callback`。
2. 调用 `buildAuthUrl(redirectUri, STATE)` 构造 Google OAuth 授权链接：
   - `redirect_uri` 使用刚才随机端口的本地回调地址。
   - `client_id`、`scope` 等由 `src/auth/oauth_client.js` 中的配置决定。
3. 在终端打印出一条完整的 Google 授权 URL，并提示你在浏览器中打开。

### 3.2 在浏览器中完成 Google 授权

1. 复制终端中输出的授权链接，在浏览器打开。
2. 按提示登录你的 Google 账号并点击「同意」。
3. 授权完成后，Google 会把浏览器重定向到刚才的本地回调地址，例如：

   ```text
   http://localhost:54321/oauth-callback?code=xxx&scope=...&state=xxx
   ```

   浏览器页面会显示一段中文提示，告诉你「请复制当前地址栏中的完整 URL 回到终端」——这是 `oauth-server.js` 内嵌的 HTML。

### 3.3 粘贴回调 URL 给脚本，完成 token 交换

回到终端，按照提示把浏览器地址栏里的“完整回调 URL”粘贴进去，脚本会做几件事：

1. 用 `new URL(pasted)` 解析你粘贴的地址，取出 `code` 和 `state`。
2. 校验 `state` 是否和启动脚本时生成的随机 `STATE` 一致，防止复制错链接。
3. 计算最终的 `redirect_uri`：用粘贴回调 URL 的 `origin + pathname`（保证和之前授权时一致）。
4. 调用 `exchangeCodeForToken(code, finalRedirectUri)`（见 `src/auth/oauth_client.js`）向 `https://oauth2.googleapis.com/token` 发送请求，交换得到：
   - `access_token`
   - `refresh_token`
   - `expires_in`
5. 把这份账号信息追加写入 `data/accounts.json`（路径在脚本中定义为 `../data/accounts.json`）。

成功后，终端会输出类似：

```text
Token 已保存到 .../data/accounts.json
```

这时，`TokenManager` 在下次初始化时就能读取到这条记录。

---

## 四、通过管理面板完成 Google 登录（推荐给日常运营）

对应代码：`src/server/index.js` + `Docs/admin_panel_api.md` + `public/admin/*`。

这个方式适合已经启动了 HTTP 服务的场景，通过浏览器界面管理多个 Google 账号。

### 4.1 启动 HTTP 服务

在根目录执行：

```bash
npm start
```

服务启动时：

- 会读取 `.env` 中的 `PORT` / `HOST`，默认是 `0.0.0.0:8045`。
- 会检查 `PANEL_USER`、`PANEL_PASSWORD` 和 `API_KEY` 是否已经配置。

启动成功日志会类似：

```text
服务已启动 0.0.0.0:8045
配置加载成功
```

### 4.2 登录管理面板

1. 在浏览器打开：`http://<你的主机>:8045/admin/login`。
2. 输入 `PANEL_USER` 和 `PANEL_PASSWORD` 对应的账号密码。
3. 登录成功后，服务会：
   - 生成一个随机的 `panel_session` token。
   - 把会话有效期（2 小时）记录在内存 Map 里。
   - 通过 `Set-Cookie` 下发 `panel_session` Cookie。
   - 重定向到主面板 `/admin/oauth`。

未登录访问需要授权的页面时，会被重定向回 `/admin/login`；访问 JSON API 则返回 `401 Unauthorized`。

### 4.3 从面板获取 Google 授权 URL

在 `/admin/oauth` 界面上会有一个“开始授权”之类的按钮（具体文案看前端），背后调用的是：

- `GET /auth/oauth/url`（见 `src/server/index.js`）：
  - 后端根据当前请求的 `Host` 和 `X-Forwarded-Proto` 计算出服务对外的基础地址，例如 `https://your-host`。
  - 构造回调地址：`redirectUri = <base>/auth/oauth/callback`。
  - 调用 `buildAuthUrl(redirectUri, OAUTH_STATE)` 生成 Google 授权链接。
  - 返回 JSON：`{ "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }`。

前端拿到 `url` 后，会用 `window.open` 在新标签页打开。

### 4.4 在浏览器完成授权并复制回调 URL

1. 新标签页里完成 Google 登录与授权。
2. 授权结束后，Google 把浏览器重定向到 `redirectUri`：  
   例如 `https://your-host/auth/oauth/callback?code=...&state=...`。
3. `/auth/oauth/callback` 的实现（在 `src/server/index.js` 中）只返回一个提示页面，不再对 `code` 做处理，而是：
   - 告诉用户“请复制当前浏览器地址栏中的完整 URL，回到管理面板粘贴”。

### 4.5 粘贴回调 URL 并交换 token

在 `/admin/oauth` 页面，把刚才浏览器地址栏中的完整回调 URL 粘贴到输入框，前端调用：

- `POST /auth/oauth/parse-url`，请求体类似：

  ```json
  { "url": "https://your-host/auth/oauth/callback?code=...&state=..." }
  ```

后端逻辑（见 `src/server/index.js`）：

1. 用 `new URL(url)` 解析你粘贴的地址，取出 `code` 和 `state`。
2. 校验 `state` 与服务内部维护的 `OAUTH_STATE` 是否一致，避免复制旧链接。
3. 用 `origin + pathname` 得到最终 `redirectUri`，保证与 `buildAuthUrl` 一致。
4. 调用 `exchangeCodeForToken(code, redirectUri)` 完成 token 交换。
5. 把新账号写入 `data/accounts.json`：
   - `access_token`
   - `refresh_token`
   - `expires_in`
   - `timestamp`
6. 如果 `tokenManager` 暴露了 `initialize()` 方法，则调用它让新账号立刻生效，无需重启服务：

   ```js
   if (typeof tokenManager.initialize === 'function') {
     tokenManager.initialize();
   }
   ```

成功时返回：

```json
{ "success": true }
```

---

## 五、accounts.json 与 TokenManager 的关系

1. 文件位置  
   `data/accounts.json`，CLI 登录脚本和管理面板都写这一个文件。

2. 数据结构（概念上）：

```json
[
  {
    "access_token": "ya29...",
    "refresh_token": "1//0g...",
    "expires_in": 3599,
    "timestamp": 1710000000000,
    "projectId": "projects/xxx",
    "enable": true
  }
]
```

3. `src/auth/token_manager.js` 会在构造时读取这个文件：
   - 为每个账号补充一个内部用的 `sessionId`（不会写回文件）。
   - 过滤掉 `enable === false` 的账号。
   - 维护一个轮询索引 `currentIndex`，用来在多个账号之间轮换。

4. 每次 API 调用时（例如 `/v1/chat/completions`）会调用：

   ```js
   const token = await tokenManager.getToken();
   ```

   - 如果当前账号的 access_token 过期，则自动用 `refresh_token` 去 Google 刷新。
   - 刷新成功会更新 `access_token`、`expires_in`、`timestamp`，并写回 `accounts.json`。
   - 如果刷新返回 400 / 403，会自动把该账号标记为不可用并从内存列表中移除。

你一般不需要手动改 `accounts.json`，通过面板或脚本增加账号即可。

---

## 六、对外提供 API 服务（OpenAI 兼容）

前面所有步骤完成后，你的服务已经具备：

1. 至少一个可用的 Google 账号（`accounts.json` 中有有效 token）。
2. 已启动的 HTTP 服务（默认 `0.0.0.0:8045`）。
3. 一个对外使用的 `API_KEY`（在 `.env` 里的 `API_KEY`，例如 `sk-text`）。

接下来对外提供完全兼容 OpenAI 的 API。

### 6.1 API Key 鉴权机制

`src/server/index.js` 中有一段中间件逻辑：

```js
app.use((req, res, next) => {
  if (req.path.startsWith('/v1/')) {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
      const authHeader = req.headers.authorization;
      const providedKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;
      if (providedKey !== apiKey) {
        return res.status(401).json({ error: 'Invalid API Key' });
      }
    }
  }
  next();
});
```

也就是说：

- 所有 `/v1/*` 接口都需要在请求头里带上正确的 API Key。
- 允许两种形式：
  - `Authorization: Bearer <API_KEY>`
  - 或直接 `Authorization: <API_KEY>`

默认 `.env` 中是 `API_KEY=sk-text`，可以按需修改。

### 6.2 获取模型列表：GET /v1/models

示例请求：

```bash
curl -X GET "http://localhost:8045/v1/models" \
  -H "Authorization: Bearer sk-text"
```

后端会调用 `getAvailableModels()`，把上游返回的模型列表原样转为 JSON 返回。

如果这里报错：

- `401 Invalid API Key`：检查请求头里的 key 是否和 `.env` 里的 `API_KEY` 一致。
- `500` 且返回类似 “没有可用的 token”：说明你还没有完成 OAuth 登录或 `accounts.json` 为空。

### 6.3 聊天补全：POST /v1/chat/completions

接口风格与 OpenAI 保持一致，只是内部实现调用的是 Antigravity/CloudCode。

示例（流式）：

```bash
curl -N -X POST "http://localhost:8045/v1/chat/completions" \
  -H "Authorization: Bearer sk-text" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "some-model-name",
    "stream": true,
    "messages": [
      { "role": "user", "content": "你好，简单介绍一下你自己。" }
    ]
  }'
```

示例（非流式）：

```bash
curl -X POST "http://localhost:8045/v1/chat/completions" \
  -H "Authorization: Bearer sk-text" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "some-model-name",
    "stream": false,
    "messages": [
      { "role": "user", "content": "帮我写一段介绍 antigravity2api-nodejs 的文案。" }
    ]
  }'
```

关键点：

- `messages` 必填，否则会返回 `400 { "error": "messages is required" }`。
- `model` 对应上游支持的模型名，可以先调用 `/v1/models` 查看。
- `stream=true` 时使用 SSE 流式返回。
- 服务内部会在调用前自动通过 `tokenManager.getToken()` 获取并刷新 Google token。

### 6.4 图像相关模型

在 `src/server/index.js` 中有一个简单的判断：

```js
const isImageModel = typeof model === 'string' && model.includes('-image');
```

当 `model` 名称包含 `-image` 时：

- 会自动把请求改造成图像生成请求（`requestType = 'image_gen'`）。
- 调整部分请求参数并移除工具调用字段。

如果你使用图像模型，只需要把 `model` 换成对应的 `*-image` 模型名即可，其他调用方式保持不变。

---

## 七、注意事项与扩展

1. 关于 Google OAuth Client 配置  
   - 当前仓库在 `src/auth/oauth_client.js` 和 `src/auth/token_manager.js` 中内置了 `CLIENT_ID` 与 `CLIENT_SECRET`。
   - `oauth_client.js` 支持用环境变量 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 覆盖默认值，但 `token_manager.js` 里仍然写死了常量。
   - 如果你计划使用自己的 OAuth Client，则需要同时修改这两个文件或者统一改成读取环境变量，否则刷新 token 会失败。

2. 安全建议  
   - `data/accounts.json` 和 `.env` 都属于敏感文件，务必不要提交到公开仓库或暴露在静态服务器上。
   - 如需备份，建议放在受控的私有存储中，并限制访问权限。

3. 多账号与故障切换  
   - 你可以通过 CLI 或管理面板多次添加不同 Google 账号，所有账号都会写入 `accounts.json`。
   - `TokenManager` 会按顺序轮询可用账号，某个账号发生 400/403 错误时会自动标记为不可用，避免影响整体服务。

---

如果你后面想把这份文档再细化成“给调用方看的 API 文档”和“给运维看的部署文档”两份，我可以再帮你拆分整理一版。***
