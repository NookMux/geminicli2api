# OAuth登录解析

## 🔐 OAuth认证概述

GeminiCLI to API 使用 Google OAuth 2.0 认证流程来获取访问 Google API 的凭证。系统支持完整的 OAuth 2.0 流程，包括授权码获取、令牌交换和自动刷新机制。

### 认证流程架构

```
用户请求认证 → 创建OAuth流程 → 生成认证URL → 用户授权 → 获取授权码
      ↓              ↓              ↓            ↓         ↓
  启动回调服务器 → 等待回调 → 验证授权码 → 交换访问令牌 → 保存凭证
```

## 🛠️ OAuth认证组件

### 核心认证模块

| 组件 | 文件位置 | 主要功能 |
|------|----------|----------|
| **OAuth认证API** | `src/auth.py` | OAuth流程管理、回调服务器、令牌验证 |
| **Google OAuth API** | `src/google_oauth_api.py` | OAuth令牌处理、项目获取、API启用 |
| **凭证管理器** | `src/credential_manager.py` | 凭证存储、状态管理、自动轮换 |

### OAuth配置参数

```python
# OAuth Configuration
CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
CLIENT_SECRET = "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"
SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]
```

## 🔄 OAuth认证流程详解

### 1. 创建认证URL

**函数**：`create_auth_url(project_id, user_session, get_all_projects)`

**功能**：创建OAuth认证URL并启动回调服务器

**步骤详解**：

1. **动态端口分配**：
   ```python
   callback_port = await find_available_port()
   callback_url = f"http://{CALLBACK_HOST}:{callback_port}"
   ```

2. **启动回调服务器**：
   ```python
   callback_server = create_callback_server(callback_port)
   server_thread = threading.Thread(
       target=callback_server.serve_forever, 
       daemon=True,
       name=f"OAuth-Server-{callback_port}"
   )
   server_thread.start()
   ```

3. **创建OAuth流程**：
   ```python
   flow = Flow(
       client_id=CLIENT_ID,
       client_secret=CLIENT_SECRET,
       scopes=SCOPES,
       redirect_uri=callback_url
   )
   ```

4. **生成认证URL**：
   ```python
   auth_url = flow.get_auth_url(state=state)
   ```

5. **保存流程状态**：
   ```python
   auth_flows[state] = {
       'flow': flow,
       'project_id': project_id,
       'user_session': user_session,
       'callback_port': callback_port,
       'callback_url': callback_url,
       'server': callback_server,
       'code': None,
       'completed': False,
       'created_at': time.time(),
       'auto_project_detection': project_id is None,
       'get_all_projects': get_all_projects
   }
   ```

### 2. 回调处理

**回调处理器**：`AuthCallbackHandler`

**功能**：处理OAuth授权回调并获取授权码

```python
class AuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        query_components = parse_qs(urlparse(self.path).query)
        code = query_components.get("code", [None])[0]
        state = query_components.get("state", [None])[0]
        
        if code and state and state in auth_flows:
            # 更新流程状态
            auth_flows[state]['code'] = code
            auth_flows[state]['completed'] = True
            
            # 返回成功页面
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>OAuth authentication successful!</h1>")
```

### 3. 完成认证流程

**函数**：`asyncio_complete_auth_flow(project_id, user_session, get_all_projects)`

**功能**：完成OAuth认证流程并保存凭证

**步骤详解**：

1. **查找认证流程**：
   ```python
   for s, data in auth_flows.items():
       if data['project_id'] == project_id:
           if user_session and data.get('user_session') == user_session:
               state = s
               flow_data = data
               break
   ```

2. **等待授权码**：
   ```python
   while waited < max_wait_time:
       if flow_data.get('code'):
           break
       await asyncio.sleep(wait_interval)
       waited += wait_interval
   ```

3. **交换访问令牌**：
   ```python
   credentials = await flow.exchange_code(auth_code)
   ```

4. **自动项目检测**（如果需要）：
   ```python
   if flow_data.get('auto_project_detection', False) and not project_id:
       user_projects = await get_user_projects(credentials)
       if len(user_projects) == 1:
           project_id = user_projects[0].get('projectId')
       else:
           project_id = await select_default_project(user_projects)
   ```

5. **启用必需的API服务**：
   ```python
   await enable_required_apis(credentials, project_id)
   ```

6. **保存凭证**：
   ```python
   saved_filename = await save_credentials(credentials, project_id)
   ```

## 🔑 凭证管理机制

### 凭证类设计

**文件位置**：`src/google_oauth_api.py`

```python
class Credentials:
    def __init__(self, access_token: str, refresh_token: str = None,
                 client_id: str = None, client_secret: str = None,
                 expires_at: datetime = None, project_id: str = None):
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.expires_at = expires_at
        self.project_id = project_id
```

### 令牌自动刷新

**功能**：检测令牌过期并自动刷新

```python
async def refresh_if_needed(self) -> bool:
    """如果需要则刷新token"""
    if not self.is_expired():
        return False
    
    if not self.refresh_token:
        raise TokenError("需要刷新令牌但未提供")
    
    await self.refresh()
    return True

def is_expired(self) -> bool:
    """检查token是否过期"""
    if not self.expires_at:
        return True
    
    # 提前3分钟认为过期
    buffer = timedelta(minutes=3)
    return (self.expires_at - buffer) <= datetime.now(timezone.utc)
```

### 令牌刷新机制

```python
async def refresh(self, max_retries: int = 3, base_delay: float = 1.0):
    """刷新访问令牌，支持重试机制"""
    data = {
        'client_id': self.client_id,
        'client_secret': self.client_secret,
        'refresh_token': self.refresh_token,
        'grant_type': 'refresh_token'
    }
    
    for attempt in range(max_retries + 1):
        try:
            oauth_base_url = await get_oauth_proxy_url()
            token_url = f"{oauth_base_url.rstrip('/')}/token"
            response = await post_async(token_url, data=data)
            
            token_data = response.json()
            self.access_token = token_data['access_token']
            
            if 'expires_in' in token_data:
                expires_in = int(token_data['expires_in'])
                self.expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
            
            if 'refresh_token' in token_data:
                self.refresh_token = token_data['refresh_token']
            
            return
            
        except Exception as e:
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                await asyncio.sleep(delay)
            else:
                raise TokenError(f"Token刷新失败: {str(e)}")
```

## 🌐 Google项目API管理

### 获取用户项目列表

**函数**：`get_user_projects(credentials)`

**功能**：获取用户可访问的Google Cloud项目列表

```python
async def get_user_projects(credentials: Credentials) -> List[Dict[str, Any]]:
    """获取用户可访问的Google Cloud项目列表"""
    headers = {
        "Authorization": f"Bearer {credentials.access_token}",
        "User-Agent": "geminicli-oauth/1.0",
    }
    
    resource_manager_base_url = await get_resource_manager_api_url()
    url = f"{resource_manager_base_url.rstrip('/')}/v1/projects"
    response = await get_async(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        projects = data.get('projects', [])
        # 只返回活跃的项目
        active_projects = [
            project for project in projects 
            if project.get('lifecycleState') == 'ACTIVE'
        ]
        return active_projects
    else:
        return []
```

### 选择默认项目

**函数**：`select_default_project(projects)`

**功能**：从项目列表中选择默认项目

```python
async def select_default_project(projects: List[Dict[str, Any]]) -> Optional[str]:
    """从项目列表中选择默认项目"""
    # 策略1：查找显示名称或项目ID包含"default"的项目
    for project in projects:
        display_name = project.get('displayName', '').lower()
        project_id = project.get('projectId', '')
        if 'default' in display_name or 'default' in project_id.lower():
            return project_id
    
    # 策略2：选择第一个项目
    first_project = projects[0]
    project_id = first_project.get('projectId', '')
    return project_id
```

### 启用必需的API服务

**函数**：`enable_required_apis(credentials, project_id)`

**功能**：自动启用必需的API服务

```python
async def enable_required_apis(credentials: Credentials, project_id: str) -> bool:
    """自动启用必需的API服务"""
    headers = {
        "Authorization": f"Bearer {credentials.access_token}",
        "Content-Type": "application/json",
        "User-Agent": "geminicli-oauth/1.0",
    }
    
    # 需要启用的服务列表
    required_services = [
        "geminicloudassist.googleapis.com",  # Gemini Cloud Assist API
        "cloudaicompanion.googleapis.com"    # Gemini for Google Cloud API
    ]
    
    for service in required_services:
        # 检查服务是否已启用
        service_usage_base_url = await get_service_usage_api_url()
        check_url = f"{service_usage_base_url.rstrip('/')}/v1/projects/{project_id}/services/{service}"
        
        try:
            check_response = await get_async(check_url, headers=headers)
            if check_response.status_code == 200:
                service_data = check_response.json()
                if service_data.get("state") == "ENABLED":
                    continue
        except Exception:
            pass
        
        # 启用服务
        enable_url = f"{service_usage_base_url.rstrip('/')}/v1/projects/{project_id}/services/{service}:enable"
        try:
            enable_response = await post_async(enable_url, headers=headers, json={})
            if enable_response.status_code in [200, 201]:
                log.info(f"✅ 成功启用服务: {service}")
        except Exception as e:
            log.warning(f"⚠️ 启用服务 {service} 失败: {e}")
    
    return True
```

## 📁 凭证存储机制

### 保存凭证

**函数**：`save_credentials(creds, project_id)`

**功能**：通过统一存储系统保存凭证

```python
async def save_credentials(creds: Credentials, project_id: str) -> str:
    """通过统一存储系统保存凭证"""
    # 生成文件名（使用project_id和时间戳）
    timestamp = int(time.time())
    filename = f"{project_id}-{timestamp}.json"
    
    # 准备凭证数据
    creds_data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "token": creds.access_token,
        "refresh_token": creds.refresh_token,
        "scopes": SCOPES,
        "token_uri": "https://oauth2.googleapis.com/token",
        "project_id": project_id
    }
    
    if creds.expires_at:
        creds_data["expiry"] = creds.expires_at.isoformat()
    
    # 通过存储适配器保存
    storage_adapter = await get_storage_adapter()
    success = await storage_adapter.store_credential(filename, creds_data)
    
    if success:
        # 创建默认状态记录
        default_state = {
            "error_codes": [],
            "disabled": False,
            "last_success": time.time(),
            "user_email": None,
            "gemini_2_5_pro_calls": 0,
            "total_calls": 0,
            "next_reset_time": None,
            "daily_limit_gemini_2_5_pro": 100,
            "daily_limit_total": 1000
        }
        await storage_adapter.update_credential_state(filename, default_state)
        return filename
    else:
        raise Exception(f"保存凭证失败: {filename}")
```

### 环境变量凭证支持

**功能**：支持通过环境变量直接加载Google OAuth凭证

**格式**：`GCLI_CREDS_{NAME}=base64_encoded_credentials`

**示例**：
```bash
export GCLI_CREDS_ACCOUNT1="$(cat account1.json | base64 -w 0)"
export GCLI_CREDS_ACCOUNT2="$(cat account2.json | base64 -w 0)"
export GCLI_CREDS_ACCOUNT3="$(cat account3.json | base64 -w 0)"
```

**自动加载**：
- 设置 `AUTO_LOAD_ENV_CREDS=true` 启动时自动加载
- 支持多个凭证文件同时加载
- Base64 编码确保环境变量安全性

## 🔄 批量凭证获取

### 批量获取所有项目凭证

**功能**：一次性获取用户所有Google Cloud项目的凭证

**实现流程**：

1. **启动批量认证流程**：
   ```python
   result = await create_auth_url(
       project_id=None, 
       user_session=user_session, 
       get_all_projects=True
   )
   ```

2. **完成认证并获取项目列表**：
   ```python
   user_projects = await get_user_projects(credentials)
   ```

3. **并发处理所有项目**：
   ```python
   async def process_single_project(project_info):
       project_id_current = project_info.get('projectId')
       await enable_required_apis(credentials, project_id_current)
       saved_filename = await save_credentials(credentials, project_id_current)
       return {
           'status': 'success',
           'project_id': project_id_current,
           'file_path': saved_filename
       }
   
   # 并发处理所有项目
   tasks = [process_single_project(project_info) for project_info in user_projects]
   results = await asyncio.gather(*tasks, return_exceptions=True)
   ```

4. **整理结果**：
   ```python
   multiple_results = {'success': [], 'failed': []}
   for result in results:
       if result['status'] == 'success':
           multiple_results['success'].append({
               'project_id': result['project_id'],
               'file_path': result['file_path']
           })
       else:
           multiple_results['failed'].append({
               'project_id': result['project_id'],
               'error': result['error']
           })
   ```

## 🔐 Web控制台OAuth集成

### OAuth认证API端点

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/auth/login` | POST | 用户登录 | password |
| `/auth/start` | POST | 开始认证流程 | project_id, get_all_projects |
| `/auth/callback` | POST | 处理认证回调 | project_id, get_all_projects |
| `/auth/callback-url` | POST | 从回调URL完成认证 | callback_url, project_id |
| `/auth/status/{project_id}` | GET | 检查认证状态 | - |
| `/auth/upload` | POST | 批量上传凭证文件 | files |
| `/auth/load-env-creds` | POST | 从环境变量加载凭证 | - |
| `/auth/env-creds-status` | GET | 获取环境变量凭证状态 | - |

### OAuth认证流程示例

1. **开始认证**：
   ```javascript
   const response = await fetch('/auth/start', {
       method: 'POST',
       headers: {
           'Authorization': `Bearer ${token}`,
           'Content-Type': 'application/json'
       },
       body: JSON.stringify({
           project_id: null,  // 自动检测
           get_all_projects: true  // 获取所有项目
       })
   });
   
   const data = await response.json();
   const authUrl = data.auth_url;
   ```

2. **用户授权**：
   ```javascript
   // 打开认证URL
   window.open(authUrl, '_blank');
   ```

3. **处理回调**：
   ```javascript
   // 方式1：用户提供回调URL
   const callbackUrl = prompt('请粘贴回调URL:');
   const response = await fetch('/auth/callback-url', {
       method: 'POST',
       headers: {
           'Authorization': `Bearer ${token}`,
           'Content-Type': 'application/json'
       },
       body: JSON.stringify({
           callback_url: callbackUrl,
           get_all_projects: true
       })
   });
   
   // 方式2：自动处理回调
   const response = await fetch('/auth/callback', {
       method: 'POST',
       headers: {
           'Authorization': `Bearer ${token}`,
           'Content-Type': 'application/json'
       },
       body: JSON.stringify({
           get_all_projects: true
       })
   });
   ```

## 🛡️ OAuth安全机制

### 状态管理

**功能**：使用状态参数防止CSRF攻击

```python
# 生成状态标识符，包含用户会话信息
if user_session:
    state = f"{user_session}_{str(uuid.uuid4())}"
else:
    state = str(uuid.uuid4())
```

### 令牌验证

**功能**：验证访问令牌的有效性

```python
async def validate_token(token: str) -> Optional[Dict[str, Any]]:
    """验证访问令牌"""
    try:
        oauth_base_url = await get_oauth_proxy_url()
        tokeninfo_url = f"{oauth_base_url.rstrip('/')}/tokeninfo?access_token={token}"
        
        response = await get_async(tokeninfo_url)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        log.error(f"验证令牌失败: {e}")
        return None
```

### 错误处理

**功能**：处理OAuth流程中的各种错误

```python
def _is_non_retryable_error(self, error_msg: str) -> bool:
    """判断是否是不需要重试的错误"""
    non_retryable_patterns = [
        "400 Bad Request",
        "invalid_grant",
        "refresh_token_expired",
        "invalid_refresh_token", 
        "unauthorized_client",
        "access_denied",
        "401 Unauthorized"
    ]
    
    error_msg_lower = error_msg.lower()
    for pattern in non_retryable_patterns:
        if pattern.lower() in error_msg_lower:
            return True
            
    return False
```

## 🔧 OAuth配置选项

### 环境变量配置

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `OAUTH_PROXY_URL` | OAuth认证代理URL | `https://oauth2.googleapis.com` |
| `GOOGLEAPIS_PROXY_URL` | Google APIs代理URL | `https://www.googleapis.com` |
| `OAUTH_CALLBACK_PORT` | OAuth回调端口 | `8080` |
| `AUTO_LOAD_ENV_CREDS` | 启动时自动加载环境变量凭证 | `false` |

### 配置示例

```bash
# 设置OAuth代理
export OAUTH_PROXY_URL=http://127.0.0.1:7890
export GOOGLEAPIS_PROXY_URL=http://127.0.0.1:7890

# 设置回调端口
export OAUTH_CALLBACK_PORT=8080

# 启用自动加载环境变量凭证
export AUTO_LOAD_ENV_CREDS=true

# 设置环境变量凭证
export GCLI_CREDS_ACCOUNT1="$(cat account1.json | base64 -w 0)"
export GCLI_CREDS_ACCOUNT2="$(cat account2.json | base64 -w 0)"
```

## 📊 OAuth使用统计

### 凭证状态跟踪

**功能**：跟踪每个凭证的使用状态和错误信息

```python
async def record_api_call_result(credential_name: str, success: bool, error_code: Optional[int] = None):
    """记录API调用结果"""
    state_updates = {}
    
    if success:
        state_updates["last_success"] = time.time()
        state_updates["error_codes"] = []
    elif error_code:
        current_state = await self._storage_adapter.get_credential_state(credential_name)
        error_codes = current_state.get("error_codes", [])
        
        if error_code not in error_codes:
            error_codes.append(error_code)
            # 限制错误码列表长度
            if len(error_codes) > 10:
                error_codes = error_codes[-10:]
        
        state_updates["error_codes"] = error_codes
    
    if state_updates:
        await self.update_credential_state(credential_name, state_updates)
```

### 用户邮箱获取

**功能**：获取凭证关联的用户邮箱地址

```python
async def get_user_email(credentials: Credentials) -> Optional[str]:
    """获取用户邮箱地址"""
    try:
        # 确保凭证有效
        await credentials.refresh_if_needed()
        
        # 调用Google userinfo API获取邮箱
        user_info = await get_user_info(credentials)
        if user_info:
            email = user_info.get("email")
            if email:
                return email
        else:
            return None
            
    except Exception as e:
        log.error(f"获取用户邮箱失败: {e}")
        return None
```

## 🚨 OAuth故障排除

### 常见问题及解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 回调服务器启动失败 | 端口被占用 | 系统会自动分配可用端口 |
| 授权码获取失败 | 用户未完成授权 | 确保用户点击了授权链接并完成授权 |
| 令牌交换失败 | 授权码过期或无效 | 重新开始OAuth流程 |
| 刷新令牌失败 | 刷新令牌过期或无效 | 重新进行OAuth认证 |
| 项目列表获取失败 | 权限不足 | 确保OAuth凭证包含必要的范围 |

### 调试技巧

1. **启用调试日志**：
   ```bash
   export LOG_LEVEL=debug
   ```

2. **检查OAuth流程状态**：
   ```javascript
   fetch('/auth/status/{project_id}', {
       headers: {
           'Authorization': `Bearer ${token}`
       }
   })
   .then(response => response.json())
   .then(data => console.log(data));
   ```

3. **验证令牌有效性**：
   ```python
   token_info = await validate_token(credentials.access_token)
   print(token_info)
   ```

4. **检查凭证状态**：
   ```javascript
   fetch('/creds/status', {
       headers: {
           'Authorization': `Bearer ${token}`
       }
   })
   .then(response => response.json())
   .then(data => console.log(data));



【最小化授权脚本使用说明】
- 相关脚本：
~~~python
import asyncio
from typing import Any, Dict, List

# 从同目录模块导入（脚本位于 src 目录内）
import sys
from pathlib import Path
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.auth import create_auth_url, complete_auth_flow_from_callback_url
# 使用项目根目录的日志模块
from log import log


async def main() -> None:
    print("最小化OAuth流程测试：生成授权URL并解析回调中的项目ID")
    confirm = input("是否生成授权URL？输入y生成，输入n退出：").strip().lower()
    if confirm not in ("y", "yes"):
        print("已取消")
        return

    # 生成授权URL（不指定项目ID以测试自动检测逻辑）
    try:
        create_res: Dict[str, Any] = await create_auth_url(project_id=None, user_session="min-auth-test", get_all_projects=False)
    except Exception as e:
        log.error(f"创建授权URL出错: {e}")
        print("创建授权URL失败，详情见日志")
        return

    if not create_res.get("success"):
        log.error(f"创建授权URL失败: {create_res.get('error')}")
        print("创建授权URL失败，详情见日志")
        return

    auth_url = create_res.get("auth_url")
    if not auth_url:
        log.error("返回结果中未包含 auth_url")
        print("未生成授权URL，详情见日志")
        return

    log.info(f"授权URL已生成: {auth_url}")
    print("请在浏览器中打开以下链接完成授权：")
    print(auth_url)
    print("授权完成后，请从浏览器地址栏复制完整的回调URL，并粘贴到下方回车提交。")

    callback_url = input("请粘贴回调URL（需包含state与code参数）：").strip()
    if not callback_url:
        print("未输入回调URL，已退出")
        return

    try:
        complete_res: Dict[str, Any] = await complete_auth_flow_from_callback_url(callback_url=callback_url, project_id=None, get_all_projects=False)
    except Exception as e:
        log.error(f"解析回调URL并完成认证出错: {e}")
        print("解析回调URL失败，详情见日志")
        return

    # 成功直接返回项目ID
    if complete_res.get("success"):
        project_id = complete_res.get("project_id")
        if project_id:
            log.info(f"解析到的项目ID: {project_id}")
            print(f"解析到的项目ID: {project_id}")
            return
        # 批量模式（如返回 multiple_credentials）
        multiple = complete_res.get("multiple_credentials")
        if isinstance(multiple, list) and multiple:
            log.info("检测到批量模式，以下为解析到的项目ID：")
            for item in multiple:
                pid = item.get("project_id") or item.get("projectId")
                if pid:
                    log.info(f"项目ID: {pid}")
            print("批量模式凭证已记录到日志。")
            return
        # 兜底：尝试从凭证文件路径中解析项目ID，或读取JSON文件的project_id
        file_path = complete_res.get("file_path")
        if file_path:
            try:
                from pathlib import Path
                import re
                fp = Path(file_path)
                name = fp.stem
                m = re.match(r"(.+)-\d+$", name)
                candidate = m.group(1) if m else name
                # 尝试读取凭证JSON覆盖候选值
                try:
                    import json
                    with open(fp, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        candidate = data.get("project_id") or data.get("projectId") or candidate
                except Exception:
                    pass
                if candidate:
                    log.info(f"兜底解析到的项目ID: {candidate}")
                    print(f"解析到的项目ID: {candidate}")
                    return
            except Exception as e:
                log.warning(f"无法从凭证文件解析项目ID: {e}")
        log.info("认证成功，但未返回项目ID。")
        print("认证成功，但未返回项目ID，详情见日志。")
        return

    # 需要选择项目
    if complete_res.get("requires_project_selection"):
        available: List[Dict[str, Any]] = complete_res.get("available_projects", [])
        if not available:
            log.warning("需要项目选择但未提供可用项目列表")
            print("未提供可选项目列表，详情见日志。")

if __name__ == "__main__":
    asyncio.run(main())
~~~
- 运行方式（二选一）：
  1) 使用 Python 启动器（推荐）：
     ```powershell
     py .\src\min_auth_flow_test.py
     ```
  2) 以模块方式运行：
     ```powershell
     py -m src.min_auth_flow_test
     ```
- 交互步骤：
  1) 程序将生成一条 Google OAuth 授权 URL 并提示你在浏览器完成登录；
  2) 登录成功后，复制浏览器地址栏的完整回调 URL 粘贴回终端；
  3) 程序解析并完成授权码交换，保存凭证文件，记录项目 ID（单项目模式或批量模式）。

【流程概述（简版）】
- 授权 URL 生成：<mcfile name="auth.py" path="c:\Users\zhongruan\Desktop\GitHub\geminicli2api\src\auth.py"></mcfile> 的 `create_auth_url` 会动态分配回调端口并生成 URL；
- 回调解析与授权码交换：`complete_auth_flow_from_callback_url` 解析回调参数并完成授权码交换；
- OAuth 交换逻辑由 <mcfile name="google_oauth_api.py" path="c:\Users\zhongruan\Desktop\GitHub\geminicli2api\src\google_oauth_api.py"></mcfile> 的 `Flow` 与 `Credentials` 管理；
- 项目选择：在检测到多个项目时会自动选择一个默认项目（例如第一个）。

【返回结构与字段说明】
- 单项目模式返回：`{"success": true/false, "project_id": 可选, "file_path": 凭证路径}`；
- 批量模式返回：`{"success": true/false, "multiple_credentials": [{"project_id":..., "file_path":...}, ...]}`；
- 注意：部分成功路径可能未显式包含 `project_id`，需结合兜底策略获取（见下文）。

【项目 ID 解析兜底策略】
- 为避免部分成功路径未返回 `project_id`，脚本实现了双重兜底：
  1) 从凭证文件名解析：如 `modular-button-473914-k4.json` 去掉后缀与末尾数字段；
  2) 读取凭证 JSON：如果可读，优先使用其中的项目 ID 字段；
- 当前测试日志已验证该策略可稳定获取项目 ID（例如：`modular-button-473914-k4`）。

【常见问题与排查】
- PowerShell 无法识别 `python`：使用 `py` 启动器运行，或检查 PATH 与应用执行别名；
- 导入错误（相对导入失败）：脚本中已将项目根目录加入 `sys.path` 并改为 `from src.auth import ...` 的导入方式；
- 浏览器额外回调请求：若日志出现“收到OAuth回调: code=未获取”，通常为浏览器资源请求的附带访问，可忽略；
- 日志文件：运行脚本会在 <mcfile name="log.txt" path="c:\Users\zhongruan\Desktop\GitHub\geminicli2api\log.txt"></mcfile> 记录完整流程，便于审计与排查。

【独立脚本积累与后续重构规划】
- 当前已完成：<mcfile name="min_auth_flow_test.py" path="c:\Users\zhongruan\Desktop\GitHub\geminicli2api\src\min_auth_flow_test.py"></mcfile>；
- 建议持续积累独立脚本，示例目录：
  - `src/cli_auth_login.py`：专注授权登录与凭证保存；
  - `src/cli_project_select.py`：手动选择项目并验证可用性；
  - `src/cli_verify_credentials.py`：校验凭证有效期与刷新逻辑；
- 重构目标：将通用逻辑上移到 <mcfile name="utils.py" path="c:\Users\zhongruan\Desktop\GitHub\geminicli2api\src\utils.py"></mcfile>（如 `parse_project_id_from_credentials(file_path)`），实现脚本与路由的复用，减少重复代码。

【备注】
- 若未来决定统一由源实现返回 `project_id`，可在 <mcfile name="auth.py" path="c:\Users\zhongruan\Desktop\GitHub\geminicli2api\src\auth.py"></mcfile> 成功路径上补齐字段，并同步更新文档“返回结构与字段说明”一节。
