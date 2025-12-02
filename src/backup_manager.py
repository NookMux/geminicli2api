"""
GitHub 备份管理器
================

负责根据配置定时将本地凭证文件 `creds.toml` 与远程 GitHub 仓库同步。

设计约束：
- 只备份凭证文件 `creds.toml`，不同步其它文件（例如 config.toml）。
- GitHub Token 可选；如果提供，将用于 HTTPS 鉴权。
- 仓库地址必选，必须是 HTTPS 地址，例如：
  https://github.com/username/creds-backup.git
- 同步模式支持：
  - upload: 定时上传本地 creds.toml 到远程仓库
  - download: 定时从远程仓库拉取 creds.toml 覆盖本地

配置结构（保存到 config.toml 的 backup 字段）示例：

    [backup]
    enabled = true
    github_repo = "https://github.com/xxx/creds-backup.git"
    github_token = "ghp_xxx"         # 可选
    mode = "upload"                  # 或 "download"
    interval_seconds = 600           # 同步间隔，秒
    auto_commit_message = "自动备份凭证文件"

说明：
- 这里不强制配置字段名，只要外部确保与本模块使用的 key 一致即可。
"""

import asyncio
import os
import shutil
from dataclasses import dataclass
from typing import Optional, Literal, Dict, Any
from urllib.parse import urlparse, urlunparse

from log import log
from config import get_config_value, get_credentials_dir


BackupMode = Literal["upload", "download"]


@dataclass
class BackupConfig:
    enabled: bool = False
    github_repo: str = ""
    github_token: Optional[str] = None
    mode: BackupMode = "upload"
    interval_seconds: int = 600
    auto_commit_message: str = "自动备份凭证文件"

    @classmethod
    def from_raw(cls, raw: Dict[str, Any]) -> "BackupConfig":
        """从存储的原始配置字典构造 BackupConfig，带最小化容错。"""
        if not isinstance(raw, dict):
            raw = {}

        enabled = bool(raw.get("enabled", False))
        github_repo = str(raw.get("github_repo", "")).strip()
        github_token = raw.get("github_token") or None

        mode_raw = str(raw.get("mode", "upload")).lower().strip()
        mode: BackupMode = "upload" if mode_raw not in ("upload", "download") else mode_raw  # type: ignore[assignment]

        try:
            interval = int(raw.get("interval_seconds") or 600)
        except (ValueError, TypeError):
            interval = 600
        if interval < 60:
            # 防止过于频繁地打扰 GitHub / 写盘
            interval = 60

        auto_commit_message = str(
            raw.get("auto_commit_message", "自动备份凭证文件")
        ).strip() or "自动备份凭证文件"

        return cls(
            enabled=enabled,
            github_repo=github_repo,
            github_token=github_token,
            mode=mode,
            interval_seconds=interval,
            auto_commit_message=auto_commit_message,
        )


_scheduler_task: Optional[asyncio.Task] = None
_stop_event: asyncio.Event = asyncio.Event()


async def load_backup_config() -> BackupConfig:
    """
    从统一配置系统加载备份配置。

    优先级：环境变量 BACKUP（JSON/TOML 字符串，当前不推荐） > config.toml 中的 backup 字段 > 默认值。
    """
    try:
        # 允许通过环境变量 BACKUP 覆盖存储配置，格式为 JSON/TOML 字符串
        raw_value = await get_config_value("backup", default={}, env_var="BACKUP")
    except Exception as e:
        log.error(f"加载备份配置失败，使用默认配置: {e}")
        raw_value = {}

    # 如果通过环境变量传的是字符串，尝试解析 JSON / TOML，但失败就直接忽略
    if isinstance(raw_value, str):
        import json

        parsed: Dict[str, Any] = {}
        text = raw_value.strip()
        if text:
            try:
                parsed = json.loads(text)
            except Exception:
                try:
                    import toml  # type: ignore

                    parsed = toml.loads(text)
                except Exception:
                    log.warning("BACKUP 环境变量格式无法解析，将忽略该值")
        raw_value = parsed

    cfg = BackupConfig.from_raw(raw_value or {})
    return cfg


def _build_auth_repo_url(repo: str, token: Optional[str]) -> str:
    """
    根据是否提供 token 生成用于 git 操作的仓库地址。

    - 若 token 为空，则直接返回原始 repo。
    - 若为 https://github.com/owner/repo.git，则变为
      https://TOKEN@github.com/owner/repo.git

    注意：不在日志中打印带 token 的地址。
    """
    if not token:
        return repo

    try:
        parsed = urlparse(repo)
        if not parsed.scheme.startswith("http"):
            # 非 HTTP(S) 仓库地址（例如 SSH），直接返回原始地址
            return repo

        netloc = parsed.netloc
        if "@" in netloc:
            # 已经带有用户信息，避免重复注入
            return repo

        netloc = f"{token}@{netloc}"
        parsed = parsed._replace(netloc=netloc)
        return urlunparse(parsed)
    except Exception:
        # 容错：解析失败时仍返回原始地址
        return repo


async def _run_git_command(args: list[str], cwd: str) -> tuple[int, str]:
    """
    异步执行 git 命令，返回 (exit_code, combined_output)。

    为了避免阻塞事件循环，这里使用 asyncio.create_subprocess_exec。
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            *args,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await proc.communicate()
        output = stdout.decode("utf-8", errors="ignore")
        return proc.returncode, output
    except FileNotFoundError:
        return 127, "git 命令未找到，请在系统中安装 Git 并配置到 PATH"
    except Exception as e:
        return 1, f"执行 git 命令失败: {e}"


async def _ensure_repo_cloned(cfg: BackupConfig, repo_dir: str) -> bool:
    """
    确保本地备份仓库存在，若不存在则执行 git clone。
    """
    if os.path.isdir(os.path.join(repo_dir, ".git")):
        return True

    os.makedirs(os.path.dirname(repo_dir), exist_ok=True)

    auth_repo = _build_auth_repo_url(cfg.github_repo, cfg.github_token)
    log.info("首次初始化备份仓库（clone）")
    code, output = await _run_git_command(["clone", auth_repo, repo_dir], cwd=os.path.dirname(repo_dir))
    if code != 0:
        # 不打印 token，只打印原始仓库地址
        log.error(f"克隆备份仓库失败（repo={cfg.github_repo}）：{output.strip()}")
        return False
    return True


async def _git_pull(cfg: BackupConfig, repo_dir: str) -> bool:
    """执行 git pull，同步远程更新。"""
    # 为了兼容 token 变更，这里每次 pull 前更新 origin URL（若提供 token）
    if cfg.github_token:
        auth_repo = _build_auth_repo_url(cfg.github_repo, cfg.github_token)
        await _run_git_command(["remote", "set-url", "origin", auth_repo], cwd=repo_dir)

    code, output = await _run_git_command(["pull", "--rebase"], cwd=repo_dir)
    if code != 0:
        log.error(f"备份仓库 git pull 失败：{output.strip()}")
        return False
    return True


async def _git_push(cfg: BackupConfig, repo_dir: str) -> bool:
    """执行 git push，将本地提交推送到远程。"""
    if cfg.github_token:
        auth_repo = _build_auth_repo_url(cfg.github_repo, cfg.github_token)
        await _run_git_command(["remote", "set-url", "origin", auth_repo], cwd=repo_dir)

    code, output = await _run_git_command(["push"], cwd=repo_dir)
    if code != 0:
        log.error(f"备份仓库 git push 失败：{output.strip()}")
        return False
    return True


async def _sync_upload(cfg: BackupConfig) -> str:
    """
    执行一次“上传模式”同步：
    - 将本地 creds.toml 复制到备份仓库
    - git add & commit & push
    """
    creds_dir = await get_credentials_dir()
    local_creds = os.path.join(creds_dir, "creds.toml")
    if not os.path.exists(local_creds):
        msg = f"本地凭证文件不存在，跳过上传：{local_creds}"
        log.warning(msg)
        return msg

    repo_dir = os.path.join(creds_dir, ".creds_backup_repo")
    if not await _ensure_repo_cloned(cfg, repo_dir):
        return "初始化备份仓库失败"

    # 先 pull 一次，避免制造不必要的冲突
    await _git_pull(cfg, repo_dir)

    repo_creds = os.path.join(repo_dir, "creds.toml")
    try:
        shutil.copy2(local_creds, repo_creds)
    except Exception as e:
        msg = f"复制凭证文件到备份仓库失败: {e}"
        log.error(msg)
        return msg

    code, output = await _run_git_command(["status", "--porcelain"], cwd=repo_dir)
    if code != 0:
        log.error(f"备份仓库 git status 失败：{output.strip()}")
        return "git status 失败"

    if not output.strip():
        msg = "没有检测到凭证文件变更，跳过提交"
        log.info(msg)
        return msg

    code, output = await _run_git_command(["add", "creds.toml"], cwd=repo_dir)
    if code != 0:
        log.error(f"备份仓库 git add 失败：{output.strip()}")
        return "git add 失败"

    commit_msg = cfg.auto_commit_message or "自动备份凭证文件"
    code, output = await _run_git_command(["commit", "-m", commit_msg], cwd=repo_dir)
    if code != 0:
        # 若是 “nothing to commit” 之类的情况，也视为成功
        if "nothing to commit" not in output.lower():
            log.error(f"备份仓库 git commit 失败：{output.strip()}")
            return "git commit 失败"

    if not await _git_push(cfg, repo_dir):
        return "git push 失败"

    msg = "备份凭证文件上传成功"
    log.info(msg)
    return msg


async def _sync_download(cfg: BackupConfig) -> str:
    """
    执行一次“下载模式”同步：
    - 从远程仓库拉取最新代码
    - 将仓库中的 creds.toml 覆盖到本地

    注意：不会立即强制刷新内存缓存，最多存在一个 cache_ttl 的延迟。
    """
    creds_dir = await get_credentials_dir()
    local_creds = os.path.join(creds_dir, "creds.toml")
    repo_dir = os.path.join(creds_dir, ".creds_backup_repo")

    if not await _ensure_repo_cloned(cfg, repo_dir):
        return "初始化备份仓库失败"

    if not await _git_pull(cfg, repo_dir):
        return "从远程拉取备份仓库失败"

    repo_creds = os.path.join(repo_dir, "creds.toml")
    if not os.path.exists(repo_creds):
        msg = "远程备份仓库中不存在 creds.toml，无法执行下载同步"
        log.warning(msg)
        return msg

    try:
        os.makedirs(creds_dir, exist_ok=True)
        shutil.copy2(repo_creds, local_creds)
    except Exception as e:
        msg = f"从备份仓库覆盖本地凭证文件失败: {e}"
        log.error(msg)
        return msg

    msg = "从 GitHub 备份仓库恢复凭证文件成功"
    log.info(msg)
    return msg


async def run_backup_once(direction: Optional[BackupMode] = None) -> str:
    """
    立即执行一次备份同步（供定时任务和手动触发共用）。

    Args:
        direction: 'upload' / 'download'；若为 None，则根据当前配置的 mode 决定。

    Returns:
        文本状态说明，便于前端展示。
    """
    cfg = await load_backup_config()

    if not cfg.enabled:
        msg = "备份功能未启用，跳过执行"
        log.info(msg)
        return msg

    if not cfg.github_repo:
        msg = "未配置 GitHub 仓库地址，无法执行备份"
        log.warning(msg)
        return msg

    mode: BackupMode = direction or cfg.mode
    if mode == "upload":
        return await _sync_upload(cfg)
    elif mode == "download":
        return await _sync_download(cfg)
    else:
        msg = f"未知备份模式: {mode}"
        log.error(msg)
        return msg


async def _backup_scheduler_loop():
    """
    定时备份主循环。

    - 每次循环会重新读取配置，使得在控制面板修改备份设置后无需重启服务即可生效。
    - 若备份未启用，则只做轻量级 sleep。
    """
    log.info("备份调度器启动")
    try:
        while not _stop_event.is_set():
            try:
                cfg = await load_backup_config()
            except Exception as e:
                log.error(f"读取备份配置失败，将在 5 分钟后重试: {e}")
                try:
                    await asyncio.wait_for(_stop_event.wait(), timeout=300)
                except asyncio.TimeoutError:
                    continue
                else:
                    break

            interval = max(int(cfg.interval_seconds or 600), 60)

            if not cfg.enabled or not cfg.github_repo:
                # 功能未启用或配置不完整，只做轻量睡眠
                try:
                    await asyncio.wait_for(_stop_event.wait(), timeout=interval)
                except asyncio.TimeoutError:
                    continue
                else:
                    break

            try:
                await run_backup_once()
            except Exception as e:
                log.error(f"定时备份执行失败: {e}")

            # 等待下一轮
            try:
                await asyncio.wait_for(_stop_event.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue
            else:
                break
    finally:
        log.info("备份调度器停止")


async def start_backup_scheduler() -> None:
    """启动备份调度器（在应用生命周期 startup 阶段调用）。"""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return

    _stop_event.clear()
    _scheduler_task = asyncio.create_task(_backup_scheduler_loop(), name="backup_scheduler")


async def stop_backup_scheduler() -> None:
    """停止备份调度器（在应用生命周期 shutdown 阶段调用）。"""
    global _scheduler_task
    _stop_event.set()

    task = _scheduler_task
    _scheduler_task = None

    if task and not task.done():
        try:
            await asyncio.wait_for(task, timeout=10.0)
        except asyncio.TimeoutError:
            task.cancel()
            log.warning("备份调度器在超时后被强制取消")


__all__ = [
    "BackupConfig",
    "load_backup_config",
    "run_backup_once",
    "start_backup_scheduler",
    "stop_backup_scheduler",
]
