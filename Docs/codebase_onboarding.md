# GeminiCLI2API 代码结构与逆向逻辑速览

本文档面向新成员，按照“从 OAuth 到官方接口调用”的链路串讲整个后端的核心逻辑，帮助你在其他语言中复刻相同的 2API 行为。

## 1. 应用骨架
- **入口 `web.py`**：创建 FastAPI 实例并挂载路由；在 `lifespan` 中初始化全局 `CredentialManager`、加载环境凭证、启动/停止 GitHub 凭证备份计划，并在退出时关闭异步任务。【F:web.py†L16-L83】【F:web.py†L92-L154】
- **路由**：
  - `src/gemini_router.py` 提供与 Google Gemini 原生格式一致的 API（列表模型、生成内容、流式等），并在请求阶段进行鉴权、参数收敛、健康检查和调用追踪。【F:src/gemini_router.py†L15-L118】【F:src/gemini_router.py†L120-L202】
  - `src/web_routes.py`（未展开）承载控制台页面、配置读取/写入等管理接口。
- **前端静态资源**：通过 `/static` 挂载 `front/static`，便于控制台页面直接访问。【F:web.py†L70-L85】

## 2. OAuth 握手链路
1. **创建认证链接**（`create_auth_url`）：
   - 动态查找可用回调端口，启动本地 HTTP 服务器监听 `http://localhost:<port>` 以接收授权码回传。【F:src/auth.py†L39-L116】【F:src/auth.py†L145-L214】
   - 构造 `Flow`（封装于 `google_oauth_api.py`），生成用户需要访问的授权 URL，并记录流程状态（state、项目 ID、线程与端口等）。【F:src/google_oauth_api.py†L15-L109】【F:src/auth.py†L213-L273】

2. **用户授权回调**：浏览器完成授权后，`AuthCallbackHandler` 捕获 `code` + `state`，更新对应流程并返回成功页面，供后续等待逻辑读取。【F:src/auth.py†L76-L143】

3. **完成流程并落盘**（`complete_auth_flow`）：
   - 若尚未拿到 `code`，同步等待回调；随后调用 `flow.exchange_code` 交换令牌。
   - 支持自动探测或手动指定 `project_id`，必要时通过 `get_user_projects` / `select_default_project` 查询并提示用户选择。
   - 将得到的 `Credentials` 与项目 ID 交给统一存储层写入（见下文），并清理本次回调服务器。【F:src/auth.py†L273-L390】

## 3. 凭证与存储抽象
- **存储适配器**：`storage_adapter.py` 统一屏蔽文件/其他后端读写，所有凭证 (`creds.toml`) 与状态 (`creds_state.json`) 仅经此层操作，便于迁移到数据库或云存储。（接口在各模块被异步获取使用）
- **凭证管理器 `CredentialManager`**：
  - 初始化时加载适配器、启动后台 worker、扫描可用凭证，支持热更新与禁用过滤。【F:src/credential_manager.py†L15-L121】【F:src/credential_manager.py†L137-L214】
  - 在请求时提供 `get_valid_credential`、调用计数、自定义轮换策略（如 429/封禁后强制轮换）、定期写回状态等，确保高并发下安全访问凭证。【F:src/credential_manager.py†L216-L344】

## 4. 官方接口转发
- **请求构建与发送**：`google_chat_api.py` 负责把路由层的请求转为 Google 官方 Gemini API 调用，包含：
  - 根据模型/流式与否选择 HTTP 客户端，注入 `_trace_id` 做追踪日志。【F:src/google_chat_api.py†L24-L65】
  - 处理配额与凭证选择 `_select_credential_respecting_quota`，在 429 或配置的封禁错误时触发凭证轮换。【F:src/google_chat_api.py†L67-L175】
  - 记录调用成功统计，返回标准响应或流式 `StreamingResponse`。
- **负载转换**：
  - `google_chat_api.build_gemini_payload_from_native` 与 `openai_transfer._extract_content_and_reasoning` 等工具负责在本地格式与官方请求体之间转换，保证多路由复用同一发送层。
  - `format_detector.py`、`models.py` 等为模型名、响应格式和安全参数提供辅助。

## 5. 复刻要点（跨语言）
若需用其他语言实现同样的 2API，可按以下最小骨架迁移：
1. **OAuth 子系统**：
   - 提供“生成授权链接 + 启动本地回调服务器 + 等待回调 + 交换 token”四步流程，回调监听 0.0.0.0 并限制并发流程数量，收敛到统一的凭证存储接口。
2. **存储与轮换**：
   - 抽象存储层（凭证、状态、使用统计）并在管理器内做热更新扫描、配额检查、429/禁用自动轮换，避免直接文件读写耦合。
3. **路由与鉴权**：
   - 提供与官方路径一致的 REST 路由（如 `/v1/models`, `/v1/models/{id}:generateContent`），支持 `x-goog-api-key`、`key` 参数或 Bearer Token 三种鉴权方式，并对生成参数做安全上限。
4. **官方调用封装**：
   - 将上游请求转换为官方 Gemini Payload，复用统一 HTTP 客户端，封装错误处理、追踪、流式输出和统计记录。

按照上述拆分，你可以在任何语言里复刻相同的调用路径：`OAuth 授权 → 存储凭证 → 轮换/鉴权 → 构造 payload → 请求 Google 官方 Gemini 接口 → 返回 OpenAI/Gemini 兼容响应`。
