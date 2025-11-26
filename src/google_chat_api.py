"""
Google API Client - Handles all communication with Google's Gemini API.
This module is used by both OpenAI compatibility layer and native Gemini endpoints.
"""
import asyncio
import gc
import json
import time
import uuid

from fastapi import Response
from fastapi.responses import StreamingResponse

from config import (
    get_code_assist_endpoint,
    DEFAULT_SAFETY_SETTINGS,
    get_base_model_name,
    get_thinking_budget,
    should_include_thoughts,
    is_search_model,
    get_auto_ban_enabled,
    get_auto_ban_error_codes,
    get_retry_429_max_retries,
    get_retry_429_enabled,
    get_retry_429_interval,
    PUBLIC_API_MODELS,
)
from .httpx_client import http_client, create_streaming_client_with_kwargs
from log import log
from .call_trace import log_call_event
from .credential_manager import CredentialManager
from .usage_stats import record_successful_call, get_usage_stats_instance
from .utils import get_user_agent
from .api_call_logger import log_api_call

def _create_error_response(message: str, status_code: int = 500) -> Response:
    """Create standardized error response."""
    return Response(
        content=json.dumps({
            "error": {
                "message": message,
                "type": "api_error",
                "code": status_code
            }
        }),
        status_code=status_code,
        media_type="application/json"
    )

async def _handle_api_error(credential_manager: CredentialManager, status_code: int, response_content: str = ""):
    """Handle API errors by rotating credentials when needed. Error recording should be done before calling this function."""
    if status_code == 429 and credential_manager:
        if response_content:
            log.error(f"Google API returned status 429 - quota exhausted. Response details: {response_content[:500]}")
        else:
            log.error("Google API returned status 429 - quota exhausted, switching credentials")
        await credential_manager.force_rotate_credential()
    
    # 处理自动封禁的错误码
    elif await get_auto_ban_enabled() and status_code in await get_auto_ban_error_codes() and credential_manager:
        if response_content:
            log.error(f"Google API returned status {status_code} - auto ban triggered. Response details: {response_content[:500]}")
        else:
            log.warning(f"Google API returned status {status_code} - auto ban triggered, rotating credentials")
        await credential_manager.force_rotate_credential()


async def _is_quota_available_for_credential(credential_file: str, model_name: str) -> bool:
    """
    检查指定凭证在当前模型上的每日配额是否仍然可用。

    使用 usage_stats 中的统计数据：
    - pro_model_calls / daily_limit_pro_models
    - total_calls / daily_limit_total

    Pro 模型的判断逻辑基于基础模型名中是否包含 "pro"，与 usage_stats 中的统计逻辑保持一致。
    """
    if not credential_file:
        return False

    try:
        stats_instance = await get_usage_stats_instance()
        # 这里会自动触发每日配额重置逻辑
        usage = await stats_instance.get_usage_stats(credential_file)

        pro_calls = usage.get("pro_model_calls", 0)
        total_calls = usage.get("total_calls", 0)
        # 使用动态默认值保持一致性
        pro_limit = usage.get("daily_limit_pro_models", 75)
        total_limit = usage.get("daily_limit_total", 600)

        # 检查总配额
        if total_calls >= total_limit:
            log.info(
                f"Credential {credential_file} has exhausted total daily quota "
                f"({total_calls}/{total_limit}), skipping this credential"
            )
            return False

        # 根据模型是否为 Pro 模型检查 Pro 配额
        base_model_name = get_base_model_name(model_name or "")
        is_pro_model = "pro" in base_model_name.lower() if base_model_name else False

        if is_pro_model and pro_calls >= pro_limit:
            log.info(
                f"Credential {credential_file} has exhausted Pro daily quota "
                f"({pro_calls}/{pro_limit}) for model {base_model_name}, skipping this credential"
            )
            return False

        return True

    except Exception as e:
        # 配额检查失败时，为了不影响主流程，保守地认为可用，但记录错误日志
        log.error(f"Failed to check usage quota for {credential_file}: {e}")
        return True


async def _select_credential_respecting_quota(
    credential_manager: CredentialManager,
    model_name: str,
    trace_id: str = None,
):
    """
    在凭证轮换的基础上，考虑每日使用配额选择可用凭证。

    逻辑：
    1. 通过 credential_manager.get_valid_credential() 获取当前可用凭证
    2. 查询该凭证的使用统计，判断是否触达每日配额
    3. 若配额已满，则尝试轮换到下一个凭证，但不标记 disabled，避免跨天失效
    4. 通过 visited 集合避免死循环：如果所有凭证都检查过仍无可用配额，则返回 None

    返回值：
    - (current_file, credential_data): 正常情况
    - None, "no_credentials": 没有配置任何凭据或都被禁用
    - None, "quota_exhausted": 所有凭据的每日配额已满
    - None, "model_not_allowed": 存在凭据，但没有任何凭据允许当前模型
    """
    if not credential_manager:
        if trace_id:
            log_call_event(trace_id, "select_credential_no_manager", {})
        return None, "no_credentials"

    # 归一化基础模型名，用于按base model做授权检查
    base_model = get_base_model_name(model_name or "")
    visited = set()
    # 如果没有明确的基础模型名，默认视为“允许所有模型”，避免被误杀
    any_model_allowed = False if base_model else True

    while True:
        loop_start = time.time()
        credential_result = await credential_manager.get_valid_credential()
        if trace_id and credential_result:
            current_file_preview = credential_result[0]
            log_call_event(
                trace_id,
                "select_get_valid_credential",
                {
                    "credential": current_file_preview,
                    "elapsed_ms": int((time.time() - loop_start) * 1000),
                },
            )
        if not credential_result:
            # 检查是否真的没有配置凭据，还是配额都用完了
            try:
                # 获取所有凭据来判断情况
                all_creds = await credential_manager.get_all_credentials()
                if not all_creds:
                    log.error("No credentials configured")
                    if trace_id:
                        log_call_event(trace_id, "select_no_credentials", {})
                    return None, "no_credentials"
                else:
                    # 有凭据但get_valid_credential返回None，说明都被禁用了
                    log.error("All credentials are disabled")
                    if trace_id:
                        log_call_event(trace_id, "select_all_credentials_disabled", {})
                    return None, "no_credentials"
            except Exception:
                # 如果无法获取所有凭据，保守处理
                    log.error("Unable to determine credential availability")
                    if trace_id:
                        log_call_event(trace_id, "select_credential_unknown_state", {})
                    return None, "no_credentials"

        current_file, credential_data = credential_result
        if not current_file:
            if trace_id:
                log_call_event(trace_id, "select_empty_current_file", {})
            return None, "no_credentials"

        # 检查是否已经完整遍历过一轮
        if current_file in visited:
            # 如果到这里都没有任何凭证允许该模型，则返回模型未授权错误
            if not any_model_allowed and base_model:
                log.error(f"No credential allows requested model base '{base_model}'")
                if trace_id:
                    log_call_event(
                        trace_id,
                        "select_model_not_allowed",
                        {"base_model": base_model},
                    )
                return None, "model_not_allowed"

            log.error("All credentials have exhausted their daily quotas (or are otherwise unusable)")
            if trace_id:
                log_call_event(trace_id, "select_quota_exhausted_all", {})
            return None, "quota_exhausted"

        visited.add(current_file)

        # 先做模型授权检查，再做配额检查，避免在不支持该模型的凭证上浪费配额判断
        if base_model:
            try:
                model_allowed_start = time.time()
                model_allowed = await credential_manager.is_model_allowed_for_credential(
                    current_file,
                    base_model,
                )
                if trace_id:
                    log_call_event(
                        trace_id,
                        "select_model_allowed_check",
                        {
                            "credential": current_file,
                            "base_model": base_model,
                            "allowed": bool(model_allowed),
                            "elapsed_ms": int(
                                (time.time() - model_allowed_start) * 1000
                            ),
                        },
                    )
            except Exception as e:
                log.error(f"Failed to check model permission for credential {current_file}: {e}")
                model_allowed = True

            if not model_allowed:
                log.info(
                    f"Credential {current_file} does not allow model base '{base_model}', "
                    f"rotating to next credential"
                )
                if trace_id:
                    log_call_event(
                        trace_id,
                        "select_model_not_allowed_single",
                        {"credential": current_file, "base_model": base_model},
                    )
                try:
                    await credential_manager.force_rotate_credential()
                except Exception as e:
                    log.error(f"Failed to rotate credential after model permission check: {e}")
                    return None, "quota_exhausted"
                # 不标记 any_model_allowed，继续找下一个凭证
                continue
            else:
                any_model_allowed = True

        # 然后检查配额
        quota_start = time.time()
        quota_ok = await _is_quota_available_for_credential(current_file, model_name)
        if trace_id:
            log_call_event(
                trace_id,
                "select_quota_checked",
                {
                    "credential": current_file,
                    "quota_ok": bool(quota_ok),
                    "elapsed_ms": int((time.time() - quota_start) * 1000),
                },
            )
        if quota_ok:
            # 当前凭证在配额范围内，可以使用
            if trace_id:
                log_call_event(
                    trace_id,
                    "select_credential_chosen",
                    {"credential": current_file},
                )
            return current_file, credential_data

        # 当前凭证配额已满，尝试轮换到下一个凭证
        log.info(f"Credential {current_file} has no remaining quota, rotating to next credential")
        try:
            if trace_id:
                log_call_event(
                    trace_id,
                    "select_quota_exhausted_single",
                    {"credential": current_file},
                )
            await credential_manager.force_rotate_credential()
        except Exception as e:
            log.error(f"Failed to rotate credential after quota exhaustion: {e}")
            return None, "quota_exhausted"

async def _prepare_request_headers_and_payload(payload: dict, credential_data: dict, use_public_api: bool, target_url: str):
    """Prepare request headers and final payload from credential data."""
    token = credential_data.get('token') or credential_data.get('access_token', '')
    if not token:
        raise Exception("凭证中没有找到有效的访问令牌（token或access_token字段）")


    source_request=payload.get("request", {})
    if use_public_api:
         if "generationConfig" in source_request:
            imageConfig = source_request["generationConfig"].get('imageConfig')
            source_request["generationConfig"] = {'imageConfig': imageConfig} if imageConfig else {}
    
    # 内部API使用Bearer Token和项目ID
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": get_user_agent(),
    }
    project_id = credential_data.get("project_id", "")
    if not project_id:
        raise Exception("项目ID不存在于凭证数据中")
    final_payload = {
        "model": payload.get("model"),
        "project": project_id,
        "request": source_request
    }
    
    return headers, final_payload, target_url

async def send_gemini_request(payload: dict, is_streaming: bool = False, credential_manager: CredentialManager = None) -> Response:
    """
    Send a request to Google's Gemini API.
    
    Args:
        payload: The request payload in Gemini format
        is_streaming: Whether this is a streaming request
        credential_manager: CredentialManager instance
        
    Returns:
        FastAPI Response object
    """
    trace_id = payload.pop("_trace_id", None)
    if not trace_id:
        trace_id = str(uuid.uuid4())
    call_start = time.time()
    log_call_event(
        trace_id,
        "call_start",
        {
            "model": payload.get("model", ""),
            "is_streaming": bool(is_streaming),
        },
    )

    # 获取429重试配置
    max_retries = await get_retry_429_max_retries()
    retry_429_enabled = await get_retry_429_enabled()
    retry_interval = await get_retry_429_interval()
    
    # 动态确定API端点和payload格式
    model_name = payload.get("model", "")
    base_model_name = get_base_model_name(model_name)
    use_public_api = base_model_name in PUBLIC_API_MODELS
    action = "streamGenerateContent" if is_streaming else "generateContent"
    target_url = f"{await get_code_assist_endpoint()}/v1internal:{action}"
    if is_streaming:
        target_url += "?alt=sse"

    # 确保有credential_manager
    if not credential_manager:
        log_call_event(trace_id, "call_no_credential_manager", {})
        return _create_error_response("Credential manager not provided", 500)
    
    # 获取当前凭证
    try:
        # 在所有凭据里挑一个"还在日配额内"的
        select_start = time.time()
        credential_result = await _select_credential_respecting_quota(
            credential_manager,
            model_name,
            trace_id,
        )
        if not credential_result or credential_result[0] is None:
            reason = credential_result[1] if credential_result and len(credential_result) > 1 else "unknown"
            log_call_event(
                trace_id,
                "call_select_credential_failed",
                {
                    "reason": reason,
                    "elapsed_ms": int((time.time() - select_start) * 1000),
                },
            )
            if reason == "no_credentials":
                # 没有配置凭据或都被禁用，返回500
                return _create_error_response("No valid credentials available", 500)
            elif reason == "model_not_allowed":
                # 有凭证但没有任何凭证允许当前模型
                return _create_error_response(
                    f"Requested model '{model_name}' is not allowed by any configured credential",
                    400,
                )
            else:
                # 所有凭据都超出 daily_limit_xxx 了，直接 429
                return _create_error_response(
                    "[非google限制] All credentials have exhausted their daily quotas",
                    429,
                )

        current_file, credential_data = credential_result
        log_call_event(
            trace_id,
            "call_select_credential_ok",
            {
                "credential": current_file,
                "elapsed_ms": int((time.time() - select_start) * 1000),
            },
        )
        headers, final_payload, target_url = await _prepare_request_headers_and_payload(
            payload,
            credential_data,
            use_public_api,
            target_url,
        )
    except Exception as e:
        log_call_event(
            trace_id,
            "call_select_credential_exception",
            {"error": str(e)},
        )
        return _create_error_response(str(e), 500)

    # 预序列化payload，避免重试时重复序列化
    final_post_data = json.dumps(final_payload)
    

    for attempt in range(max_retries + 1):
        try:
            if is_streaming:
                # 流式请求处理 - 使用httpx_client模块的统一配置
                client = await create_streaming_client_with_kwargs()
                
                try:
                    # 使用stream方法但不在async with块中消费数据
                    request_start = time.time()
                    log_call_event(
                        trace_id,
                        "http_attempt_start",
                        {
                            "attempt": attempt,
                            "is_streaming": True,
                            "url": target_url,
                        },
                    )
                    stream_ctx = client.stream("POST", target_url, content=final_post_data, headers=headers)
                    resp = await stream_ctx.__aenter__()
                    log_call_event(
                        trace_id,
                        "http_attempt_response",
                        {
                            "attempt": attempt,
                            "status_code": resp.status_code,
                            "elapsed_ms": int((time.time() - request_start) * 1000),
                            "is_streaming": True,
                        },
                    )
                    
                    if resp.status_code == 429:
                        # 记录429错误并获取响应内容
                        response_content = ""
                        try:
                            content_bytes = await resp.aread()
                            if isinstance(content_bytes, bytes):
                                response_content = content_bytes.decode('utf-8', errors='ignore')
                        except Exception as e:
                            log.debug(f"[STREAMING] Failed to read 429 response content: {e}")
                        
                        # 显示详细的429错误信息
                        if response_content:
                            log.error(f"Google API returned status 429 (STREAMING). Response details: {response_content[:500]}")
                        else:
                            log.error("Google API returned status 429 (STREAMING) - quota exhausted, no response details available")
                        
                        if credential_manager and current_file:
                            await credential_manager.record_api_call_result(current_file, False, 429)
                        
                        # 清理资源
                        try:
                            await stream_ctx.__aexit__(None, None, None)
                        except:
                            pass
                        await client.aclose()
                        
                        # 如果重试可用且未达到最大次数，进行重试
                        if retry_429_enabled and attempt < max_retries:
                            log.warning(f"[RETRY] 429 error encountered, retrying ({attempt + 1}/{max_retries})")
                            if credential_manager:
                                # 这里也要尊重 daily_limit（_select_credential_respecting_quota 会自己处理 rotation）
                                new_credential_result = await _select_credential_respecting_quota(
                                    credential_manager,
                                    model_name,
                                    trace_id,
                                )
                                if not new_credential_result or new_credential_result[0] is None:
                                    reason = new_credential_result[1] if new_credential_result and len(new_credential_result) > 1 else "unknown"
                                    if reason == "no_credentials":
                                        # 已经没有任何可用凭据了，直接返回 500
                                        async def error_stream():
                                            error_response = {
                                                "error": {
                                                    "message": "No valid credentials available",
                                                    "type": "api_error",
                                                    "code": 500,
                                                }
                                            }
                                            yield f"data: {json.dumps(error_response)}\n\n"
                                        log_call_event(
                                            trace_id,
                                            "http_attempt_quota_no_credentials",
                                            {
                                                "attempt": attempt,
                                                "status_code": 500,
                                            },
                                        )
                                        return StreamingResponse(error_stream(), media_type="text/event-stream", status_code=500)
                                    elif reason == "model_not_allowed":
                                        # 存在凭据，但没有任何凭据允许当前模型
                                        async def error_stream():
                                            error_response = {
                                                "error": {
                                                    "message": f"Requested model '{model_name}' is not allowed by any configured credential",
                                                    "type": "api_error",
                                                    "code": 400,
                                                }
                                            }
                                            yield f"data: {json.dumps(error_response)}\n\n"
                                        log_call_event(
                                            trace_id,
                                            "http_attempt_quota_model_not_allowed",
                                            {
                                                "attempt": attempt,
                                                "status_code": 400,
                                            },
                                        )
                                        return StreamingResponse(error_stream(), media_type="text/event-stream", status_code=400)
                                    else:
                                        # 已经没有任何在配额内的凭据了，直接返回 429，不再死循环重试
                                        async def error_stream():
                                            error_response = {
                                                "error": {
                                                    "message": "[非google限制] All credentials have exhausted their daily quotas",
                                                    "type": "api_error",
                                                    "code": 429,
                                                }
                                            }
                                            yield f"data: {json.dumps(error_response)}\n\n"
                                        log_call_event(
                                            trace_id,
                                            "http_attempt_quota_exhausted_all",
                                            {
                                                "attempt": attempt,
                                                "status_code": 429,
                                            },
                                        )
                                        return StreamingResponse(error_stream(), media_type="text/event-stream", status_code=429)

                                current_file, credential_data = new_credential_result
                                headers, updated_payload, target_url = await _prepare_request_headers_and_payload(payload, credential_data, use_public_api, target_url)
                                final_post_data = json.dumps(updated_payload)
                            await asyncio.sleep(retry_interval)
                            continue  # 跳出内层处理，继续外层循环重试
                        else:
                            # 返回429错误流
                            async def error_stream():
                                error_response = {
                                    "error": {
                                        "message": "429 rate limit exceeded, max retries reached",
                                        "type": "api_error",
                                        "code": 429
                                    }
                                }
                                yield f"data: {json.dumps(error_response)}\n\n"
                            log_call_event(
                                trace_id,
                                "http_attempt_429_max_retries",
                                {
                                    "attempt": attempt,
                                    "status_code": 429,
                                },
                            )
                            return StreamingResponse(error_stream(), media_type="text/event-stream", status_code=429)
                    elif resp.status_code != 200:
                        # 处理其他非200状态码的错误
                        response_content = ""
                        try:
                            content_bytes = await resp.aread()
                            if isinstance(content_bytes, bytes):
                                response_content = content_bytes.decode('utf-8', errors='ignore')
                        except Exception as e:
                            log.debug(f"[STREAMING] Failed to read error response content: {e}")
                        
                        # 显示详细的错误信息
                        if response_content:
                            log.error(f"Google API returned status {resp.status_code} (STREAMING). Response details: {response_content[:500]}")
                        else:
                            log.error(f"Google API returned status {resp.status_code} (STREAMING) - no response details available")
                        
                        # 记录API调用错误
                        if credential_manager and current_file:
                            await credential_manager.record_api_call_result(current_file, False, resp.status_code)
                        
                        # 清理资源
                        try:
                            await stream_ctx.__aexit__(None, None, None)
                        except:
                            pass
                        await client.aclose()
                        
                        # 处理凭证轮换
                        await _handle_api_error(credential_manager, resp.status_code, response_content)
                        
                        # 返回错误流
                        async def error_stream():
                            error_response = {
                                "error": {
                                    "message": f"API error: {resp.status_code}",
                                    "type": "api_error", 
                                    "code": resp.status_code
                                }
                            }
                            yield f"data: {json.dumps(error_response)}\n\n"
                        log_call_event(
                            trace_id,
                            "http_attempt_streaming_error_status",
                            {
                                "attempt": attempt,
                                "status_code": resp.status_code,
                            },
                        )
                        return StreamingResponse(error_stream(), media_type="text/event-stream", status_code=resp.status_code)
                    else:
                        # 成功响应，传递所有资源给流式处理函数管理
                        return _handle_streaming_response_managed(
                            resp,
                            stream_ctx,
                            client,
                            credential_manager,
                            payload.get("model", ""),
                            current_file,
                            trace_id,
                        )
                        
                except Exception as e:
                    # 清理资源
                    try:
                        await client.aclose()
                    except:
                        pass
                    raise e

            else:
                # 非流式请求处理 - 使用httpx_client模块
                async with http_client.get_client(timeout=None) as client:
                    request_start = time.time()
                    log_call_event(
                        trace_id,
                        "http_attempt_start",
                        {
                            "attempt": attempt,
                            "is_streaming": False,
                            "url": target_url,
                        },
                    )
                    resp = await client.post(
                        target_url, content=final_post_data, headers=headers
                    )
                    log_call_event(
                        trace_id,
                        "http_attempt_response",
                        {
                            "attempt": attempt,
                            "status_code": resp.status_code,
                            "elapsed_ms": int((time.time() - request_start) * 1000),
                            "is_streaming": False,
                        },
                    )
                    
                    if resp.status_code == 429:
                        # 记录429错误
                        if credential_manager and current_file:
                            await credential_manager.record_api_call_result(current_file, False, 429)
                        
                        # 如果重试可用且未达到最大次数，继续重试
                        if retry_429_enabled and attempt < max_retries:
                            log.warning(f"[RETRY] 429 error encountered, retrying ({attempt + 1}/{max_retries})")
                            if credential_manager:
                                # 这里也要尊重 daily_limit（_select_credential_respecting_quota 会自己处理 rotation）
                                new_credential_result = await _select_credential_respecting_quota(
                                    credential_manager,
                                    model_name,
                                    trace_id,
                                )
                                if not new_credential_result or new_credential_result[0] is None:
                                    reason = new_credential_result[1] if new_credential_result and len(new_credential_result) > 1 else "unknown"
                                    if reason == "no_credentials":
                                        # 已经没有任何可用凭据了，直接返回 500
                                        log_call_event(
                                            trace_id,
                                            "http_attempt_quota_no_credentials",
                                            {
                                                "attempt": attempt,
                                                "status_code": 500,
                                            },
                                        )
                                        return _create_error_response("No valid credentials available", 500)
                                    elif reason == "model_not_allowed":
                                        # 存在凭据，但没有任何凭据允许当前模型
                                        log_call_event(
                                            trace_id,
                                            "http_attempt_quota_model_not_allowed",
                                            {
                                                "attempt": attempt,
                                                "status_code": 400,
                                            },
                                        )
                                        return _create_error_response(
                                            f"Requested model '{model_name}' is not allowed by any configured credential",
                                            400,
                                        )
                                    else:
                                        # 已经没有任何在配额内的凭据了，直接返回 429，不再死循环重试
                                        log_call_event(
                                            trace_id,
                                            "http_attempt_quota_exhausted_all",
                                            {
                                                "attempt": attempt,
                                                "status_code": 429,
                                            },
                                        )
                                        return _create_error_response(
                                            "[非google限制] All credentials have exhausted their daily quotas",
                                            429,
                                        )
                                current_file, credential_data = new_credential_result
                                headers, updated_payload, target_url = await _prepare_request_headers_and_payload(payload, credential_data, use_public_api, target_url)
                                final_post_data = json.dumps(updated_payload)
                            await asyncio.sleep(retry_interval)
                            continue
                        else:
                            log.error(f"[RETRY] Max retries exceeded for 429 error")
                            log_call_event(
                                trace_id,
                                "http_attempt_429_max_retries",
                                {
                                    "attempt": attempt,
                                    "status_code": 429,
                                },
                            )
                            return _create_error_response("429 rate limit exceeded, max retries reached", 429)
                    else:
                        # 非429错误或成功响应，正常处理
                        return await _handle_non_streaming_response(
                            resp,
                            credential_manager,
                            payload.get("model", ""),
                            current_file,
                            trace_id,
                        )
                    
        except Exception as e:
            if attempt < max_retries:
                log.warning(f"[RETRY] Request failed with exception, retrying ({attempt + 1}/{max_retries}): {str(e)}")
                await asyncio.sleep(retry_interval)
                continue
            else:
                log.error(f"Request to Google API failed: {str(e)}")
                log_call_event(
                    trace_id,
                    "call_exception",
                    {
                        "error": str(e),
                        "attempt": attempt,
                    },
                )
                return _create_error_response(f"Request failed: {str(e)}")
    
    # 如果循环结束仍未成功，返回错误
    log_call_event(
        trace_id,
        "call_max_retries_exceeded",
        {
            "max_retries": max_retries,
            "elapsed_ms": int((time.time() - call_start) * 1000),
        },
    )
    return _create_error_response("Max retries exceeded", 429)


def _handle_streaming_response_managed(
    resp,
    stream_ctx,
    client,
    credential_manager: CredentialManager = None,
    model_name: str = "",
    current_file: str = None,
    trace_id: str = None,
) -> StreamingResponse:
    """Handle streaming response with complete resource lifecycle management."""
    
    # 检查HTTP错误
    if resp.status_code != 200:
        # 立即清理资源并返回错误
        async def cleanup_and_error():
            try:
                await stream_ctx.__aexit__(None, None, None)
            except:
                pass
            try:
                await client.aclose()
            except:
                pass
            
            # 获取响应内容用于详细错误显示
            response_content = ""
            try:
                content_bytes = await resp.aread()
                if isinstance(content_bytes, bytes):
                    response_content = content_bytes.decode('utf-8', errors='ignore')
            except Exception as e:
                log.debug(f"[STREAMING] Failed to read response content for error analysis: {e}")
                response_content = ""
            
            # 显示详细错误信息
            if resp.status_code == 429:
                if response_content:
                    log.error(f"Google API returned status 429 (STREAMING). Response details: {response_content[:500]}")
                else:
                    log.error(f"Google API returned status 429 (STREAMING)")
            else:
                if response_content:
                    log.error(f"Google API returned status {resp.status_code} (STREAMING). Response details: {response_content[:500]}")
                else:
                    log.error(f"Google API returned status {resp.status_code} (STREAMING)")
            
            # 记录API调用错误
            if credential_manager and current_file:
                await credential_manager.record_api_call_result(current_file, False, resp.status_code)
            
            await _handle_api_error(credential_manager, resp.status_code, response_content)
            
            error_response = {
                "error": {
                    "message": f"API error: {resp.status_code}",
                    "type": "api_error",
                    "code": resp.status_code
                }
            }
            if trace_id:
                log_call_event(
                    trace_id,
                    "streaming_http_error",
                    {
                        "status_code": resp.status_code,
                    },
                )
            yield f'data: {json.dumps(error_response)}\n\n'.encode('utf-8')
        
        return StreamingResponse(
            cleanup_and_error(),
            media_type="text/event-stream",
            status_code=resp.status_code
        )
    
    # 正常流式响应处理，确保资源在流结束时被清理
    async def managed_stream_generator():
        success_recorded = False
        managed_stream_generator._chunk_count = 0  # 初始化chunk计数器
        first_chunk_logged = False
        usage_logged = False
        try:
            async for chunk in resp.aiter_lines():
                if not chunk or not chunk.startswith('data: '):
                    continue
                    
                # 记录第一次成功响应
                if not success_recorded:
                    if current_file and credential_manager:
                        await credential_manager.record_api_call_result(current_file, True)
                        # 记录到使用统计
                        try:
                            await record_successful_call(current_file, model_name)
                        except Exception as e:
                            log.debug(f"Failed to record usage statistics: {e}")
                    success_recorded = True
                
                payload = chunk[len('data: '):]
                try:
                    obj = json.loads(payload)
                    if "response" in obj:
                        data = obj["response"]
                        # 如果本次chunk包含 usageMetadata 且尚未记录，则记录一次API调用日志
                        if (
                            not usage_logged
                            and isinstance(data, dict)
                            and "usageMetadata" in data
                        ):
                            try:
                                usage = data.get("usageMetadata") or {}
                                prompt_tokens = usage.get("promptTokenCount")
                                completion_tokens = usage.get("candidatesTokenCount")
                                if current_file:
                                    log_api_call(
                                        current_file,
                                        model_name,
                                        prompt_tokens,
                                        completion_tokens,
                                    )
                                usage_logged = True
                            except Exception as e:
                                log.debug(f"Failed to log streaming API usage: {e}")
                        yield f"data: {json.dumps(data, separators=(',',':'))}\n\n".encode()
                        await asyncio.sleep(0)  # 让其他协程有机会运行
                        if trace_id and not first_chunk_logged:
                            first_chunk_logged = True
                            log_call_event(
                                trace_id,
                                "stream_first_chunk",
                                {
                                    "model": model_name,
                                },
                            )
                        
                        # 定期释放内存（每100个chunk）
                        if hasattr(managed_stream_generator, '_chunk_count'):
                            managed_stream_generator._chunk_count += 1
                            if managed_stream_generator._chunk_count % 100 == 0:
                                gc.collect()
                    else:
                        yield f"data: {json.dumps(obj, separators=(',',':'))}\n\n".encode()
                except json.JSONDecodeError:
                    continue
                    
        except Exception as e:
            log.error(f"Streaming error: {e}")
            err = {"error": {"message": str(e), "type": "api_error", "code": 500}}
            yield f"data: {json.dumps(err)}\n\n".encode()
        finally:
            if trace_id:
                log_call_event(
                    trace_id,
                    "stream_finished",
                    {
                        "model": model_name,
                    },
                )
            # 确保清理所有资源
            try:
                await stream_ctx.__aexit__(None, None, None)
            except Exception as e:
                log.debug(f"Error closing stream context: {e}")
            try:
                await client.aclose()
            except Exception as e:
                log.debug(f"Error closing client: {e}")

    return StreamingResponse(
        managed_stream_generator(),
        media_type="text/event-stream"
    )

async def _handle_non_streaming_response(
    resp,
    credential_manager: CredentialManager = None,
    model_name: str = "",
    current_file: str = None,
    trace_id: str = None,
) -> Response:
    """Handle non-streaming response from Google API."""
    if resp.status_code == 200:
        try:
            # 记录成功响应
            if current_file and credential_manager:
                await credential_manager.record_api_call_result(current_file, True)
                # 记录到使用统计
                try:
                    await record_successful_call(current_file, model_name)
                except Exception as e:
                    log.debug(f"Failed to record usage statistics: {e}")

            raw = await resp.aread()
            google_api_response = raw.decode('utf-8')
            if google_api_response.startswith('data: '):
                google_api_response = google_api_response[len('data: '):]
            google_api_response = json.loads(google_api_response)
            log.debug(f"Google API原始响应: {json.dumps(google_api_response, ensure_ascii=False)[:500]}...")
            standard_gemini_response = google_api_response.get("response")
            log.debug(f"提取的response字段: {json.dumps(standard_gemini_response, ensure_ascii=False)[:500]}...")
            # 如果存在 usageMetadata，则记录一次API调用日志（时间-凭证-模型-输入/输出tokens）
            try:
                if current_file and isinstance(standard_gemini_response, dict):
                    usage = standard_gemini_response.get("usageMetadata") or {}
                    prompt_tokens = usage.get("promptTokenCount")
                    completion_tokens = usage.get("candidatesTokenCount")
                    log_api_call(
                        current_file,
                        model_name,
                        prompt_tokens,
                        completion_tokens,
                    )
            except Exception as e:
                log.debug(f"Failed to log non-streaming API usage: {e}")
            if trace_id:
                log_call_event(
                    trace_id,
                    "non_stream_success",
                    {
                        "model": model_name,
                        "status_code": 200,
                    },
                )
            return Response(
                content=json.dumps(standard_gemini_response),
                status_code=200,
                media_type="application/json; charset=utf-8"
            )
        except Exception as e:
            log.error(f"Failed to parse Google API response: {str(e)}")
            if trace_id:
                log_call_event(
                    trace_id,
                    "non_stream_parse_error",
                    {
                        "model": model_name,
                        "status_code": resp.status_code,
                        "error": str(e),
                    },
                )
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                media_type=resp.headers.get("Content-Type")
            )
    else:
        # 获取响应内容用于详细错误显示
        response_content = ""
        try:
            if hasattr(resp, 'content'):
                content = resp.content
                if isinstance(content, bytes):
                    response_content = content.decode('utf-8', errors='ignore')
            else:
                content_bytes = await resp.aread()
                if isinstance(content_bytes, bytes):
                    response_content = content_bytes.decode('utf-8', errors='ignore')
        except Exception as e:
            log.debug(f"[NON-STREAMING] Failed to read response content for error analysis: {e}")
            response_content = ""
        
        # 显示详细错误信息
        if resp.status_code == 429:
            if response_content:
                log.error(f"Google API returned status 429 (NON-STREAMING). Response details: {response_content[:500]}")
            else:
                log.error(f"Google API returned status 429 (NON-STREAMING)")
        else:
            if response_content:
                log.error(f"Google API returned status {resp.status_code} (NON-STREAMING). Response details: {response_content[:500]}")
            else:
                log.error(f"Google API returned status {resp.status_code} (NON-STREAMING)")
        
        # 记录API调用错误
        if credential_manager and current_file:
            await credential_manager.record_api_call_result(current_file, False, resp.status_code)
        
        await _handle_api_error(credential_manager, resp.status_code, response_content)
        if trace_id:
            log_call_event(
                trace_id,
                "non_stream_error_status",
                {
                    "model": model_name,
                    "status_code": resp.status_code,
                },
            )
        return _create_error_response(f"API error: {resp.status_code}", resp.status_code)

def build_gemini_payload_from_native(native_request: dict, model_from_path: str) -> dict:
    """
    Build a Gemini API payload from a native Gemini request with full pass-through support.
    """
    # 创建请求副本以避免修改原始数据
    request_data = native_request.copy()
    
    # 应用默认安全设置（如果未指定）
    if "safetySettings" not in request_data:
        request_data["safetySettings"] = DEFAULT_SAFETY_SETTINGS
    
    # 确保generationConfig存在
    if "generationConfig" not in request_data:
        request_data["generationConfig"] = {}
    
    generation_config = request_data["generationConfig"]
    
    # 配置thinking（如果未指定thinkingConfig）
    if "thinkingConfig" not in generation_config:
        generation_config["thinkingConfig"] = {}
    
    thinking_config = generation_config["thinkingConfig"]
    
    # 只有在未明确设置时才应用默认thinking配置
    if "includeThoughts" not in thinking_config:
        thinking_config["includeThoughts"] = should_include_thoughts(model_from_path)
    if "thinkingBudget" not in thinking_config:
        thinking_config["thinkingBudget"] = get_thinking_budget(model_from_path)
    
    # 为搜索模型添加Google Search工具（如果未指定且没有functionDeclarations）
    if is_search_model(model_from_path):
        if "tools" not in request_data:
            request_data["tools"] = []
        # 检查是否已有functionDeclarations或googleSearch工具
        has_function_declarations = any(tool.get("functionDeclarations") for tool in request_data["tools"])
        has_google_search = any(tool.get("googleSearch") for tool in request_data["tools"])
        
        # 只有在没有任何工具时才添加googleSearch，或者只有googleSearch工具时可以添加更多googleSearch
        if not has_function_declarations and not has_google_search:
            request_data["tools"].append({"googleSearch": {}})
    
    # 透传所有其他Gemini原生字段:
    # - contents (必需)
    # - systemInstruction (可选)
    # - generationConfig (已处理)
    # - safetySettings (已处理)  
    # - tools (已处理)
    # - toolConfig (透传)
    # - cachedContent (透传)
    # - 以及任何其他未知字段都会被透传
    
    return {
        "model": get_base_model_name(model_from_path),
        "request": request_data
    }
