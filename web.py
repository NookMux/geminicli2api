"""
Main Web Integration - Integrates all routers and modules
闆嗗悎router骞跺紑鍚富鏈嶅姟
"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Import all routers
# from src.openai_router import router as openai_router
from src.gemini_router import router as gemini_router
from src.web_routes import router as web_router

# Import managers and utilities
from src.credential_manager import CredentialManager
from src.task_manager import shutdown_all_tasks
from src.backup_manager import start_backup_scheduler, stop_backup_scheduler
from config import get_server_host, get_server_port
from log import log

# 鍏ㄥ眬鍑瘉绠＄悊鍣?
global_credential_manager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """搴旂敤鐢熷懡鍛ㄦ湡绠＄悊"""
    global global_credential_manager

    # 鍒濆鍖栧叏灞€鍑瘉绠＄悊鍣?
    try:
        global_credential_manager = CredentialManager()
        await global_credential_manager.initialize()
    except Exception as e:
        log.error(f"鍑瘉绠＄悊鍣ㄥ垵濮嬪寲澶辫触: {e}")
        global_credential_manager = None

    # 鑷姩浠庣幆澧冨彉閲忓姞杞藉嚟璇侊紙寮傛鎵ц锛?
    try:
        from src.auth import auto_load_env_credentials_on_startup
        import asyncio as _asyncio

        # 鍦ㄥ悗鍙颁换鍔′腑鎵ц寮傛鍔犺浇
        async def load_env_creds():
            try:
                await auto_load_env_credentials_on_startup()
            except Exception as e:
                log.error(f"鑷姩鍔犺浇鐜鍙橀噺鍑瘉澶辫触: {e}")

        # 鍒涘缓鍚庡彴浠诲姟
        _asyncio.create_task(load_env_creds())
    except Exception as e:
        log.error(f"鍒涘缓鑷姩鍔犺浇鐜鍙橀噺鍑瘉浠诲姟澶辫触: {e}")

    # 鍚姩 GitHub 鍑瘉鏂囦欢鐨勫弽搴旂浉鍚岀郴鐢?
    try:
        await start_backup_scheduler()
    except Exception as e:
        log.error(f"鍚姩鍑瘉鏂囦欢鍙嶉鍚屾鍣ㄥけ璐? {e}")

    # OAuth鍥炶皟鏈嶅姟鍣ㄥ皢鍦ㄩ渶瑕佹椂鎸夐渶鍚姩

    # 鍦ㄩ€氱煡 FastAPI 鍚姩瀹屾瘯
    yield

    # 鍏抽棴鍙嶉瀹氭椂浠诲姟
    try:
        await stop_backup_scheduler()
    except Exception as e:
        log.error(f"鍏抽棴鍙嶉瀹氭椂鍚屾鍣ㄥけ璐? {e}")

    # 棣栧厛鍏抽棴鎵€鏈夊紓姝ヤ换鍔?
    try:
        await shutdown_all_tasks(timeout=10.0)
    except Exception as e:
        log.error(f"鍏抽棴寮傛浠诲姟鏃跺嚭閿? {e}")

    # 鐒跺悗鍏抽棴鍑瘉绠＄悊鍣?
    if global_credential_manager:
        try:
            await global_credential_manager.close()
        except Exception as e:
            log.error(f"鍏抽棴鍑瘉绠＄悊鍣ㄦ椂鍑洪敊: {e}")


# 鍒涘缓FastAPI搴旂敤
app = FastAPI(
    title="GCLI2API",
    description="Gemini API proxy with OpenAI compatibility",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS涓棿浠?
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 鎸傝浇闈欐€佹枃浠?
app.mount("/static", StaticFiles(directory="front/static"), name="static")

# 鎸傝浇璺敱鍣?
# OpenAI鍏煎璺敱 - 澶勭悊OpenAI鏍煎紡璇锋眰
# app.include_router(
#     openai_router,
#     prefix="",
#     tags=["OpenAI Compatible API"]
# )

# Gemini鍘熺敓璺敱 - 澶勭悊Gemini鏍煎紡璇锋眰
app.include_router(
    gemini_router,
    prefix="",
    tags=["Gemini Native API"],
)

# Web璺敱 - 鍖呭惈璁よ瘉銆佸嚟璇佺鐞嗗拰鎺у埗闈㈡澘鍔熻兘
app.include_router(
    web_router,
    prefix="",
    tags=["Web Interface"],
)


# 淇濇椿鎺ュ彛锛堜粎鍝嶅簲 HEAD锛?
@app.head("/keepalive")
async def keepalive() -> Response:
    return Response(status_code=200)


def get_credential_manager():
    """鑾峰彇鍏ㄥ眬鍑瘉绠＄悊鍣ㄥ疄渚?"""
    return global_credential_manager


# 瀵煎嚭缁欏叾浠栨ā鍧椾娇鐢?
__all__ = ["app", "get_credential_manager"]


async def main():
    """寮傛涓诲惎鍔ㄥ嚱鏁?"""
    from hypercorn.asyncio import serve
    from hypercorn.config import Config

    # 鏃ュ織绯荤粺鐜板湪鐩存帴浣跨敤鐜鍙橀噺锛屾棤闇€鍒濆鍖?

    # 浠庣幆澧冨彉閲忔垨閰嶇疆鑾峰彇绔彛鍜屼富鏈?
    port = await get_server_port()
    host = await get_server_host()

    log.info(f"鎺у埗闈㈡澘: http://127.0.0.1:{port}")

    # 閰嶇疆hypercorn
    config = Config()
    config.bind = [f"{host}:{port}"]
    config.accesslog = "-"
    config.errorlog = "-"
    config.loglevel = "INFO"
    config.use_colors = True

    # 璁剧疆璇锋眰浣撳ぇ灏忛檺鍒朵负100MB
    config.max_request_body_size = 100 * 1024 * 1024

    # 璁剧疆杩炴帴瓒呮椂
    config.keep_alive_timeout = 300  # 5鍒嗛挓
    config.read_timeout = 300  # 5鍒嗛挓璇诲彇瓒呮椂
    config.write_timeout = 300  # 5鍒嗛挓鍐欏叆瓒呮椂

    # 澧炲姞鍚姩瓒呮椂鏃堕棿浠ユ敮鎸佸ぇ閲忓嚟璇佺殑鍦烘櫙
    config.startup_timeout = 120  # 2鍒嗛挓鍚姩瓒呮椂

    await serve(app, config)


if __name__ == "__main__":
    asyncio.run(main())

