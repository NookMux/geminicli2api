/**
 * 凭证管理页面 JavaScript
 * 处理已有凭证的显示、操作和管理功能
 */

class CredentialsManager {
    constructor() {
        this.credentials = [];
        this.selectedCredentials = new Set();
        this.currentPage = 1;
        this.pageSize = 10;
        this.filters = {
            status: '',
            errorCode: ''
        };

        this.init();
    }

    init() {
        this.bindEvents();
        this.loadCredentials();
    }

    bindEvents() {
        // 筛选器事件
        document.getElementById('statusFilter').addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.currentPage = 1;
            this.renderCredentials();
        });

        document.getElementById('errorCodeFilter').addEventListener('change', (e) => {
            this.filters.errorCode = e.target.value;
            this.currentPage = 1;
            this.renderCredentials();
        });

        document.getElementById('pageSize').addEventListener('change', (e) => {
            this.pageSize = parseInt(e.target.value);
            this.currentPage = 1;
            this.renderCredentials();
        });

        // 刷新按钮
        document.addEventListener('click', (e) => {
            if (e.target.closest('button[onclick="refreshCredentials()"]')) {
                this.loadCredentials();
            }
        });
    }

    async loadCredentials() {
        try {
            this.showLoading();

            // 调用真实的API接口
            const response = await fetch('/creds/status', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // 将API返回的数据转换为前端需要的格式
            this.credentials = this.transformApiData(data.creds);
            this.updateStatistics();
            this.renderCredentials();

        } catch (error) {
            console.error('加载凭证失败:', error);
            this.showError(`加载凭证失败: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    transformApiData(apiCreds) {
        const credentials = [];

        for (const [path, credInfo] of Object.entries(apiCreds)) {
            const status = credInfo.status || {};
            const credential = {
                path: path,
                filename: credInfo.filename,
                backend_type: credInfo.backend_type,
                disabled: status.disabled || false,
                error_codes: status.error_codes || [],
                user_email: status.user_email || credInfo.user_email || null,
                last_success: status.last_success,
                gemini_2_5_pro_calls: status.gemini_2_5_pro_calls || 0,
                total_calls: status.total_calls || 0,
                next_reset_time: status.next_reset_time,
                daily_limit_gemini_2_5_pro: status.daily_limit_gemini_2_5_pro,
                daily_limit_total: status.daily_limit_total,
                allowed_base_models: status.allowed_base_models,
                size: credInfo.size,
                modified_time: credInfo.modified_time
            };

            credentials.push(credential);
        }

        return credentials;
    }

    getAuthToken() {
        // 统一从sessionStorage获取token，保持与auth.js一致
        const token = window.sessionStorage.getItem('authToken') || window.authToken;

        // 如果token不存在，重定向到登录页
        if (!token) {
            console.warn('未找到认证token，重定向到登录页');
            window.location.href = '/';
            return null;
        }

        return token;
    }

    async performCredentialAction(filename, action) {
        try {
            const response = await fetch('/creds/action', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: filename,
                    action: action
                })
            });

            if (!response.ok) {
                throw new Error(`操作失败: HTTP ${response.status}`);
            }

            const result = await response.json();
            this.showSuccess(result.message);
            return true;

        } catch (error) {
            console.error('操作失败:', error);
            this.showError(`操作失败: ${error.message}`);
            return false;
        }
    }

    async performBatchAction(action) {
        if (this.selectedCredentials.size === 0) {
            this.showError('请先选择要操作的凭证');
            return;
        }

        try {
            const filenames = Array.from(this.selectedCredentials);
            const response = await fetch('/creds/batch-action', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: action,
                    filenames: filenames
                })
            });

            if (!response.ok) {
                throw new Error(`批量操作失败: HTTP ${response.status}`);
            }

            const result = await response.json();

            // 显示批量操作结果
            if (result.errors && result.errors.length > 0) {
                this.showError(`操作完成，但有个别错误:\n${result.errors.join('\n')}`);
            } else {
                this.showSuccess(result.message);
            }

            this.loadCredentials(); // 重新加载数据

        } catch (error) {
            console.error('批量操作失败:', error);
            this.showError(`批量操作失败: ${error.message}`);
        }
    }

    async fetchCredentialEmail(filename) {
        try {
            const encodedFilename = encodeURIComponent(filename);
            const response = await fetch(`/creds/fetch-email/${encodedFilename}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`获取邮箱失败: HTTP ${response.status}`);
            }

            const result = await response.json();
            this.showSuccess(result.message);
            this.loadCredentials(); // 刷新列表

        } catch (error) {
            console.error('获取邮箱失败:', error);
            this.showError(`获取邮箱失败: ${error.message}`);
        }
    }

    async refreshAllEmails() {
        if (!confirm('确定要刷新所有凭证的邮箱吗？这可能需要一些时间。')) {
            return;
        }

        try {
            const response = await fetch('/creds/refresh-all-emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`批量刷新邮箱失败: HTTP ${response.status}`);
            }

            const result = await response.json();

            this.showSuccess(
                `邮箱刷新完成！\n成功: ${result.success_count}/${result.total_count}`
            );

            this.loadCredentials(); // 刷新列表

        } catch (error) {
            console.error('批量刷新邮箱失败:', error);
            this.showError(`批量刷新邮箱失败: ${error.message}`);
        }
    }

    showSuccess(message) {
        // 显示成功消息的临时实现
        alert(message); // 后续替换为更优雅的提示
    }

    showError(message) {
        // 显示错误消息的临时实现
        alert(message); // 后续替换为更优雅的提示
    }

    updateStatistics() {
        const total = this.credentials.length;
        const enabled = this.credentials.filter(c => !c.disabled).length;
        const disabled = this.credentials.filter(c => c.disabled).length;

        document.getElementById('totalCount').textContent = total;
        document.getElementById('enabledCount').textContent = enabled;
        document.getElementById('disabledCount').textContent = disabled;
    }

    renderCredentials() {
        const filteredCredentials = this.getFilteredCredentials();
        const paginatedCredentials = this.getPaginatedCredentials(filteredCredentials);

        const listContainer = document.getElementById('credentialsList');
        const emptyState = document.getElementById('emptyState');

        if (paginatedCredentials.length === 0) {
            listContainer.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        listContainer.innerHTML = paginatedCredentials.map(cred => this.createCredentialItem(cred)).join('');

        // 重新绑定项目事件
        this.bindItemEvents();
        this.updateBulkActionButtons();
    }

    getFilteredCredentials() {
        return this.credentials.filter(cred => {
            // 状态筛选
            if (this.filters.status) {
                if (this.filters.status === 'enabled' && cred.disabled) {
                    return false;
                }
                if (this.filters.status === 'disabled' && !cred.disabled) {
                    return false;
                }
                if (this.filters.status === 'error' && cred.error_codes.length === 0) {
                    return false;
                }
            }

            // 错误码筛选
            if (this.filters.errorCode && !cred.error_codes.includes(parseInt(this.filters.errorCode))) {
                return false;
            }

            return true;
        });
    }

    getPaginatedCredentials(credentials) {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        return credentials.slice(startIndex, endIndex);
    }

    createCredentialItem(credential) {
        const statusBadge = this.getStatusBadge(credential);
        const errorBadge = credential.error_codes.length > 0 ?
            `<span class="badge badge-error">错误 (${credential.error_codes.length})</span>` : '';

        const emailDisplay = credential.user_email ||
            `<span style="color: #9ca3af; cursor: pointer;" onclick="credentialsManager.fetchCredentialEmail('${credential.filename}')">点击获取邮箱</span>`;

        return `
            <div class="credential-item" data-id="${credential.filename}">
                <div class="credential-checkbox">
                    <input type="checkbox" class="credential-select" data-id="${credential.filename}"
                           ${this.selectedCredentials.has(credential.filename) ? 'checked' : ''}>
                </div>
                <div class="credential-info">
                    <div class="credential-name">${credential.filename}</div>
                    <div class="credential-details">
                        <span class="email">${emailDisplay}</span>
                        ${statusBadge}
                        ${errorBadge}
                    </div>
                    <div class="credential-meta">
                        <span>后端: ${credential.backend_type}</span>
                        <span>总调用: ${credential.total_calls}</span>
                        <span>Gemini Pro: ${credential.gemini_2_5_pro_calls}</span>
                        ${credential.size ? `<span>大小: ${this.formatFileSize(credential.size)}</span>` : ''}
                        ${credential.modified_time ? `<span>修改: ${this.formatDate(credential.modified_time)}</span>` : ''}
                    </div>
                </div>
                <div class="credential-actions">
                    <button class="btn-sm ${credential.disabled ? 'btn-success' : 'btn-warning'}"
                            onclick="credentialsManager.toggleStatus('${credential.filename}')">
                        <i class="fas ${credential.disabled ? 'fa-check' : 'fa-ban'}"></i>
                        ${credential.disabled ? '启用' : '禁用'}
                    </button>
                    <button class="btn-sm btn-primary" onclick="credentialsManager.fetchCredentialEmail('${credential.filename}')">
                        <i class="fas fa-envelope"></i>
                        获取邮箱
                    </button>
                    <button class="btn-sm btn-secondary" onclick="openModelPermissionModal('${credential.filename}')">
                        <i class="fas fa-sliders-h"></i>
                        模型限制
                    </button>
                    <button class="btn-sm btn-danger" onclick="credentialsManager.deleteCredential('${credential.filename}')">
                        <i class="fas fa-trash"></i>
                        删除
                    </button>
                </div>
            </div>
        `;
    }

    getStatusBadge(credential) {
        if (credential.disabled) {
            return '<span class="badge badge-secondary">禁用</span>';
        } else if (credential.error_codes.length > 0) {
            return '<span class="badge badge-danger">错误</span>';
        } else {
            return '<span class="badge badge-success">启用</span>';
        }
    }

    formatDate(timestamp) {
        const date = new Date(timestamp * 1000); // API返回的是Unix时间戳
        return date.toLocaleDateString('zh-CN');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    bindItemEvents() {
        // 绑定复选框事件
        document.querySelectorAll('.credential-select').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const id = e.target.dataset.id;
                if (e.target.checked) {
                    this.selectedCredentials.add(id);
                } else {
                    this.selectedCredentials.delete(id);
                }
                this.updateSelectedCount();
                this.updateBulkActionButtons();
                this.updateSelectAllCheckbox();
            });
        });
    }

    updateSelectedCount() {
        document.getElementById('selectedCount').textContent = `已选择 ${this.selectedCredentials.size} 项`;
    }

    updateBulkActionButtons() {
        const hasSelection = this.selectedCredentials.size > 0;
        const buttons = document.querySelectorAll('.bulk-actions button[disabled]');

        buttons.forEach(button => {
            button.disabled = !hasSelection;
        });
    }

    updateSelectAllCheckbox() {
        const selectAll = document.getElementById('selectAll');
        const totalVisible = document.querySelectorAll('.credential-select').length;
        const selectedVisible = document.querySelectorAll('.credential-select:checked').length;

        selectAll.checked = totalVisible > 0 && totalVisible === selectedVisible;
        selectAll.indeterminate = selectedVisible > 0 && selectedVisible < totalVisible;
    }

    showLoading() {
        document.getElementById('credentialsList').innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    }

    hideLoading() {
        // 加载完成后的清理工作
    }

    // 操作方法 - 对接真实API
    async toggleStatus(filename) {
        const action = this.credentials.find(c => c.filename === filename)?.disabled ? 'enable' : 'disable';
        const success = await this.performCredentialAction(filename, action);
        if (success) {
            this.loadCredentials();
        }
    }

    async deleteCredential(filename) {
        if (confirm(`确定要删除凭证文件 ${filename} 吗？此操作不可恢复。`)) {
            const success = await this.performCredentialAction(filename, 'delete');
            if (success) {
                this.loadCredentials();
            }
        }
    }

    openModelPermissions(filename) {
        // 调用model_permissions.js中的全局函数
        if (typeof openModelPermissionModal === 'function') {
            openModelPermissionModal(filename);
        } else {
            console.warn('model_permissions.js 未加载，无法打开模型权限配置');
            alert('模型权限配置功能加载失败，请刷新页面重试');
        }
    }
}

// 全局函数供HTML调用
let credentialsManager;

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.credential-select');

    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
        const id = checkbox.dataset.id;
        if (selectAll.checked) {
            credentialsManager.selectedCredentials.add(id);
        } else {
            credentialsManager.selectedCredentials.delete(id);
        }
    });

    credentialsManager.updateSelectedCount();
    credentialsManager.updateBulkActionButtons();
}

function bulkDelete() {
    credentialsManager.performBatchAction('delete');
}

function bulkGetEmails() {
    // 由于没有专门的批量获取邮箱API，这里调用自定义实现
    bulkGetEmailsImpl();
}

function bulkEnable() {
    credentialsManager.performBatchAction('enable');
}

function bulkDisable() {
    credentialsManager.performBatchAction('disable');
}

function refreshCredentials() {
    credentialsManager.loadCredentials();
}

// 批量获取邮箱的实现
async function bulkGetEmailsImpl() {
    if (credentialsManager.selectedCredentials.size === 0) {
        alert('请先选择要获取邮箱的凭证');
        return;
    }

    if (!confirm(`确定要获取选中的 ${credentialsManager.selectedCredentials.size} 个凭证的邮箱吗？`)) {
        return;
    }

    const filenames = Array.from(credentialsManager.selectedCredentials);
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // 逐个获取邮箱，因为API没有批量获取邮箱的接口
    for (const filename of filenames) {
        try {
            const encodedFilename = encodeURIComponent(filename);
            const response = await fetch(`/creds/fetch-email/${encodedFilename}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${credentialsManager.getAuthToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                successCount++;
            } else {
                errorCount++;
                errors.push(`${filename}: HTTP ${response.status}`);
            }
        } catch (error) {
            errorCount++;
            errors.push(`${filename}: ${error.message}`);
        }
    }

    if (errorCount > 0) {
        alert(`邮箱获取完成！\n成功: ${successCount}\n失败: ${errorCount}\n\n错误详情:\n${errors.join('\n')}`);
    } else {
        alert(`邮箱获取完成！成功: ${successCount}`);
    }

    credentialsManager.loadCredentials(); // 刷新列表
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 当切换到凭证管理页面时初始化
    const credentialsNavItem = document.querySelector('[data-module="credentials"]');
    if (credentialsNavItem) {
        credentialsNavItem.addEventListener('click', () => {
            if (!credentialsManager) {
                credentialsManager = new CredentialsManager();
            }
        });
    }
});