"""
Simple API call logging module.

This module writes a compact per-call usage log so the frontend can
inspect basic call metrics without parsing the full trace log.

Each line (CSV) format:
    timestamp,credential,model,input_tokens,output_tokens

File path:
    - Use environment variable API_LOG_FILE if set
    - Otherwise default to "apilog.csv" in current working directory

The file is append-only and never truncated by this module.
It is designed to be safely volume-mapped in Docker.
"""

import os
import threading
from datetime import datetime
from typing import Optional

from log import log

_api_log_lock = threading.Lock()
_api_log_writing_disabled = False
_api_log_disable_reason: Optional[str] = None


def get_api_log_file_path() -> str:
    """
    Get the API log file path.

    Priority:
        1. API_LOG_FILE environment variable
        2. Fallback to ./apilog.csv (file name fixed for easy Docker mapping)
    """
    env_path = os.getenv("API_LOG_FILE")
    if env_path:
        return env_path
    # Default file name is "apilog" with a .csv suffix for easier analysis
    return "apilog.csv"


def _ensure_header_if_needed(file_path: str, file_obj) -> None:
    """Write CSV header if the file is new or empty."""
    try:
        # Only check size when we already hold the file lock
        need_header = os.path.getsize(file_path) == 0
    except OSError:
        # If stat fails, best-effort: assume header may be missing
        need_header = True

    if need_header:
        file_obj.write("timestamp,credential,model,input_tokens,output_tokens\n")


def log_api_call(
    credential: str,
    model: str,
    input_tokens: Optional[int],
    output_tokens: Optional[int],
) -> None:
    """
    Append a single API usage record.

    Args:
        credential: Credential identifier (usually the credential file name)
        model: Base model name actually used for the call
        input_tokens: Prompt / input token count (from usageMetadata)
        output_tokens: Completion / output token count (from usageMetadata)
    """
    global _api_log_writing_disabled, _api_log_disable_reason

    if _api_log_writing_disabled:
        return

    try:
        file_path = get_api_log_file_path()
        # Normalize values to simple strings for CSV
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cred_str = os.path.basename(credential) if credential else ""
        model_str = model or ""
        in_tokens = "" if input_tokens is None else str(int(input_tokens))
        out_tokens = "" if output_tokens is None else str(int(output_tokens))

        line = f"{timestamp},{cred_str},{model_str},{in_tokens},{out_tokens}"

        with _api_log_lock:
            # Append-only; keep file for long-term aggregation / Docker mapping
            with open(file_path, "a", encoding="utf-8", newline="") as f:
                _ensure_header_if_needed(file_path, f)
                f.write(line + "\n")
                f.flush()

    except (PermissionError, OSError, IOError) as e:
        # Disable further file logging if the filesystem is read-only or blocked
        _api_log_writing_disabled = True
        _api_log_disable_reason = str(e)
        log.warning(
            f"API call logging disabled due to file write error: {_api_log_disable_reason}"
        )
    except Exception as e:
        # Best-effort logging; do not break main flow on unexpected errors
        log.debug(f"Failed to write API call log: {e}")


__all__ = ["log_api_call", "get_api_log_file_path"]

