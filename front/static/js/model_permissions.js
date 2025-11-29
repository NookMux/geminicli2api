/**
 * 模型权限管理 JavaScript
 * 处理凭证的模型权限配置弹窗和相关操作
 */

class ModelPermissionsManager {
    constructor() {
        this.currentFilename = null;
        this.supportedModels = [];
        this.allowedBaseModels = null;
        this.modal = null;
    }

    async openModal(filename) {
        this.currentFilename = filename;
        await this.loadSupportedModels();
        await this.loadCredentialModels(filename);
        this.createModal();
        this.showModal();
    }

    async loadSupportedModels() {
        try {
            const response = await fetch('/config/supported-models', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`加载支持的模型失败: HTTP ${response.status}`);
            }

            const data = await response.json();
            this.supportedModels = data.models || this.getDefaultModels();

        } catch (error) {
            console.error('加载支持的模型失败:', error);
            // 使用默认模型列表作为fallback
            this.supportedModels = this.getDefaultModels();
        }
    }

    getDefaultModels() {
        return [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-3-pro-preview",
            "gemini-2.5-flash-image",
            "gemini-2.5-flash-image-preview"
        ];
    }

    async loadCredentialModels(filename) {
        try {
            // 从credentialsManager中获取当前凭证的allowed_base_models
            if (window.credentialsManager) {
                const credential = window.credentialsManager.credentials.find(c => c.filename === filename);
                this.allowedBaseModels = credential ? credential.allowed_base_models : null;
            } else {
                this.allowedBaseModels = null;
            }
        } catch (error) {
            console.error('获取凭证模型权限失败:', error);
            this.allowedBaseModels = null;
        }
    }

    createModal() {
        // 如果已存在modal，先移除
        const existingModal = document.getElementById('modelPermissionModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modalHtml = `
            <div id="modelPermissionModal" class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i class="fas fa-sliders-h"></i> 模型权限配置</h3>
                        <button class="modal-close" onclick="closeModelPermissionModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>凭证文件: <strong>${this.currentFilename}</strong></label>
                        </div>

                        <div class="form-group">
                            <label>
                                <input type="radio" name="modelPermission" value="null"
                                       ${this.allowedBaseModels === null ? 'checked' : ''}
                                       onchange="modelPermissionsManager.onPermissionTypeChange('null')">
                                不限制模型（使用默认行为）
                            </label>
                        </div>

                        <div class="form-group">
                            <label>
                                <input type="radio" name="modelPermission" value="empty"
                                       ${this.allowedBaseModels === [] ? 'checked' : ''}
                                       onchange="modelPermissionsManager.onPermissionTypeChange('empty')">
                                禁用所有模型（软禁用此凭证）
                            </label>
                        </div>

                        <div class="form-group">
                            <label>
                                <input type="radio" name="modelPermission" value="custom"
                                       ${Array.isArray(this.allowedBaseModels) && this.allowedBaseModels.length > 0 ? 'checked' : ''}
                                       onchange="modelPermissionsManager.onPermissionTypeChange('custom')">
                                自定义允许的模型:
                            </label>
                            <div id="customModelsContainer" class="checkbox-group"
                                 style="display: ${Array.isArray(this.allowedBaseModels) && this.allowedBaseModels.length > 0 ? 'block' : 'none'}">
                                ${this.supportedModels.map(model => `
                                    <label class="checkbox-item">
                                        <input type="checkbox" value="${model}"
                                               ${this.allowedBaseModels?.includes(model) ? 'checked' : ''}
                                               name="allowedModels">
                                        <span>${model}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeModelPermissionModal()">
                            <i class="fas fa-times"></i> 取消
                        </button>
                        <button class="btn-primary" onclick="modelPermissionsManager.savePermissions()">
                            <i class="fas fa-save"></i> 保存配置
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.modal = document.getElementById('modelPermissionModal');

        // 绑定事件监听器
        this.bindModalEvents();
    }

    bindModalEvents() {
        // 点击遮罩层关闭弹窗
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });

        // ESC键关闭弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal) {
                this.closeModal();
            }
        });
    }

    showModal() {
        this.modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            this.modal.remove();
            this.modal = null;
        }
    }

    onPermissionTypeChange(type) {
        const customContainer = document.getElementById('customModelsContainer');

        switch (type) {
            case 'null':
            case 'empty':
                customContainer.style.display = 'none';
                break;
            case 'custom':
                customContainer.style.display = 'block';
                break;
        }
    }

    async savePermissions() {
        try {
            const selectedType = document.querySelector('input[name="modelPermission"]:checked').value;
            let allowedBaseModels;

            switch (selectedType) {
                case 'null':
                    allowedBaseModels = null;
                    break;
                case 'empty':
                    allowedBaseModels = [];
                    break;
                case 'custom':
                    const checkedBoxes = document.querySelectorAll('input[name="allowedModels"]:checked');
                    allowedBaseModels = Array.from(checkedBoxes).map(cb => cb.value);
                    if (allowedBaseModels.length === 0) {
                        alert('请至少选择一个模型');
                        return;
                    }
                    break;
            }

            const response = await fetch('/creds/update-models', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: this.currentFilename,
                    allowed_base_models: allowedBaseModels
                })
            });

            if (!response.ok) {
                throw new Error(`保存模型权限配置失败: HTTP ${response.status}`);
            }

            const result = await response.json();
            alert(result.message || '模型权限配置已保存');

            // 关闭弹窗并刷新列表
            this.closeModal();
            if (window.credentialsManager) {
                window.credentialsManager.loadCredentials();
            }

        } catch (error) {
            console.error('保存模型权限配置失败:', error);
            alert(`保存失败: ${error.message}`);
        }
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
}

// 全局实例
let modelPermissionsManager;

// 全局函数供外部调用
function openModelPermissionModal(filename) {
    if (!modelPermissionsManager) {
        modelPermissionsManager = new ModelPermissionsManager();
    }
    modelPermissionsManager.openModal(filename);
}

function closeModelPermissionModal() {
    if (modelPermissionsManager) {
        modelPermissionsManager.closeModal();
    }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    modelPermissionsManager = new ModelPermissionsManager();
});