"""
OpenAI Router - Handles OpenAI format API requests
处理OpenAI格式请求的路由模块
"""
import json
import time
import uuid
import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import get_available_models
from log import log
from .credential_manager import CredentialManager
from .google_chat_api import send_gemini_request
from .models import ChatCompletionRequest, ModelList, Model
from .task_manager import create_managed_task
from .openai_transfer import openai_request_to_gemini_payload, gemini_response_to_openai, gemini_stream_chunk_to_openai

# 创建路由器
router = APIRouter()
security = HTTPBearer()

# 全局凭证管理器实例
credential_manager = None

@asynccontextmanager
async def get_credential_manager():
    """获取全局凭证管理器实例"""
    global credential_manager
    if not credential_manager:
        credential_manager = CredentialManager()
        await credential_manager.initialize()
    yield credential_manager

async def authenticate(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """验证用户密码"""
    from config import get_api_password
    password = await get_api_password()
    token = credentials.credentials
    if token != password:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="密码错误")
    return token

@router.get("/v1/models", response_model=ModelList)
async def list_models():
    """返回OpenAI格式的模型列表"""
    models = get_available_models("openai")
    return ModelList(data=[Model(id=m) for m in models])

@router.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    token: str = Depends(authenticate)
):
    """处理OpenAI格式的聊天完成请求"""
    
    # 获取原始请求数据
    try:
        raw_data = await request.json()
    except Exception as e:
        log.error(f"Failed to parse JSON request: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")
    
    # 创建请求对象
    try:
        request_data = ChatCompletionRequest(**raw_data)
    except Exception as e:
        log.error(f"Request validation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Request validation error: {str(e)}")
    
    # 健康检查
    if (len(request_data.messages) == 1 and 
        getattr(request_data.messages[0], "role", None) == "user" and
        getattr(request_data.messages[0], "content", None) == "Hi"):
        return JSONResponse(content={
            "choices": [{"message": {"role": "assistant", "content": "gcli2api正常工作中"}}]
        })
    
    # 限制max_tokens
    if getattr(request_data, "max_tokens", None) is not None and request_data.max_tokens > 65535:
        request_data.max_tokens = 65535
        
    # 覆写 top_k 为 64
    setattr(request_data, "top_k", 64)

    # 过滤空消息
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

    # 获取凭证管理器
    from src.credential_manager import get_credential_manager
    cred_mgr = await get_credential_manager()

    # 获取有效凭证
    credential_result = await cred_mgr.get_valid_credential()
    if not credential_result:
        log.error("当前无可用凭证，请去控制台获取")
        raise HTTPException(status_code=500, detail="当前无可用凭证，请去控制台获取")

    current_file = credential_result
    log.debug(f"Using credential: {current_file}")

    # 增加调用计数
    cred_mgr.increment_call_count()

    # 转换为Gemini API payload格式
    try:
        api_payload = await openai_request_to_gemini_payload(request_data)
    except Exception as e:
        log.error(f"OpenAI to Gemini conversion failed: {e}")
        raise HTTPException(status_code=500, detail="Request conversion failed")

    # 发送请求（429重试已在google_api_client中处理）
    is_streaming = getattr(request_data, "stream", False)
    log.debug(f"Sending request: streaming={is_streaming}, model={model}")
    response = await send_gemini_request(api_payload, is_streaming, cred_mgr)
    
    # 如果是流式响应，直接返回
    if is_streaming:
        return await convert_streaming_response(response, model)
    
    # 转换非流式响应
    try:
        if hasattr(response, 'body'):
            response_data = json.loads(response.body.decode() if isinstance(response.body, bytes) else response.body)
        else:
            response_data = json.loads(response.content.decode() if isinstance(response.content, bytes) else response.content)

        openai_response = gemini_response_to_openai(response_data, model)
        return JSONResponse(content=openai_response)

    except Exception as e:
        log.error(f"Response conversion failed: {e}")
        log.error(f"Response object: {response}")
        raise HTTPException(status_code=500, detail="Response conversion failed")

async def convert_streaming_response(gemini_response, model: str) -> StreamingResponse:
    """转换流式响应为OpenAI格式"""
    response_id = str(uuid.uuid4())
    
    async def openai_stream_generator():
        try:
            # 处理不同类型的响应对象
            if hasattr(gemini_response, 'body_iterator'):
                # FastAPI StreamingResponse
                async for chunk in gemini_response.body_iterator:
                    if not chunk:
                        continue
                    
                    # 处理不同数据类型的startswith问题
                    if isinstance(chunk, bytes):
                        if not chunk.startswith(b'data: '):
                            continue
                        payload = chunk[len(b'data: '):]
                    else:
                        chunk_str = str(chunk)
                        if not chunk_str.startswith('data: '):
                            continue
                        payload = chunk_str[len('data: '):].encode()
                    try:
                        gemini_chunk = json.loads(payload.decode())
                        openai_chunk = gemini_stream_chunk_to_openai(gemini_chunk, model, response_id)
                        yield f"data: {json.dumps(openai_chunk, separators=(',',':'))}\n\n".encode()
                    except json.JSONDecodeError:
                        continue
            else:
                # 其他类型的响应，尝试直接处理
                log.warning(f"Unexpected response type: {type(gemini_response)}")
                error_chunk = {
                    "id": response_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {"role": "assistant", "content": "Response type error"},
                        "finish_reason": "stop"
                    }]
                }
                yield f"data: {json.dumps(error_chunk)}\n\n".encode()
            
            # 发送结束标记
            yield "data: [DONE]\n\n".encode()
            
        except Exception as e:
            log.error(f"Stream conversion error: {e}")
            error_chunk = {
                "id": response_id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {"role": "assistant", "content": f"Stream error: {str(e)}"},
                    "finish_reason": "stop"
                }]
            }
            yield f"data: {json.dumps(error_chunk)}\n\n".encode()
            yield "data: [DONE]\n\n".encode()

    return StreamingResponse(openai_stream_generator(), media_type="text/event-stream")