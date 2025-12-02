"""Simple in-memory progress tracker for batch operations.

This module keeps lightweight progress information for long-running batch
tasks so that the frontend can poll and render progress bars. It is purposely
minimal and only stores the latest run for each tracked operation.
"""

from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from typing import Dict, Optional


class ProgressOperation:
    REFRESH_EMAILS = "refresh_all_emails"
    HEALTH_CHECK = "test_all_credentials"


@dataclass
class ProgressState:
    status: str = "idle"  # idle | running | completed | error
    total: int = 0
    processed: int = 0
    message: str = ""
    error: Optional[str] = None


class ProgressTracker:
    def __init__(self) -> None:
        self._state: Dict[str, ProgressState] = {}
        self._lock = asyncio.Lock()

    def _default_state(self) -> ProgressState:
        return ProgressState()

    async def start(self, operation: str, total: int = 0, message: str = "") -> None:
        async with self._lock:
            self._state[operation] = ProgressState(
                status="running",
                total=max(int(total), 0),
                processed=0,
                message=message,
                error=None,
            )

    async def advance(self, operation: str, step: int = 1, message: Optional[str] = None) -> None:
        async with self._lock:
            state = self._state.get(operation, self._default_state())
            state.status = state.status or "running"
            state.processed = max(0, state.processed + max(step, 0))
            if state.total > 0:
                state.processed = min(state.processed, state.total)
            if message is not None:
                state.message = message
            self._state[operation] = state

    async def finish(self, operation: str, message: str = "") -> None:
        async with self._lock:
            state = self._state.get(operation, self._default_state())
            state.status = "completed"
            state.message = message or state.message
            self._state[operation] = state

    async def fail(self, operation: str, error: str) -> None:
        async with self._lock:
            state = self._state.get(operation, self._default_state())
            state.status = "error"
            state.error = error
            state.message = error
            self._state[operation] = state

    async def get(self, operation: str) -> ProgressState:
        async with self._lock:
            return copy.deepcopy(self._state.get(operation, self._default_state()))

    async def snapshot(self, operations: Optional[list[str]] = None) -> Dict[str, ProgressState]:
        async with self._lock:
            if operations is None:
                keys = list(self._state.keys())
            else:
                keys = operations
            return {key: copy.deepcopy(self._state.get(key, self._default_state())) for key in keys}


progress_tracker = ProgressTracker()
