// 备份功能模块
class BackupManager {
    constructor() {
        // 后端 Web 路由在 web_routes.py 中加载，前面无需 /api 前缀
        this.apiBase = '';
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadBackupConfig();
    }

    bindEvents() {
        const uploadBtn = document.getElementById('uploadBackupBtn');
        const downloadBtn = document.getElementById('downloadBackupBtn');

        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => {
                this.triggerBackup('upload');
            });
        }

        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                this.triggerBackup('download');
            });
        }
    }

    async triggerBackup(direction) {
        const statusElement = document.getElementById('backupStatus');
        const uploadBtn = document.getElementById('uploadBackupBtn');
        const downloadBtn = document.getElementById('downloadBackupBtn');

        if (!uploadBtn || !downloadBtn) return;

        // 禁用按钮，显示加载状态
        uploadBtn.disabled = true;
        downloadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';

        try {
            const response = await fetch(`${this.apiBase}/backup/sync`, {
                method: 'POST',
                headers: getPanelAuthHeaders(),
                body: JSON.stringify({ direction })
            });

            const result = await response.json();

            if (result.success) {
                this.showBackupStatus(result.message, 'success');
                // 更新配置显示
                this.displayBackupConfig(result.backup_config);
            } else {
                this.showBackupStatus(result.message || '备份操作失败', 'error');
            }
        } catch (error) {
            console.error('备份操作出错:', error);
            this.showBackupStatus('网络错误或服务器异常', 'error');
        } finally {
            // 恢复按钮状态
            uploadBtn.disabled = false;
            downloadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> 立即上传备份';
            downloadBtn.innerHTML = '<i class="fas fa-download"></i> 立即恢复备份';
        }
    }

    async loadBackupConfig() {
        try {
            const response = await fetch(`${this.apiBase}/config/get`, {
                method: 'GET',
                headers: getPanelAuthHeaders({})
            });

            if (response.ok) {
                const result = await response.json();
                const backupConfig = result.config?.backup || {};
                this.displayBackupConfig(backupConfig);
            } else {
                document.getElementById('backupConfigInfo').innerHTML =
                    '<p style="color: #ef4444;">无法加载备份配置</p>';
            }
        } catch (error) {
            console.error('加载备份配置失败:', error);
            document.getElementById('backupConfigInfo').innerHTML =
                '<p style="color: #ef4444;">加载备份配置失败</p>';
        }
    }

    displayBackupConfig(config) {
        const configInfo = document.getElementById('backupConfigInfo');
        if (!configInfo) return;

        if (!config || !config.enabled) {
            configInfo.innerHTML = `
                <div style="margin-bottom: 8px;">
                    <strong>状态:</strong>
                    <span style="color: #f59e0b;">未启用</span>
                </div>
                <p style="color: #6b7280; font-size: 14px;">请在配置管理中启用备份功能</p>
            `;
            return;
        }

        const modeText = config.mode === 'upload' ? '上传模式' : '下载模式';
        const modeColor = config.mode === 'upload' ? '#3b82f6' : '#6b7280';

        configInfo.innerHTML = `
            <div style="margin-bottom: 8px;">
                <strong>状态:</strong>
                <span style="color: #10b981;">已启用</span>
            </div>
            <div style="margin-bottom: 8px;">
                <strong>GitHub仓库:</strong>
                <span>${this.escapeHtml(config.github_repo || '未配置')}</span>
            </div>
            <div style="margin-bottom: 8px;">
                <strong>同步模式:</strong>
                <span style="color: ${modeColor};">${modeText}</span>
            </div>
            <div style="margin-bottom: 8px;">
                <strong>同步间隔:</strong>
                <span>${config.interval_seconds || 600} 秒</span>
            </div>
        `;
    }

    showBackupStatus(message, type) {
        const statusElement = document.getElementById('backupStatus');
        if (!statusElement) return;

        statusElement.textContent = message;
        statusElement.className = `status-message status-${type}`;
        statusElement.style.display = 'block';

        if (type === 'success') {
            setTimeout(() => {
                statusElement.style.display = 'none';
            }, 3000);
        } else if (type === 'error') {
            if (!statusElement.querySelector('.close-btn')) {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'close-btn';
                closeBtn.innerHTML = '<i class="fas fa-times"></i>';
                closeBtn.onclick = () => {
                    statusElement.style.display = 'none';
                };
                closeBtn.style.cssText = 'background: none; border: none; margin-left: 10px; cursor: pointer; color: inherit;';
                statusElement.appendChild(closeBtn);
            }
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 页面加载完成后初始化备份管理器
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('backup')) {
        new BackupManager();
    }
});

// 供外部使用
window.BackupManager = BackupManager;