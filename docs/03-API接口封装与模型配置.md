# API接口封装与模型配置

## 🌐 API接口架构

GeminiCLI to API 提供了双端点支持，同时兼容 OpenAI 和 Gemini 原生 API 格式。系统通过智能格式检测和转换，使开发者能够无缝切换不同的 API 格式，而无需修改底层代码。

### API路由架构

```
用户请求 → 格式检测 → 路由分发 → 凭证轮换 → API 调用
    ↓           ↓         ↓         ↓         ↓
响应处理 ← 格式转换 ← 结果解析 ← 错误处理 ← 网络请求
```

### 核心路由模块

| 模块 | 文件位置 | 主要功能 |
|------|----------|----------|
| **OpenAI路由** | `src/openai_router.py` | OpenAI格式API端点、请求转换、响应处理 |
| **Gemini路由** | `src/gemini_router.py` | Gemini原生API端点、请求验证、响应处理 |
| **格式转换** | `src/openai_transfer.py` | OpenAI与Gemini格式双向转换、参数映射 |
| **Google API客户端** | `src/google_chat_api.py` | Google API调用、错误处理、重试机制 |
| **HTTP客户端** | `src/httpx_client.py` | 统一HTTP客户端、代理配置、超时管理 |

## 🔧 OpenAI兼容API

### OpenAI路由端点

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/v1/models` | GET | 获取可用模型列表 | - |
| `/v1/chat/completions` | POST | 聊天完成请求 | messages, model, stream等 |

### OpenAI请求处理流程

```python
@router.post("/v1/chat/completions")
async def chat_completions(request: Request, token: str = Depends(authenticate)):
    """处理OpenAI格式的聊天完成请求"""
    
    # 1. 获取原始请求数据
    raw_data = await request.json()
    request_data = ChatCompletionRequest(**raw_data)
    
    # 2. 健康检查
    if (len(request_data.messages) == 1 and 
        getattr(request_data.messages[0], "role", None) == "user" and
        getattr(request_data.messages[0], "content", None) == "Hi"):
        return JSONResponse(content={
            "choices": [{"message": {"role": "assistant", "content": "gcli2api正常工作中"}}]
        })
    
    # 3. 参数处理
    if getattr(request_data, "max_tokens", None) is not None and request_data.max_tokens > 65535:
        request_data.max_tokens = 65535
    
    setattr(request_data, "top_k", 64)
    
    # 4. 过滤空消息
    filtered_messages = []
    for m in request_data.messages:
        content = getattr(m, "content", None)
        if content:
            if isinstance(content, str) and content.strip():
                filtered_messages.append(m)
            elif isinstance(content, list) and len(content) > 0:
                has_valid_content = False
                for part in content:
                    if isinstance(part, dict):
                        if part.get("type") == "text" and part.get("text", "").strip():
                            has_valid_content = True
                            break
                        elif part.get("type") == "image_url" and part.get("image_url", {}).get("url"):
                            has_valid_content = True
                            break
                if has_valid_content:
                    filtered_messages.append(m)
    
    request_data.messages = filtered_messages
    
    # 5. 处理模型名称和功能检测
    model = request_data.model
    use_fake_streaming = is_fake_streaming_model(model)
    use_anti_truncation = is_anti_truncation_model(model)
    real_model = get_base_model_from_feature_model(model)
    request_data.model = real_model
    
    # 6. 获取凭证管理器和有效凭证
    cred_mgr = await get_credential_manager()
    credential_result = await cred_mgr.get_valid_credential()
    
    # 7. 转换为Gemini API payload格式
    api_payload = await openai_request_to_gemini_payload(request_data)
    
    # 8. 处理特殊功能（假流式、抗截断）
    if use_fake_streaming and getattr(request_data, "stream", False):
        request_data.stream = False
        return await fake_stream_response(api_payload, cred_mgr)
    
    if use_anti_truncation and getattr(request_data, "stream", False):
        max_attempts = await get_anti_truncation_max_attempts()
        gemini_response = await apply_anti_truncation_to_stream(
            lambda api_payload: send_gemini_request(api_payload, is_streaming, cred_mgr),
            api_payload,
            max_attempts
        )
        return await convert_streaming_response(gemini_response, model)
    
    # 9. 发送请求并处理响应
    is_streaming = getattr(request_data, "stream", False)
    response = await send_gemini_request(api_payload, is_streaming, cred_mgr)
    
    if is_streaming:
        return await convert_streaming_response(response, model)
    else:
        response_data = json.loads(response.body.decode())
        openai_response = gemini_response_to_openai(response_data, model)
        return JSONResponse(content=openai_response)
```

### OpenAI格式转换

**文件位置**：`src/openai_transfer.py`

#### OpenAI到Gemini转换

```python
async def openai_request_to_gemini_payload(request_data: ChatCompletionRequest) -> Dict[str, Any]:
    """将OpenAI格式请求转换为Gemini API格式"""
    
    # 1. 基础payload结构
    payload = {
        "contents": [],
        "generationConfig": {
            "temperature": getattr(request_data, "temperature", 1.0),
            "topP": getattr(request_data, "top_p", 0.95),
            "topK": getattr(request_data, "top_k", 64),
            "maxOutputTokens": getattr(request_data, "max_tokens", None),
            "candidateCount": 1,
            "stopSequences": getattr(request_data, "stop", None)
        },
        "safetySettings": DEFAULT_SAFETY_SETTINGS
    }
    
    # 2. 处理消息内容
    for message in request_data.messages:
        role = message.role
        content = message.content
        
        if role == "system":
            # 系统消息处理
            if await get_compatibility_mode_enabled():
                # 兼容性模式：将system消息转换为user消息
                gemini_content = {"role": "user", "parts": [{"text": content}]}
            else:
                # 标准模式：使用system_instructions
                if "systemInstruction" not in payload:
                    payload["systemInstruction"] = {"parts": []}
                payload["systemInstruction"]["parts"].append({"text": content})
                continue
        elif role == "user":
            gemini_content = {"role": "user", "parts": []}
            if isinstance(content, str):
                gemini_content["parts"].append({"text": content})
            elif isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        gemini_content["parts"].append({"text": part.get("text", "")})
                    elif part.get("type") == "image_url":
                        image_url = part.get("image_url", {}).get("url", "")
                        # 处理base64图片
                        if image_url.startswith("data:image/"):
                            mime_type, base64_data = image_url.split(",", 1)
                            gemini_content["parts"].append({
                                "inline_data": {
                                    "mime_type": mime_type.split(":")[1].split(";")[0],
                                    "data": base64_data
                                }
                            })
        elif role == "assistant":
            gemini_content = {"role": "model", "parts": []}
            if isinstance(content, str):
                gemini_content["parts"].append({"text": content})
            elif isinstance(content, list):
                for part in content:
                    if part.get("type") == "text":
                        gemini_content["parts"].append({"text": part.get("text", "")})
        
        if "role" in gemini_content:
            payload["contents"].append(gemini_content)
    
    # 3. 处理思考模式配置
    model_name = request_data.model
    thinking_budget = get_thinking_budget(model_name)
    include_thoughts = should_include_thoughts(model_name)
    
    if thinking_budget is not None and thinking_budget > 0:
        if "generationConfig" not in payload:
            payload["generationConfig"] = {}
        payload["generationConfig"]["thinkingBudget"] = thinking_budget
        payload["generationConfig"]["includeThoughts"] = include_thoughts
    
    # 4. 处理搜索增强配置
    if is_search_model(model_name):
        if "tools" not in payload:
            payload["tools"] = []
        payload["tools"].append({
            "googleSearch": {}
        })
    
    return payload
```

#### Gemini到OpenAI转换

```python
def gemini_response_to_openai(response_data: Dict[str, Any], model: str) -> Dict[str, Any]:
    """将Gemini API响应转换为OpenAI格式"""
    
    # 1. 基础响应结构
    openai_response = {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": []
    }
    
    # 2. 处理候选响应
    if "candidates" in response_data and response_data["candidates"]:
        candidate = response_data["candidates"][0]
        finish_reason = candidate.get("finishReason", "STOP")
        
        # 映射结束原因
        finish_reason_map = {
            "STOP": "stop",
            "MAX_TOKENS": "length",
            "SAFETY": "content_filter",
            "RECITATION": "content_filter",
            "OTHER": "stop"
        }
        openai_finish_reason = finish_reason_map.get(finish_reason, "stop")
        
        # 3. 提取内容
        content = ""
        reasoning_content = ""
        
        if "content" in candidate and "parts" in candidate["content"]:
            parts = candidate["content"]["parts"]
            content, reasoning_content = _extract_content_and_reasoning(parts)
        
        # 4. 构建选择对象
        choice = {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": content
            },
            "finish_reason": openai_finish_reason
        }
        
        # 5. 添加思考内容（如果有）
        if reasoning_content:
            choice["message"]["reasoning_content"] = reasoning_content
        
        openai_response["choices"].append(choice)
    
    # 6. 添加使用统计
    if "usageMetadata" in response_data:
        usage = response_data["usageMetadata"]
        openai_response["usage"] = {
            "prompt_tokens": usage.get("promptTokenCount", 0),
            "completion_tokens": usage.get("candidatesTokenCount", 0),
            "total_tokens": usage.get("totalTokenCount", 0)
        }
    else:
        openai_response["usage"] = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }
    
    return openai_response
```

## 🌟 Gemini原生API

### Gemini路由端点

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/v1/models` | GET | 获取可用模型列表 | - |
| `/v1/models/{model}:generateContent` | POST | 内容生成请求（非流式） | contents, generationConfig等 |
| `/v1/models/{model}:streamGenerateContent` | POST | 流式内容生成请求 | contents, generationConfig等 |
| `/v1/models/{model}:countTokens` | POST | Token计数请求 | contents |
| `/v1/models/{model}` | GET | 获取模型信息 | - |

### Gemini请求处理流程

```python
@router.post("/v1/models/{model:path}:generateContent")
async def generate_content(
    model: str = Path(..., description="Model name"),
    request: Request = None,
    api_key: str = Depends(authenticate_gemini_flexible)
):
    """处理Gemini格式的内容生成请求（非流式）"""
    
    # 1. 获取原始请求数据
    request_data = await request.json()
    
    # 2. 验证必要字段
    if "contents" not in request_data or not request_data["contents"]:
        raise HTTPException(status_code=400, detail="Missing required field: contents")
    
    # 3. 请求预处理：限制参数
    if "generationConfig" in request_data and request_data["generationConfig"]:
        generation_config = request_data["generationConfig"]
        
        # 限制maxOutputTokens
        if "maxOutputTokens" in generation_config and generation_config["maxOutputTokens"] is not None:
            if generation_config["maxOutputTokens"] > 65535:
                generation_config["maxOutputTokens"] = 65535
        
        # 覆写 topK 为 64
        generation_config["topK"] = 64
    else:
        # 如果没有generationConfig，创建一个并设置topK
        request_data["generationConfig"] = {"topK": 64}
    
    # 4. 处理模型名称和功能检测
    use_anti_truncation = is_anti_truncation_model(model)
    real_model = get_base_model_from_feature_model(model)
    
    # 5. 健康检查
    if (len(request_data["contents"]) == 1 and 
        request_data["contents"][0].get("role") == "user" and
        request_data["contents"][0].get("parts", [{}])[0].get("text") == "Hi"):
        return JSONResponse(content={
            "candidates": [{
                "content": {
                    "parts": [{"text": "gcli2api工作中"}],
                    "role": "model"
                },
                "finishReason": "STOP",
                "index": 0
            }]
        })
    
    # 6. 获取凭证管理器和有效凭证
    cred_mgr = await get_credential_manager()
    credential_result = await cred_mgr.get_valid_credential()
    
    # 7. 构建Google API payload
    api_payload = build_gemini_payload_from_native(request_data, real_model)
    
    # 8. 发送请求并处理响应
    response = await send_gemini_request(api_payload, False, cred_mgr)
    
    # 9. 处理响应
    if hasattr(response, 'body'):
        response_data = json.loads(response.body.decode())
    elif hasattr(response, 'content'):
        response_data = json.loads(response.content.decode())
    else:
        response_data = json.loads(str(response))
    
    return JSONResponse(content=response_data)
```

### Gemini流式响应处理

```python
@router.post("/v1/models/{model:path}:streamGenerateContent")
async def stream_generate_content(
    model: str = Path(..., description="Model name"),
    request: Request = None,
    api_key: str = Depends(authenticate_gemini_flexible)
):
    """处理Gemini格式的流式内容生成请求"""
    
    # 1. 获取原始请求数据
    request_data = await request.json()
    
    # 2. 验证必要字段
    if "contents" not in request_data or not request_data["contents"]:
        raise HTTPException(status_code=400, detail="Missing required field: contents")
    
    # 3. 请求预处理：限制参数
    if "generationConfig" in request_data and request_data["generationConfig"]:
        generation_config = request_data["generationConfig"]
        
        # 限制maxOutputTokens
        if "maxOutputTokens" in generation_config and generation_config["maxOutputTokens"] is not None:
            if generation_config["maxOutputTokens"] > 65535:
                generation_config["maxOutputTokens"] = 65535
        
        # 覆写 topK 为 64
        generation_config["topK"] = 64
    else:
        # 如果没有generationConfig，创建一个并设置topK
        request_data["generationConfig"] = {"topK": 64}
    
    # 4. 处理模型名称和功能检测
    use_fake_streaming = is_fake_streaming_model(model)
    use_anti_truncation = is_anti_truncation_model(model)
    real_model = get_base_model_from_feature_model(model)
    
    # 5. 处理假流式模型
    if use_fake_streaming:
        return await fake_stream_response_gemini(request_data, real_model)
    
    # 6. 获取凭证管理器和有效凭证
    cred_mgr = await get_credential_manager()
    credential_result = await cred_mgr.get_valid_credential()
    
    # 7. 构建Google API payload
    api_payload = build_gemini_payload_from_native(request_data, real_model)
    
    # 8. 处理抗截断功能
    if use_anti_truncation:
        max_attempts = await get_anti_truncation_max_attempts()
        return await apply_anti_truncation_to_stream(
            lambda payload: send_gemini_request(payload, True, cred_mgr),
            api_payload,
            max_attempts
        )
    
    # 9. 常规流式请求
    response = await send_gemini_request(api_payload, True, cred_mgr)
    
    # 10. 直接返回流式响应
    return response
```

## 🔄 流式响应处理

### 流式响应架构

```
用户请求 → 流式检测 → 特殊功能处理 → API调用 → 流式响应
    ↓           ↓           ↓           ↓         ↓
响应处理 ← 格式转换 ← 结果解析 ← 错误处理 ← 网络请求
```

### 假流式响应

**功能**：对于不支持真流式的模型，提供模拟流式响应

**实现原理**：
1. 发送心跳包保持连接
2. 在后台发送实际请求
3. 收到完整响应后一次性发送
4. 保持流式响应的格式和结构

```python
async def fake_stream_response(api_payload: dict, cred_mgr: CredentialManager) -> StreamingResponse:
    """处理假流式响应"""
    async def stream_generator():
        try:
            # 1. 发送心跳
            heartbeat = {
                "choices": [{
                    "index": 0,
                    "delta": {"role": "assistant", "content": ""},
                    "finish_reason": None
                }]
            }
            yield f"data: {json.dumps(heartbeat)}\n\n".encode()
            
            # 2. 异步发送实际请求
            async def get_response():
                return await send_gemini_request(api_payload, False, cred_mgr)
            
            # 3. 创建请求任务
            response_task = create_managed_task(get_response(), name="openai_fake_stream_request")
            
            try:
                # 4. 每3秒发送一次心跳，直到收到响应
                while not response_task.done():
                    await asyncio.sleep(3.0)
                    if not response_task.done():
                        yield f"data: {json.dumps(heartbeat)}\n\n".encode()
                
                # 5. 获取响应结果
                response = await response_task
                
            except asyncio.CancelledError:
                # 6. 取消任务并传播取消
                response_task.cancel()
                try:
                    await response_task
                except asyncio.CancelledError:
                    pass
                raise
            
            # 7. 处理结果
            if hasattr(response, 'body'):
                body_str = response.body.decode() if isinstance(response.body, bytes) else str(response.body)
            elif hasattr(response, 'content'):
                body_str = response.content.decode() if isinstance(response.content, bytes) else str(response.content)
            else:
                body_str = str(response)
            
            try:
                response_data = json.loads(body_str)
                
                # 8. 从Gemini响应中提取内容，使用思维链分离逻辑
                content = ""
                reasoning_content = ""
                if "candidates" in response_data and response_data["candidates"]:
                    candidate = response_data["candidates"][0]
                    if "content" in candidate and "parts" in candidate["content"]:
                        parts = candidate["content"]["parts"]
                        content, reasoning_content = _extract_content_and_reasoning(parts)
                elif "choices" in response_data and response_data["choices"]:
                    content = response_data["choices"][0].get("message", {}).get("content", "")
                
                # 9. 如果没有正常内容但有思维内容，给出警告
                if not content and reasoning_content:
                    content = "[模型正在思考中，请稍后再试或重新提问]"
                
                # 10. 构建响应块，包括思维内容（如果有）
                if content:
                    delta = {"role": "assistant", "content": content}
                    if reasoning_content:
                        delta["reasoning_content"] = reasoning_content
                    
                    content_chunk = {
                        "choices": [{
                            "index": 0,
                            "delta": delta,
                            "finish_reason": "stop"
                        }]
                    }
                    yield f"data: {json.dumps(content_chunk)}\n\n".encode()
                else:
                    # 11. 如果完全没有内容，提供默认回复
                    error_chunk = {
                        "choices": [{
                            "index": 0,
                            "delta": {"role": "assistant", "content": "[响应为空，请重新尝试]"},
                            "finish_reason": "stop"
                        }]
                    }
                    yield f"data: {json.dumps(error_chunk)}\n\n".encode()
            
            except json.JSONDecodeError:
                # 12. JSON解析错误处理
                error_chunk = {
                    "choices": [{
                        "index": 0,
                        "delta": {"role": "assistant", "content": body_str},
                        "finish_reason": "stop"
                    }]
                }
                yield f"data: {json.dumps(error_chunk)}\n\n".encode()
            
            # 13. 发送结束标记
            yield "data: [DONE]\n\n".encode()
            
        except Exception as e:
            # 14. 错误处理
            error_chunk = {
                "choices": [{
                    "index": 0,
                    "delta": {"role": "assistant", "content": f"Error: {str(e)}"},
                    "finish_reason": "stop"
                }]
            }
            yield f"data: {json.dumps(error_chunk)}\n\n".encode()
            yield "data: [DONE]\n\n".encode()
    
    return StreamingResponse(stream_generator(), media_type="text/event-stream")
```

### 流式抗截断机制

**文件位置**：`src/anti_truncation.py`

**功能**：自动检测响应截断并重试，确保完整回答

**实现原理**：
1. 检测响应是否被截断
2. 保存当前上下文状态
3. 自动重试并继续生成
4. 合并多次响应结果

```python
async def apply_anti_truncation_to_stream(request_func, api_payload, max_attempts):
    """应用流式抗截断功能"""
    
    # 1. 初始化状态
    attempt = 0
    accumulated_content = ""
    accumulated_reasoning = ""
    context_parts = []
    
    while attempt < max_attempts:
        attempt += 1
        log.info(f"流式抗截断尝试 {attempt}/{max_attempts}")
        
        try:
            # 2. 发送请求
            response = await request_func(api_payload)
            
            # 3. 处理流式响应
            is_truncated = False
            current_content = ""
            current_reasoning = ""
            
            async for chunk in response.body_iterator:
                if not chunk:
                    continue
                
                # 4. 解析响应块
                if isinstance(chunk, bytes):
                    if not chunk.startswith(b'data: '):
                        continue
                    payload = chunk[len(b'data: '):]
                else:
                    chunk_str = str(chunk)
                    if not chunk_str.startswith('data: '):
                        continue
                    payload = chunk_str[len('data: '):].encode()
                
                # 5. 检查结束标记
                if payload == b'[DONE]\n\n':
                    break
                
                try:
                    gemini_chunk = json.loads(payload.decode())
                    
                    # 6. 提取内容
                    if "candidates" in gemini_chunk and gemini_chunk["candidates"]:
                        candidate = gemini_chunk["candidates"][0]
                        if "content" in candidate and "parts" in candidate["content"]:
                            parts = candidate["content"]["parts"]
                            for part in parts:
                                if "text" in part:
                                    text = part["text"]
                                    current_content += text
                                    
                                    # 7. 检查截断模式
                                    if _is_truncation_pattern(text):
                                        is_truncated = True
                                        log.info(f"检测到截断模式: {text[:50]}...")
                                
                                # 8. 提取思考内容
                                if part.get("thought"):
                                    reasoning = part.get("text", "")
                                    current_reasoning += reasoning
                    
                except json.JSONDecodeError:
                    continue
            
            # 9. 累积内容
            accumulated_content += current_content
            accumulated_reasoning += current_reasoning
            
            # 10. 检查是否截断
            if not is_truncated:
                log.info("响应完整，无需重试")
                break
            else:
                log.info(f"响应被截断，准备重试 (尝试 {attempt}/{max_attempts})")
                
                # 11. 更新上下文
                if "contents" in api_payload:
                    # 添加当前响应到上下文
                    api_payload["contents"].append({
                        "role": "model",
                        "parts": [{"text": current_content}]
                    })
                
                # 12. 继续下一次尝试
                continue
        
        except Exception as e:
            log.error(f"流式抗截断尝试 {attempt} 失败: {e}")
            if attempt >= max_attempts:
                break
            continue
    
    # 13. 构建最终响应
    final_response = {
        "candidates": [{
            "content": {
                "parts": [{"text": accumulated_content}]
            },
            "finishReason": "STOP",
            "index": 0
        }]
    }
    
    # 14. 添加思考内容（如果有）
    if accumulated_reasoning:
        final_response["candidates"][0]["content"]["parts"].append({
            "text": accumulated_reasoning,
            "thought": True
        })
    
    # 15. 返回流式响应
    async def final_stream_generator():
        # 发送累积的内容
        content_chunk = {
            "candidates": [{
                "content": {
                    "parts": final_response["candidates"][0]["content"]["parts"]
                },
                "finishReason": "STOP",
                "index": 0
            }]
        }
        yield f"data: {json.dumps(content_chunk)}\n\n".encode()
        yield "data: [DONE]\n\n".encode()
    
    return StreamingResponse(final_stream_generator(), media_type="text/event-stream")
```

## 🤖 模型配置系统

### 模型名称处理

**文件位置**：`config.py`

```python
# 基础模型列表
BASE_MODELS = [
    "gemini-2.5-pro-preview-06-05",
    "gemini-2.5-pro",
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.5-pro-preview-03-25",
    "gemini-2.5-flash",
    "gemini-2.5-flash-image",
    "gemini-2.5-flash-image-preview",
    "gemini-2.5-flash-lite"
]

def get_base_model_name(model_name):
    """Convert variant model name to base model name."""
    # Remove all possible suffixes in order
    suffixes = ["-maxthinking", "-nothinking", "-search"]
    for suffix in suffixes:
        if model_name.endswith(suffix):
            return model_name[:-len(suffix)]
    return model_name

def is_search_model(model_name):
    """Check if model name indicates search grounding should be enabled."""
    return "-search" in model_name

def is_nothinking_model(model_name):
    """Check if model name indicates thinking should be disabled."""
    return "-nothinking" in model_name

def is_maxthinking_model(model_name):
    """Check if model name indicates maximum thinking budget should be used."""
    return "-maxthinking" in model_name

def is_image_model(model_name):
    """Check if model is an image generation model that doesn't support thinking."""
    base_model = get_base_model_name(model_name)
    return "image" in base_model.lower()
```

### 思考模式配置

```python
def get_thinking_budget(model_name):
    """Get the appropriate thinking budget for a model based on its name and variant."""
    
    # 绘图模型不支持thinking配置
    if is_image_model(model_name):
        return None
    
    if is_maxthinking_model(model_name):
        base_model = get_base_model_name(model_name)
        # pro模型使用32768，flash模型使用24576
        if "pro" in base_model.lower():
            return 32768
        else:
            return 24576
    else:
        # Default thinking budget for regular models
        return -1  # Default for all models

def should_include_thoughts(model_name):
    """Check if thoughts should be included in the response."""
    if is_nothinking_model(model_name):
        # For nothinking mode, still include thoughts if it's a pro model
        base_model = get_base_model_name(model_name)
        return "gemini-2.5-pro" in base_model
    else:
        # For all other modes, include thoughts
        return True
```

### 特殊功能模型

```python
def is_fake_streaming_model(model_name: str) -> bool:
    """Check if model name indicates fake streaming should be used."""
    return model_name.startswith("假流式/")

def is_anti_truncation_model(model_name: str) -> bool:
    """Check if model name indicates anti-truncation should be used."""
    return model_name.startswith("流式抗截断/")

def get_base_model_from_feature_model(model_name: str) -> str:
    """Get base model name from feature model name."""
    # Remove feature prefixes
    for prefix in ["假流式/", "流式抗截断/"]:
        if model_name.startswith(prefix):
            return model_name[len(prefix):]
    return model_name
```

## 🌐 Google API客户端

### API调用核心

**文件位置**：`src/google_chat_api.py`

```python
async def send_gemini_request(api_payload: Dict[str, Any], is_streaming: bool, cred_mgr: CredentialManager):
    """发送请求到Google Gemini API"""
    
    # 1. 获取有效凭证
    credential_result = await cred_mgr.get_valid_credential()
    if not credential_result:
        raise Exception("当前无可用凭证")
    
    current_file, credential_data = credential_result
    
    # 2. 创建凭证对象
    credentials = Credentials.from_dict(credential_data)
    
    # 3. 刷新令牌（如果需要）
    await credentials.refresh_if_needed()
    
    # 4. 构建请求头
    headers = {
        "Authorization": f"Bearer {credentials.access_token}",
        "Content-Type": "application/json",
        "User-Agent": "geminicli-oauth/1.0",
    }
    
    # 5. 确定API端点
    model = api_payload.get("model", "gemini-2.5-pro")
    base_model = get_base_model_name(model)
    
    if is_streaming:
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{base_model}:streamGenerateContent"
    else:
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{base_model}:generateContent"
    
    # 6. 发送请求
    try:
        if is_streaming:
            # 流式请求
            response = await stream_post_async(
                endpoint,
                json=api_payload,
                headers=headers,
                timeout=300.0
            )
            return response
        else:
            # 非流式请求
            response = await post_async(
                endpoint,
                json=api_payload,
                headers=headers,
                timeout=300.0
            )
            
            # 7. 记录API调用结果
            if response.status_code == 200:
                await cred_mgr.record_api_call_result(current_file, True)
            else:
                await cred_mgr.record_api_call_result(current_file, False, response.status_code)
            
            # 8. 处理429错误
            if response.status_code == 429:
                log.warning(f"遇到429错误，强制轮换凭证: {current_file}")
                await cred_mgr.force_rotate_credential()
                
                # 重试请求
                retry_count = 0
                max_retries = await get_retry_429_max_retries()
                retry_interval = await get_retry_429_interval()
                
                while retry_count < max_retries:
                    retry_count += 1
                    log.info(f"429重试 {retry_count}/{max_retries}，等待 {retry_interval} 秒")
                    await asyncio.sleep(retry_interval)
                    
                    # 获取新凭证
                    new_credential_result = await cred_mgr.get_valid_credential()
                    if new_credential_result:
                        new_file, new_credential_data = new_credential_result
                        new_credentials = Credentials.from_dict(new_credential_data)
                        await new_credentials.refresh_if_needed()
                        
                        # 更新请求头
                        headers["Authorization"] = f"Bearer {new_credentials.access_token}"
                        
                        # 重试请求
                        retry_response = await post_async(
                            endpoint,
                            json=api_payload,
                            headers=headers,
                            timeout=300.0
                        )
                        
                        if retry_response.status_code == 200:
                            await cred_mgr.record_api_call_result(new_file, True)
                            return retry_response
                        elif retry_response.status_code != 429:
                            await cred_mgr.record_api_call_result(new_file, False, retry_response.status_code)
                            return retry_response
                
                # 所有重试都失败
                raise Exception(f"429错误重试 {max_retries} 次后仍然失败")
            
            return response
    
    except Exception as e:
        # 9. 记录API调用结果
        await cred_mgr.record_api_call_result(current_file, False)
        
        # 10. 处理凭证失效
        if "invalid_grant" in str(e) or "refresh_token" in str(e):
            log.warning(f"凭证可能失效，禁用并切换: {current_file}")
            await cred_mgr.set_cred_disabled(current_file, True)
        
        raise Exception(f"API请求失败: {str(e)}")
```

### HTTP客户端封装

**文件位置**：`src/httpx_client.py`

```python
import httpx
import asyncio
from typing import Optional, Dict, Any
from config import get_proxy_config
from log import log

# 全局HTTP客户端
_http_client: Optional[httpx.AsyncClient] = None
_client_lock = asyncio.Lock()

async def get_http_client() -> httpx.AsyncClient:
    """获取全局HTTP客户端实例"""
    global _http_client
    
    async with _client_lock:
        if _http_client is None or _http_client.is_closed:
            # 获取代理配置
            proxy_config = await get_proxy_config()
            
            # 创建客户端配置
            client_config = {
                "timeout": httpx.Timeout(300.0, connect=60.0),
                "limits": httpx.Limits(max_keepalive_connections=20, max_connections=100),
                "http2": True,
            }
            
            # 配置代理
            if proxy_config:
                client_config["proxies"] = {
                    "http://": proxy_config,
                    "https://": proxy_config,
                }
                log.info(f"使用代理: {proxy_config}")
            
            # 创建客户端
            _http_client = httpx.AsyncClient(**client_config)
            log.info("HTTP客户端已初始化")
        
        return _http_client

async def close_http_client():
    """关闭全局HTTP客户端"""
    global _http_client
    
    async with _client_lock:
        if _http_client and not _http_client.is_closed:
            await _http_client.aclose()
            _http_client = None
            log.info("HTTP客户端已关闭")

async def get_async(url: str, headers: Optional[Dict[str, str]] = None, timeout: Optional[float] = None) -> httpx.Response:
    """发送GET请求"""
    client = await get_http_client()
    
    request_config = {}
    if headers:
        request_config["headers"] = headers
    if timeout:
        request_config["timeout"] = timeout
    
    return await client.get(url, **request_config)

async def post_async(url: str, data: Optional[Dict[str, Any]] = None, json: Optional[Dict[str, Any]] = None,
                   headers: Optional[Dict[str, str]] = None, timeout: Optional[float] = None) -> httpx.Response:
    """发送POST请求"""
    client = await get_http_client()
    
    request_config = {}
    if data:
        request_config["data"] = data
    if json:
        request_config["json"] = json
    if headers:
        request_config["headers"] = headers
    if timeout:
        request_config["timeout"] = timeout
    
    return await client.post(url, **request_config)

async def stream_post_async(url: str, json: Optional[Dict[str, Any]] = None,
                            headers: Optional[Dict[str, str]] = None, timeout: Optional[float] = None) -> httpx.Response:
    """发送流式POST请求"""
    client = await get_http_client()
    
    request_config = {}
    if json:
        request_config["json"] = json
    if headers:
        request_config["headers"] = headers
    if timeout:
        request_config["timeout"] = timeout
    
    return await client.post(url, **request_config)
```

## 🔧 配置系统

### 环境变量配置

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `API_PASSWORD` | API访问密码 | `pwd` |
| `PANEL_PASSWORD` | 控制面板密码 | `pwd` |
| `CALLS_PER_ROTATION` | 凭证轮换调用次数 | `100` |
| `AUTO_BAN` | 自动封禁开关 | `false` |
| `AUTO_BAN_ERROR_CODES` | 自动封禁错误码 | `400,403` |
| `RETRY_429_ENABLED` | 429重试开关 | `true` |
| `RETRY_429_MAX_RETRIES` | 429最大重试次数 | `5` |
| `RETRY_429_INTERVAL` | 429重试间隔(秒) | `1` |
| `ANTI_TRUNCATION_MAX_ATTEMPTS` | 抗截断最大重试次数 | `3` |
| `COMPATIBILITY_MODE` | 兼容性模式开关 | `true` |
| `PROXY` | 网络代理URL | - |
| `GOOGLEAPIS_PROXY_URL` | Google APIs代理URL | `https://www.googleapis.com` |
| `CODE_ASSIST_ENDPOINT` | Code Assist端点 | `https://cloudcode-pa.googleapis.com` |

### 配置获取函数

```python
async def get_api_password() -> str:
    """获取API密码设置"""
    # 优先使用 API_PASSWORD，如果没有则使用通用 PASSWORD 保证兼容性
    api_password = await get_config_value("api_password", None, "API_PASSWORD")
    if api_password is not None:
        return str(api_password)
    
    # 兼容性：使用通用密码
    return str(await get_config_value("password", "pwd", "PASSWORD"))

async def get_calls_per_rotation() -> int:
    """获取每次轮换的调用次数设置"""
    env_value = os.getenv("CALLS_PER_ROTATION")
    if env_value:
        try:
            return int(env_value)
        except ValueError:
            pass
    
    return int(await get_config_value("calls_per_rotation", 100))

async def get_proxy_config() -> Optional[str]:
    """获取代理配置"""
    proxy_url = await get_config_value("proxy", env_var="PROXY")
    return proxy_url if proxy_url else None
```

## 📊 使用统计与配额管理

### 使用统计系统

**文件位置**：`src/usage_stats.py`

```python
class UsageStats:
    """使用统计管理类"""
    
    def __init__(self):
        self._storage_adapter = None
        self._lock = asyncio.Lock()
    
    async def initialize(self):
        """初始化使用统计系统"""
        self._storage_adapter = await get_storage_adapter()
    
    async def record_api_call(self, filename: str, model: str, success: bool):
        """记录API调用"""
        async with self._lock:
            try:
                # 获取当前状态
                state = await self._storage_adapter.get_credential_state(filename)
                
                # 更新统计
                if success:
                    state["last_success"] = time.time()
                    state["total_calls"] = state.get("total_calls", 0) + 1
                    
                    # 检查是否是Gemini Pro模型
                    if "gemini-2.5-pro" in model.lower():
                        state["gemini_2_5_pro_calls"] = state.get("gemini_2_5_pro_calls", 0) + 1
                    
                    # 检查是否需要重置每日计数
                    next_reset = state.get("next_reset_time")
                    if next_reset and time.time() >= next_reset:
                        state["gemini_2_5_pro_calls"] = 1
                        state["total_calls"] = 1
                        state["next_reset_time"] = self._get_next_reset_time()
                    elif not next_reset:
                        state["next_reset_time"] = self._get_next_reset_time()
                
                # 更新状态
                await self._storage_adapter.update_credential_state(filename, state)
                
            except Exception as e:
                log.error(f"记录API调用失败: {e}")
    
    def _get_next_reset_time(self) -> float:
        """获取下一次重置时间（UTC 07:00）"""
        now = datetime.now(timezone.utc)
        # 计算今天的UTC 07:00
        today_reset = now.replace(hour=7, minute=0, second=0, microsecond=0)
        # 如果当前时间已过今天的重置时间，则设置为明天的重置时间
        if now >= today_reset:
            tomorrow_reset = today_reset + timedelta(days=1)
            return tomorrow_reset.timestamp()
        else:
            return today_reset.timestamp()
    
    async def check_daily_limit(self, filename: str, model: str) -> bool:
        """检查是否超过每日限制"""
        try:
            state = await self._storage_adapter.get_credential_state(filename)
            
            # 检查是否需要重置每日计数
            next_reset = state.get("next_reset_time")
            if next_reset and time.time() >= next_reset:
                state["gemini_2_5_pro_calls"] = 0
                state["total_calls"] = 0
                state["next_reset_time"] = self._get_next_reset_time()
                await self._storage_adapter.update_credential_state(filename, state)
            
            # 获取限制
            gemini_pro_limit = state.get("daily_limit_gemini_2_5_pro", 100)
            total_limit = state.get("daily_limit_total", 1000)
            
            # 检查限制
            if "gemini-2.5-pro" in model.lower():
                return state.get("gemini_2_5_pro_calls", 0) < gemini_pro_limit
            else:
                return state.get("total_calls", 0) < total_limit
        
        except Exception as e:
            log.error(f"检查每日限制失败: {e}")
            return True  # 出错时默认允许请求
    
    async def get_usage_stats(self, filename: Optional[str] = None) -> Dict[str, Any]:
        """获取使用统计"""
        try:
            if filename:
                # 获取单个文件的统计
                state = await self._storage_adapter.get_credential_state(filename)
                return {
                    "filename": filename,
                    "gemini_2_5_pro_calls": state.get("gemini_2_5_pro_calls", 0),
                    "total_calls": state.get("total_calls", 0),
                    "last_success": state.get("last_success"),
                    "next_reset_time": state.get("next_reset_time"),
                    "daily_limit_gemini_2_5_pro": state.get("daily_limit_gemini_2_5_pro", 100),
                    "daily_limit_total": state.get("daily_limit_total", 1000)
                }
            else:
                # 获取所有文件的统计
                all_credentials = await self._storage_adapter.list_credentials()
                all_states = await self._storage_adapter.get_all_credential_states()
                
                stats = {}
                for cred_name in all_credentials:
                    state = all_states.get(cred_name, {})
                    stats[cred_name] = {
                        "gemini_2_5_pro_calls": state.get("gemini_2_5_pro_calls", 0),
                        "total_calls": state.get("total_calls", 0),
                        "last_success": state.get("last_success"),
                        "next_reset_time": state.get("next_reset_time"),
                        "daily_limit_gemini_2_5_pro": state.get("daily_limit_gemini_2_5_pro", 100),
                        "daily_limit_total": state.get("daily_limit_total", 1000)
                    }
                
                return stats
        
        except Exception as e:
            log.error(f"获取使用统计失败: {e}")
            return {}
    
    async def update_daily_limits(self, filename: str, gemini_2_5_pro_limit: Optional[int] = None, 
                                total_limit: Optional[int] = None):
        """更新每日限制"""
        try:
            state = await self._storage_adapter.get_credential_state(filename)
            
            if gemini_2_5_pro_limit is not None:
                state["daily_limit_gemini_2_5_pro"] = gemini_2_5_pro_limit
            
            if total_limit is not None:
                state["daily_limit_total"] = total_limit
            
            await self._storage_adapter.update_credential_state(filename, state)
            
        except Exception as e:
            log.error(f"更新每日限制失败: {e}")
    
    async def reset_stats(self, filename: Optional[str] = None):
        """重置使用统计"""
        try:
            if filename:
                # 重置单个文件的统计
                state = await self._storage_adapter.get_credential_state(filename)
                state["gemini_2_5_pro_calls"] = 0
                state["total_calls"] = 0
                await self._storage_adapter.update_credential_state(filename, state)
            else:
                # 重置所有文件的统计
                all_credentials = await self._storage_adapter.list_credentials()
                for cred_name in all_credentials:
                    state = await self._storage_adapter.get_credential_state(cred_name)
                    state["gemini_2_5_pro_calls"] = 0
                    state["total_calls"] = 0
                    await self._storage_adapter.update_credential_state(cred_name, state)
        
        except Exception as e:
            log.error(f"重置使用统计失败: {e}")
```

## 🔄 任务管理系统

### 任务管理器

**文件位置**：`src/task_manager.py`

```python
import asyncio
from typing import Callable, Any, Optional
from log import log

class TaskManager:
    """全局任务管理器"""
    
    def __init__(self):
        self._tasks = set()
        self._lock = asyncio.Lock()
    
    async def create_task(self, coro, name: Optional[str] = None) -> asyncio.Task:
        """创建并跟踪任务"""
        async with self._lock:
            task = asyncio.create_task(coro, name=name)
            self._tasks.add(task)
            
            # 添加完成回调，自动清理
            task.add_done_callback(self._task_done_callback)
            
            return task
    
    def _task_done_callback(self, task: asyncio.Task):
        """任务完成回调"""
        try:
            # 检查任务是否有异常
            if task.exception():
                log.error(f"任务 {task.get_name()} 异常: {task.exception()}")
        except:
            pass  # 任务可能已被取消
        
        # 从跟踪集合中移除
        self._tasks.discard(task)
    
    async def shutdown_all_tasks(self, timeout: float = 10.0):
        """关闭所有任务"""
        async with self._lock:
            if not self._tasks:
                return
            
            log.info(f"正在关闭 {len(self._tasks)} 个任务...")
            
            # 取消所有任务
            for task in self._tasks:
                if not task.done():
                    task.cancel()
            
            # 等待所有任务完成或超时
            if self._tasks:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(*self._tasks, return_exceptions=True),
                        timeout=timeout
                    )
                except asyncio.TimeoutError:
                    log.warning(f"任务关闭超时 ({timeout}秒)")
            
            # 清空任务集合
            self._tasks.clear()
            log.info("所有任务已关闭")

# 全局任务管理器实例
task_manager = TaskManager()

def create_managed_task(coro, name: Optional[str] = None) -> asyncio.Task:
    """创建被管理的任务"""
    return asyncio.create_task(
        task_manager.create_task(coro, name=name)
    )

async def shutdown_all_tasks(timeout: float = 10.0):
    """关闭所有任务"""
    await task_manager.shutdown_all_tasks(timeout)
```

## 🚀 部署与配置

### Docker配置示例

```dockerfile
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装Python依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建凭证目录
RUN mkdir -p /app/creds

# 设置环境变量
ENV PYTHONUNBUFFERED=1
ENV LOG_LEVEL=info
ENV LOG_FILE=/app/log.txt

# 暴露端口
EXPOSE 7861

# 启动命令
CMD ["python", "web.py"]
```

### Docker Compose配置示例

```yaml
version: '3.8'

services:
  gcli2api:
    image: ghcr.io/zhongruan0522/geminicli2api:latest
    container_name: gcli2api
    restart: unless-stopped
    network_mode: host
    environment:
      # 基础配置
      - PASSWORD=pwd
      - PORT=7861
      - LOG_LEVEL=info
      
      # 代理配置（可选）
      # - PROXY=http://127.0.0.1:7890
      # - GOOGLEAPIS_PROXY_URL=http://127.0.0.1:7890
      
      # 凭证配置
      - AUTO_LOAD_ENV_CREDS=true
      
      # 性能配置
      - CALLS_PER_ROTATION=100
      - RETRY_429_ENABLED=true
      - RETRY_429_MAX_RETRIES=5
      - RETRY_429_INTERVAL=1
      
      # 功能配置
      - ANTI_TRUNCATION_MAX_ATTEMPTS=3
      - COMPATIBILITY_MODE=true
    volumes:
      - ./data/creds:/app/creds
      - ./data/log:/app/log
```

### 环境变量配置示例

```bash
# 基础配置
export PASSWORD=pwd
export PORT=7861
export LOG_LEVEL=info

# 代理配置（可选）
export PROXY=http://127.0.0.1:7890
export GOOGLEAPIS_PROXY_URL=http://127.0.0.1:7890

# 凭证配置
export AUTO_LOAD_ENV_CREDS=true

# 性能配置
export CALLS_PER_ROTATION=100
export RETRY_429_ENABLED=true
export RETRY_429_MAX_RETRIES=5
export RETRY_429_INTERVAL=1

# 功能配置
export ANTI_TRUNCATION_MAX_ATTEMPTS=3
export COMPATIBILITY_MODE=true

# 环境变量凭证
export GCLI_CREDS_ACCOUNT1="$(cat account1.json | base64 -w 0)"
export GCLI_CREDS_ACCOUNT2="$(cat account2.json | base64 -w 0)"
export GCLI_CREDS_ACCOUNT3="$(cat account3.json | base64 -w 0)"
```

## 🔧 故障排除

### 常见问题及解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| API请求失败 | 凭证失效或网络问题 | 检查凭证状态和网络连接 |
| 流式响应中断 | 网络超时或服务器问题 | 增加超时时间或重试请求 |
| 模型不支持 | 模型名称错误或不可用 | 检查模型列表和名称 |
| 凭证轮换失败 | 所有凭证都被禁用 | 检查凭证状态并重新认证 |
| 429错误频繁 | 请求频率过高 | 调整请求频率或增加凭证 |

### 调试技巧

1. **启用调试日志**：
   ```bash
   export LOG_LEVEL=debug
   ```

2. **检查凭证状态**：
   ```javascript
   fetch('/creds/status', {
       headers: {
           'Authorization': `Bearer ${token}`
       }
   })
   .then(response => response.json())
   .then(data => console.log(data));
   ```

3. **查看使用统计**：
   ```javascript
   fetch('/usage/stats', {
       headers: {
           'Authorization': `Bearer ${token}`
       }
   })
   .then(response => response.json())
   .then(data => console.log(data));
   ```

4. **检查API响应**：
   ```python
   import httpx
   
   async def test_api():
       response = await httpx.post(
           "http://127.0.0.1:7861/v1/chat/completions",
           json={
               "model": "gemini-2.5-pro",
               "messages": [{"role": "user", "content": "Hello"}]
           },
           headers={"Authorization": "Bearer pwd"}
       )
       print(response.status_code)
       print(response.json())
   
   asyncio.run(test_api())