# Rollback impact summary

This note maps the two rollback commits from December 1, 2025 to the areas they affected so you can quickly see what was added and then removed.

## 486dc283 ("滚回多数劣质更新", merge)
- Pulled in a large front-end refresh: consolidated styling into `front/static/css/control_panel.css`, updated `front/control_panel.html`, and added supporting scripts such as `front/static/js/auth.js`, `backup.js`, `credentials.js`, `json_import.js`, `login.js`, `oauth.js`, and a new promo image asset.
- Introduced backup and OAuth plumbing on the backend via `src/backup_manager.py` plus related route hooks inside `src/web_routes.py` and storage handling tweaks in `src/storage/file_storage_manager.py`.
- Expanded deployment scaffolding with additional compose variants like `docker-compose-cluster.yml` and `docker-compose-vpn.yml`.

## 704acc347 ("强制滚回多数劣质更新")
- Force-rolled back the above refresh: deleted `src/backup_manager.py`, removed backup/OAuth/credential-import scripts on the front end, and dropped the promo image.
- Reverted `src/web_routes.py` to remove backup endpoints and return to the earlier mobile/desktop control panel routing while keeping the lean auth/login flow.
- Restored the pre-refresh styling split (`apilog.css`, `base.css`, `config.css`, `manage.css`, `usage.css`) and pared back `front/control_panel.html` and related JS to the leaner layout.

## Follow-up
- Backend-only restore: the backup manager (`src/backup_manager.py`), usage/state handling, and scheduler wiring in `web.py` have been re-enabled while leaving the front-end routing/pages unchanged.
