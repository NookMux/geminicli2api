"""
Usage statistics module for tracking API calls per credential file.
Uses the simpler logic: compare current time with next_reset_time.
"""
import os
import time
from datetime import datetime, timezone, timedelta
from threading import Lock
from typing import Dict, Any, Optional

import config
from config import get_credentials_dir
from log import log
from .state_manager import get_state_manager
from .storage_adapter import get_storage_adapter


def _get_next_utc_7am() -> datetime:
    """
    Calculate the next UTC 07:00 time for quota reset.
    """
    now = datetime.now(timezone.utc)
    today_7am = now.replace(hour=7, minute=0, second=0, microsecond=0)
    
    if now < today_7am:
        return today_7am
    else:
        return today_7am + timedelta(days=1)


class UsageStats:
    """
    Simplified usage statistics manager with clear reset logic.
    """
    
    def __init__(self):
        self._lock = Lock()
        # 状态文件路径将在初始化时异步设置
        self._state_file = None
        self._state_manager = None
        self._storage_adapter = None
        self._stats_cache: Dict[str, Dict[str, Any]] = {}
        self._initialized = False
        self._cache_dirty = False  # 缓存脏标记，减少不必要的写入
        self._last_save_time = 0
        self._save_interval = 60  # 最多每分钟保存一次，减少I/O
        self._max_cache_size = 100  # 严格限制缓存大小
        # 动态默认配额值，初始化时设置
        self._default_daily_limit_pro = config.DEFAULT_DAILY_LIMIT_PRO_MODELS
        self._default_daily_limit_total = config.DEFAULT_DAILY_LIMIT_TOTAL
    
    async def initialize(self):
        """Initialize the usage stats module."""
        if self._initialized:
            return

        # 初始化存储适配器
        self._storage_adapter = await get_storage_adapter()

        # 文件模式下创建本地状态文件
        credentials_dir = await get_credentials_dir()
        self._state_file = os.path.join(credentials_dir, "creds_state.toml")
        self._state_manager = get_state_manager(self._state_file)

        # 设置动态默认配额值
        try:
            from config import get_daily_limit_pro_models, get_daily_limit_total
            self._default_daily_limit_pro = await get_daily_limit_pro_models()
            self._default_daily_limit_total = await get_daily_limit_total()
            log.debug(f"Loaded default quota limits: Pro={self._default_daily_limit_pro}, Total={self._default_daily_limit_total}")
        except Exception as e:
            log.error(f"Failed to load default quota limits from config: {e}, using fallback values")

        await self._load_stats()
        self._initialized = True
        # 当前实现仅使用文件存储后端
        log.debug("Usage statistics module initialized with File storage backend")
        
    
    def _normalize_filename(self, filename: str) -> str:
        """Normalize filename to relative path for consistent storage."""
        if not filename:
            return ""
            
        if os.path.sep not in filename and "/" not in filename:
            return filename
            
        return os.path.basename(filename)
    
    def _is_pro_model(self, model_name: str) -> bool:
        """
        Check if model is any Pro variant (including prefixes and suffixes).
        This covers gemini-2.5-pro, gemini-3-pro-preview, and future Pro models.
        """
        if not model_name:
            return False

        # 使用现有的 get_base_model_name 去掉后缀，然后检查是否包含 "pro"
        from config import get_base_model_name

        base = get_base_model_name(model_name)
        return "pro" in base.lower()
    
    async def _load_stats(self):
        """Load statistics from unified storage"""
        try:
            # 从统一存储获取所有使用统计，添加超时机制防止卡死
            import asyncio
            
            async def load_stats_with_timeout():
                all_usage_stats = await self._storage_adapter.get_all_usage_stats()
                
                log.debug(f"Processing {len(all_usage_stats)} usage statistics items...")
                
                # 直接处理统计数据
                stats_cache = {}
                processed_count = 0
                
                for filename, stats_data in all_usage_stats.items():
                    if isinstance(stats_data, dict):
                        normalized_filename = self._normalize_filename(filename)
                        
                        # 提取使用统计字段，只在存储中确实存在覆盖值时才加载
                        usage_data = {
                            "pro_model_calls": stats_data.get("pro_model_calls", 0),
                            "total_calls": stats_data.get("total_calls", 0),
                            "next_reset_time": stats_data.get("next_reset_time"),
                            # 只在存储中的值与默认值不同时才视为覆盖
                            "daily_limit_pro_models": stats_data.get("daily_limit_pro_models") if stats_data.get("daily_limit_pro_models") not in (None, self._default_daily_limit_pro) else None,
                            "daily_limit_total": stats_data.get("daily_limit_total") if stats_data.get("daily_limit_total") not in (None, self._default_daily_limit_total) else None
                        }

                        # 清理None值，确保缓存中只保存真正的覆盖值
                        usage_data = {k: v for k, v in usage_data.items() if v is not None}

                        # 只要存在统计数据或reset时间就保存（排除只有覆盖限额的情况）
                        if (usage_data.get("pro_model_calls", 0) > 0 or
                            usage_data.get("total_calls", 0) > 0 or
                            usage_data.get("next_reset_time")):
                            stats_cache[normalized_filename] = usage_data
                            processed_count += 1
                
                return stats_cache, processed_count
            
            # 设置15秒超时防止卡死
            try:
                self._stats_cache, processed_count = await asyncio.wait_for(
                    load_stats_with_timeout(), timeout=15.0
                )
                log.debug(f"Loaded usage statistics for {processed_count} credential files")
            except asyncio.TimeoutError:
                log.error("Loading usage statistics timed out after 30 seconds, using empty cache")
                self._stats_cache = {}
                return
            
        except Exception as e:
            log.error(f"Failed to load usage statistics: {e}")
            self._stats_cache = {}
    
    async def _save_stats(self):
        """Save statistics to unified storage."""
        current_time = time.time()

        # 使用脏标记和时间间隔控制，减少不必要的写入
        if not self._cache_dirty or (current_time - self._last_save_time < self._save_interval):
            return

        try:
            # 批量更新使用统计到存储适配器
            log.debug(f"Saving {len(self._stats_cache)} usage statistics items...")

            # 只对当前仍存在的凭证保存统计，避免复活已删除的条目
            try:
                existing_files_raw = await self._storage_adapter.list_credentials()
                existing_files = {self._normalize_filename(name) for name in existing_files_raw}
            except Exception as e:
                log.error(f"Failed to list credentials when saving usage stats: {e}")
                existing_files = None

            saved_count = 0
            to_delete_from_cache = []

            for filename, stats in self._stats_cache.items():
                normalized_filename = self._normalize_filename(filename)

                # 如果凭证已经不存在，就不再写统计，并从缓存中移除
                if existing_files is not None and normalized_filename not in existing_files:
                    log.debug(f"Skipping usage stats save for deleted credential: {normalized_filename}")
                    to_delete_from_cache.append(filename)
                    continue

                try:
                    # 构建统计数据，永远写入基础字段，只在存在覆盖时才写入限额字段
                    stats_data = {
                        "pro_model_calls": stats.get("pro_model_calls", 0),
                        "total_calls": stats.get("total_calls", 0),
                        "next_reset_time": stats.get("next_reset_time"),
                    }

                    # 只在缓存中存在覆盖值时才写入限额字段
                    if "daily_limit_pro_models" in stats and stats["daily_limit_pro_models"] is not None:
                        stats_data["daily_limit_pro_models"] = stats["daily_limit_pro_models"]

                    if "daily_limit_total" in stats and stats["daily_limit_total"] is not None:
                        stats_data["daily_limit_total"] = stats["daily_limit_total"]

                    success = await self._storage_adapter.update_usage_stats(normalized_filename, stats_data)
                    if success:
                        saved_count += 1
                except Exception as e:
                    log.error(f"Failed to save stats for {filename}: {e}")
                    continue

            # 清理掉缓存中指向已删除凭证的统计项
            for filename in to_delete_from_cache:
                self._stats_cache.pop(filename, None)

            self._cache_dirty = False  # 清除脏标记
            self._last_save_time = current_time
            log.debug(f"Successfully saved {saved_count}/{len(self._stats_cache)} usage statistics to unified storage")
        except Exception as e:
            log.error(f"Failed to save usage statistics: {e}")
    
    def _get_or_create_stats(self, filename: str) -> Dict[str, Any]:
        """Get or create statistics entry for a credential file."""
        normalized_filename = self._normalize_filename(filename)
        
        if normalized_filename not in self._stats_cache:
            # 严格控制缓存大小 - 超过限制时删除最旧的条目
            if len(self._stats_cache) >= self._max_cache_size:
                # 删除最旧的统计数据（基于next_reset_time或没有该字段的）
                oldest_key = min(self._stats_cache.keys(),
                               key=lambda k: self._stats_cache[k].get('next_reset_time', ''))
                del self._stats_cache[oldest_key]
                self._cache_dirty = True
                log.debug(f"Removed oldest usage stats cache entry: {oldest_key}")
            
            # 新建stats时只写必须字段，不写入默认限额以避免被视为"有覆盖"
            next_reset = _get_next_utc_7am()
            self._stats_cache[normalized_filename] = {
                "pro_model_calls": 0,
                "total_calls": 0,
                "next_reset_time": next_reset.isoformat(),
                # 注意：不在这里写入默认限额，避免被视为"有覆盖"
                # "daily_limit_pro_models": self._default_daily_limit_pro,
                # "daily_limit_total": self._default_daily_limit_total
            }
            self._cache_dirty = True  # 标记缓存已修改
        
        return self._stats_cache[normalized_filename]
    
    def _check_and_reset_daily_quota(self, stats: Dict[str, Any]) -> bool:
        """
        Simple reset logic: if current time >= next_reset_time, then reset.
        """
        try:
            next_reset_str = stats.get("next_reset_time")
            if not next_reset_str:
                # No next reset time recorded, set it up
                next_reset = _get_next_utc_7am()
                stats["next_reset_time"] = next_reset.isoformat()
                return False
            
            next_reset = datetime.fromisoformat(next_reset_str)
            now = datetime.now(timezone.utc)
            
            # Simple comparison: if current time >= next reset time, then reset
            if now >= next_reset:
                old_pro_calls = stats.get("pro_model_calls", 0)
                old_total_calls = stats.get("total_calls", 0)

                # Reset counters and set new next reset time
                new_next_reset = _get_next_utc_7am()
                stats.update({
                    "pro_model_calls": 0,
                    "total_calls": 0,
                    "next_reset_time": new_next_reset.isoformat()
                })

                self._cache_dirty = True  # 标记缓存已修改
                log.info(f"Daily quota reset performed. Previous stats - Pro Models: {old_pro_calls}, Total: {old_total_calls}")
                return True
            
            return False
        except Exception as e:
            log.error(f"Error in daily quota reset check: {e}")
            return False
    
    async def record_successful_call(self, filename: str, model_name: str):
        """Record a successful API call for statistics."""
        if not self._initialized:
            await self.initialize()
        
        with self._lock:
            try:
                normalized_filename = self._normalize_filename(filename)
                stats = self._get_or_create_stats(normalized_filename)
                
                # Check and perform daily reset if needed
                reset_performed = self._check_and_reset_daily_quota(stats)
                
                # Increment counters
                is_pro_model = self._is_pro_model(model_name)

                stats["total_calls"] += 1
                if is_pro_model:
                    stats["pro_model_calls"] += 1

                self._cache_dirty = True  # 标记缓存已修改

                log.debug(f"Usage recorded - File: {normalized_filename}, Model: {model_name}, "
                         f"Pro Models: {stats['pro_model_calls']}/{stats.get('daily_limit_pro_models') if 'daily_limit_pro_models' in stats else self._default_daily_limit_pro}, "
                         f"Total: {stats['total_calls']}/{stats.get('daily_limit_total') if 'daily_limit_total' in stats else self._default_daily_limit_total}")
                
                if reset_performed:
                    log.info(f"Daily quota was reset for {normalized_filename}")
                
            except Exception as e:
                log.error(f"Failed to record usage statistics: {e}")
        
        # Save stats asynchronously
        try:
            await self._save_stats()
        except Exception as e:
            log.error(f"Failed to save usage statistics after recording: {e}")
    
    async def get_usage_stats(self, filename: str = None) -> Dict[str, Any]:
        """Get usage statistics."""
        if not self._initialized:
            await self.initialize()
        
        with self._lock:
            if filename:
                normalized_filename = self._normalize_filename(filename)
                stats = self._get_or_create_stats(normalized_filename)
                # Check for daily reset before returning stats
                self._check_and_reset_daily_quota(stats)
                return {
                    "filename": normalized_filename,
                    "pro_model_calls": stats.get("pro_model_calls", 0),
                    "total_calls": stats.get("total_calls", 0),
                    "daily_limit_pro_models": stats["daily_limit_pro_models"] if "daily_limit_pro_models" in stats else self._default_daily_limit_pro,
                    "daily_limit_total": stats["daily_limit_total"] if "daily_limit_total" in stats else self._default_daily_limit_total,
                    "next_reset_time": stats.get("next_reset_time")
                }
            else:
                # Return all statistics
                all_stats = {}
                for filename, stats in self._stats_cache.items():
                    # Check for daily reset for each file
                    self._check_and_reset_daily_quota(stats)
                    all_stats[filename] = {
                        "pro_model_calls": stats.get("pro_model_calls", 0),
                        "total_calls": stats.get("total_calls", 0),
                        "daily_limit_pro_models": stats["daily_limit_pro_models"] if "daily_limit_pro_models" in stats else self._default_daily_limit_pro,
                        "daily_limit_total": stats["daily_limit_total"] if "daily_limit_total" in stats else self._default_daily_limit_total,
                        "next_reset_time": stats.get("next_reset_time")
                    }
                
                return all_stats
    
    async def get_aggregated_stats(self) -> Dict[str, Any]:
        """Get aggregated statistics across all credential files."""
        if not self._initialized:
            await self.initialize()
        
        all_stats = await self.get_usage_stats()

        total_pro_models = 0
        total_all_models = 0
        total_files = len(all_stats)

        for stats in all_stats.values():
            total_pro_models += stats["pro_model_calls"]
            total_all_models += stats["total_calls"]

        return {
            "total_files": total_files,
            "total_pro_model_calls": total_pro_models,
            "total_all_model_calls": total_all_models,
            "avg_pro_model_per_file": total_pro_models / max(total_files, 1),
            "avg_total_per_file": total_all_models / max(total_files, 1),
            "next_reset_time": _get_next_utc_7am().isoformat()
        }
    
    async def update_daily_limits(self, filename: str, pro_models_limit: int = None,
                                total_limit: int = None):
        """Update daily limits for a specific credential file."""
        if not self._initialized:
            await self.initialize()

        with self._lock:
            try:
                normalized_filename = self._normalize_filename(filename)
                stats = self._get_or_create_stats(normalized_filename)

                if pro_models_limit is not None:
                    stats["daily_limit_pro_models"] = pro_models_limit

                if total_limit is not None:
                    stats["daily_limit_total"] = total_limit

                log.info(f"Updated daily limits for {normalized_filename}: "
                        f"Pro Models = {stats.get('daily_limit_pro_models') if 'daily_limit_pro_models' in stats else self._default_daily_limit_pro}, "
                        f"Total = {stats.get('daily_limit_total') if 'daily_limit_total' in stats else self._default_daily_limit_total}")

            except Exception as e:
                log.error(f"Failed to update daily limits: {e}")
                raise
        
        await self._save_stats()
    
    async def reset_stats(self, filename: str = None):
        """Reset usage statistics."""
        if not self._initialized:
            await self.initialize()
        
        with self._lock:
            if filename:
                normalized_filename = self._normalize_filename(filename)
                if normalized_filename in self._stats_cache:
                    # Manual reset: reset counters and set new next reset time
                    next_reset = _get_next_utc_7am()
                    self._stats_cache[normalized_filename].update({
                        "pro_model_calls": 0,
                        "total_calls": 0,
                        "next_reset_time": next_reset.isoformat()
                    })
                    log.info(f"Reset usage statistics for {normalized_filename}")
            else:
                # Reset all statistics
                next_reset = _get_next_utc_7am()
                for filename, stats in self._stats_cache.items():
                    stats.update({
                        "pro_model_calls": 0,
                        "total_calls": 0,
                        "next_reset_time": next_reset.isoformat()
                    })
                log.info("Reset usage statistics for all credential files")
        
        await self._save_stats()

# Global instance
_usage_stats_instance: Optional[UsageStats] = None

async def get_usage_stats_instance() -> UsageStats:
    """Get the global usage statistics instance."""
    global _usage_stats_instance
    if _usage_stats_instance is None:
        _usage_stats_instance = UsageStats()
        await _usage_stats_instance.initialize()
    return _usage_stats_instance


async def record_successful_call(filename: str, model_name: str):
    """Convenience function to record a successful API call."""
    stats = await get_usage_stats_instance()
    await stats.record_successful_call(filename, model_name)


async def get_usage_stats(filename: str = None) -> Dict[str, Any]:
    """Convenience function to get usage statistics."""
    stats = await get_usage_stats_instance()
    return await stats.get_usage_stats(filename)


async def get_aggregated_stats() -> Dict[str, Any]:
    """Convenience function to get aggregated statistics."""
    stats = await get_usage_stats_instance()
    return await stats.get_aggregated_stats()
