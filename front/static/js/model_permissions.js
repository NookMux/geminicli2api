/**
 * 妯″瀷鏉冮檺绠＄悊 JavaScript
 * 澶勭悊鍑瘉鐨勬ā鍨嬫潈闄愰厤缃脊绐楀拰鐩稿叧鎿嶄綔
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
                headers: getPanelAuthHeaders()
            });

            if (!response.ok) {
                throw new Error(`鍔犺浇鏀寔鐨勬ā鍨嬪け璐?: HTTP ${response.status}`);
            }

            const data = await response.json();
            this.supportedModels = data.models || this.getDefaultModels();
        } catch (error) {
            console.error('鍔犺浇鏀寔鐨勬ā鍨嬪け璐?:', error);
            this.supportedModels = this.getDefaultModels();
        }
    }

    getDefaultModels() {
        return [
            'gemini-2.5-pro',
            'gemini-2.5-flash',
            'gemini-3-pro-preview',
            'gemini-2.5-flash-image',
            'gemini-2.5-flash-image-preview'
        ];
    }

    async loadCredentialModels(filename) {
        try {
            if (window.credentialsManager) {
                const credential = window.credentialsManager.credentials.find(c => c.filename === filename);
                if (credential && Object.prototype.hasOwnProperty.call(credential, 'allowed_base_models')) {
                    this.allowedBaseModels = credential.allowed_base_models;
                } else {
                    this.allowedBaseModels = null;
                }
            } else {
                this.allowedBaseModels = null;
            }
        } catch (error) {
            console.error('鑾峰彇鍑瘉妯″瀷鏉冮檺澶辫触:', error);
            this.allowedBaseModels = null;
        }
    }

    createModal() {
        const existingModal = document.getElementById('modelPermissionModal');
        if (existingModal) {
            existingModal.remove();
        }

        const isNull = this.allowedBaseModels === null || typeof this.allowedBaseModels === 'undefined';
        const isEmptyArray = Array.isArray(this.allowedBaseModels) && this.allowedBaseModels.length === 0;
        const isCustom = Array.isArray(this.allowedBaseModels) && this.allowedBaseModels.length > 0;

        const modalHtml = `
            <div id="modelPermissionModal" class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i class="fas fa-sliders-h"></i> 妯″瀷鏉冮檺閰嶇疆</h3>
                        <button class="modal-close" onclick="closeModelPermissionModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>鍑瘉鏂囦欢: <strong>${this.currentFilename}</strong></label>
                        </div>

                        <div class="form-group">
                            <label>
                                <input type="radio" name="modelPermission" value="null"
                                       ${isNull ? 'checked' : ''}
                                       onchange="modelPermissionsManager.onPermissionTypeChange('null')">
                                涓嶉檺鍒舵ā鍨嬶紙浣跨敤榛樿琛屼负锛?
                            </label>
                        </div>

                        <div class="form-group">
                            <label>
                                <input type="radio" name="modelPermission" value="empty"
                                       ${isEmptyArray ? 'checked' : ''}
                                       onchange="modelPermissionsManager.onPermissionTypeChange('empty')">
                                绂佺敤鎵€鏈夋ā鍨嬶紙杞鐢ㄦ鍑瘉锛?
                            </label>
                        </div>

                        <div class="form-group">
                            <label>
                                <input type="radio" name="modelPermission" value="custom"
                                       ${isCustom ? 'checked' : ''}
                                       onchange="modelPermissionsManager.onPermissionTypeChange('custom')">
                                鑷畾涔夊厑璁哥殑妯″瀷:
                            </label>
                            <div id="customModelsContainer" class="checkbox-group"
                                 style="display: ${isCustom ? 'block' : 'none'}">
                                ${this.supportedModels.map(model => `
                                    <label class="checkbox-item">
                                        <input type="checkbox" name="allowedModels" value="${model}"
                                               ${Array.isArray(this.allowedBaseModels) && this.allowedBaseModels.includes(model) ? 'checked' : ''}>
                                        <span>${model}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="closeModelPermissionModal()">鍙栨秷</button>
                        <button class="btn btn-primary" onclick="modelPermissionsManager.savePermissions()">
                            <i class="fas fa-save"></i> 淇濆瓨
                        </button>
                    </div>
                </div>
            </div>
        `;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = modalHtml.trim();
        this.modal = wrapper.firstChild;
        document.body.appendChild(this.modal);

        this.bindModalEvents();
    }

    bindModalEvents() {
        if (!this.modal) return;

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal) {
                this.closeModal();
            }
        }, { once: true });
    }

    showModal() {
        if (!this.modal) return;
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
        if (!customContainer) return;

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
            const selectedTypeInput = document.querySelector('input[name="modelPermission"]:checked');
            if (!selectedTypeInput) {
                alert('璇疯嚦灏戜笉灏戦€夋嫨涓€绉嶆ā鍨嬫潈闄愯繃婊ゅ璞℃柟妗?);
                return;
            }

            const selectedType = selectedTypeInput.value;
            let allowedBaseModels;

            switch (selectedType) {
                case 'null':
                    allowedBaseModels = null;
                    break;
                case 'empty':
                    allowedBaseModels = [];
                    break;
                case 'custom': {
                    const checkedBoxes = document.querySelectorAll('input[name="allowedModels"]:checked');
                    allowedBaseModels = Array.from(checkedBoxes).map(cb => cb.value);
                    if (!allowedBaseModels.length) {
                        alert('璇疯嚦灏戜笉灏戦€夋嫨涓€涓ā鍨嬶紝鎴戜滑鎴戠殑鍑瘉鏉冮檺鍙互鏆傛椂涓嶄紶锛?);
                        return;
                    }
                    break;
                }
                default:
                    allowedBaseModels = null;
            }

            const response = await fetch('/creds/update-models', {
                method: 'POST',
                headers: getPanelAuthHeaders(),
                body: JSON.stringify({
                    filename: this.currentFilename,
                    allowed_base_models: allowedBaseModels
                })
            });

            if (!response.ok) {
                throw new Error(`淇濆瓨妯″瀷鏉冮檺閰嶇疆澶辫触: HTTP ${response.status}`);
            }

            const result = await response.json();
            alert(result.message || '妯″瀷鏉冮檺閰嶇疆宸蹭繚瀛?);

            this.closeModal();
            if (window.credentialsManager) {
                window.credentialsManager.loadCredentials();
            }
        } catch (error) {
            console.error('淇濆瓨妯″瀷鏉冮檺閰嶇疆澶辫触:', error);
            alert(`淇濆瓨澶辫触: ${error.message}`);
        }
    }
}

// 鍏ㄥ眬瀹炰緥
let modelPermissionsManager;

// 鍏ㄥ眬鍑芥暟渚涘閮ㄨ皟鐢?
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

// 椤甸潰鍔犺浇鏃跺垵濮嬪寲
document.addEventListener('DOMContentLoaded', () => {
    modelPermissionsManager = new ModelPermissionsManager();
});

