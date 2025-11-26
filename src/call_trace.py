import json
import os
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional


_trace_lock = threading.Lock()
_trace_writing_disabled = False
_trace_disable_reason: Optional[str] = None


def _get_trace_file_path() -> str:
    env_path = os.getenv("CALL_TRACE_LOG_FILE") or os.getenv("TRACE_LOG_FILE")
    return env_path or "call_trace.log"


def _write_trace_line(line: str) -> None:
    global _trace_writing_disabled, _trace_disable_reason

    if _trace_writing_disabled:
        return

    try:
        trace_file = _get_trace_file_path()
        with _trace_lock:
            with open(trace_file, "a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
    except (PermissionError, OSError, IOError) as e:
        _trace_writing_disabled = True
        _trace_disable_reason = str(e)
    except Exception:
        # 追踪日志失败不影响主流程
        pass


def log_call_event(call_id: str, phase: str, data: Optional[Dict[str, Any]] = None) -> None:
    """记录单次调用的关键阶段事件到独立日志文件"""
    payload: Dict[str, Any] = {
        "ts": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
        "t": time.time(),
        "call_id": call_id,
        "phase": phase,
    }
    if data:
        payload.update(data)

    try:
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        safe_payload = {
            "ts": payload.get("ts"),
            "t": payload.get("t"),
            "call_id": payload.get("call_id"),
            "phase": payload.get("phase"),
        }
        line = json.dumps(safe_payload, ensure_ascii=False, separators=(",", ":"))

    _write_trace_line(line)

