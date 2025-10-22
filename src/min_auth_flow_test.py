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