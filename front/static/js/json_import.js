/**
 * JSON导入功能 JavaScript
 * 处理JSON到TOML的转换和导入操作
 */

class JsonImportManager {
    constructor() {
        // 保存当前用户已以JSON转换出的TOML文本
        this.currentTomlContent = null;
        this.init();
    }

    init() {
        this.bindEvents();
    }

    // 绑定输入监听，生成自动JSON提示
    bindEvents() {
        const jsonInput = document.getElementById('jsonInput');
        if (jsonInput) {
            jsonInput.addEventListener('input', this.debounce(() => {
                this.validateJsonInput();
            }, 500));
        }
    }

    // 防抖
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 验证JSON格式
    validateJsonInput() {
        const jsonInput = document.getElementById('jsonInput');
        const convertBtn = document.querySelector('[onclick="convertJsonToToml()"]');
        if (!jsonInput || !convertBtn) return;

        const value = jsonInput.value.trim();
        if (!value) {
            convertBtn.disabled = true;
            this.clearErrorMessage();
            return;
        }

        try {
            JSON.parse(value);
            convertBtn.disabled = false;
            this.clearErrorMessage();
        } catch (error) {
            convertBtn.disabled = true;
            this.showErrorMessage('JSON格式错误: ' + error.message);
        }
    }

    // 显示错误消息
    showErrorMessage(message) {
        let errorElement = document.getElementById('jsonImportError');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = 'jsonImportError';
            errorElement.className = 'status-message status-error';
            errorElement.style.marginTop = '8px';
            const inputWrapper = document.getElementById('jsonInput')?.parentNode;
            if (inputWrapper) {
                inputWrapper.appendChild(errorElement);
            }
        }
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    clearErrorMessage() {
        const errorElement = document.getElementById('jsonImportError');
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    }

    // JSON -> TOML 预览
    async convertJsonToToml() {
        const jsonArea = document.getElementById('jsonInput');
        if (!jsonArea) return;

        const jsonInput = jsonArea.value.trim();
        if (!jsonInput) {
            this.showErrorMessage('请输入JSON数据');
            return;
        }

        try {
            const jsonData = JSON.parse(jsonInput);
            // 转换为标准格式，并必须要过滤不启用或重复邮箱
            const standardData = this.transformToStandardFormat(jsonData);
            // 转换为TOML文本
            const tomlContent = this.convertToToml(standardData);

            this.currentTomlContent = tomlContent;
            this.showTomlPreview(tomlContent);
            this.showSuccessMessage('JSON转换为TOML格式成功！');
        } catch (error) {
            console.error('JSON转换失败:', error);
            this.showErrorMessage('转换失败: ' + error.message);
        }
    }

    // 将各种函数转换成 { key: credentials } 格式，然后用 key 作负号分隔文件名
    transformToStandardFormat(jsonData) {
        let standardData = {};

        // 情况1: 数组格式 [{"project_id": "xxx", "credentials": {...}}, ...]
        if (Array.isArray(jsonData)) {
            jsonData.forEach(item => {
                if (item && item.project_id && item.credentials) {
                    standardData[item.project_id] = item.credentials;
                }
            });
        }
        // 情况2: 对象格式 {"project1": {"credentials": {...}}, "project2": {...}}
        else if (typeof jsonData === 'object' && jsonData && !jsonData.creds) {
            Object.keys(jsonData).forEach(key => {
                const value = jsonData[key];
                if (!value) return;
                if (value.credentials) {
                    standardData[key] = value.credentials;
                } else {
                    standardData[key] = value;
                }
            });
        }
        // 情况3: 包含creds字段 {"creds": {"project1": {...}, "project2": {...}}}
        else if (jsonData && jsonData.creds) {
            standardData = jsonData.creds;
        }
        // 情况4: 直接是credentials对象
        else if (typeof jsonData === 'object' && jsonData) {
            standardData = jsonData;
        }

        return this.filterCredentials(standardData);
    }

    // 过滤启用凭证，删除同一邮箱的重复正权限
    filterCredentials(credentialsData) {
        const filteredData = {};
        const seenEmails = new Set();

        Object.keys(credentialsData).forEach(key => {
            const cred = credentialsData[key];
            if (!cred) return;

            // 判断是否启用
            let isEnabled = true;
            if (cred.status && cred.status.disabled === true) {
                isEnabled = false;
            } else if (cred.disabled === true) {
                isEnabled = false;
            }

            if (!isEnabled) {
                console.log(`跳过已禁用的凭证: ${key}`);
                return;
            }

            // 邮箱去重
            let email = null;
            if (cred.status && cred.status.user_email) {
                email = cred.status.user_email;
            } else if (cred.user_email) {
                email = cred.user_email;
            } else if (cred.credential_id && typeof cred.credential_id === 'string' && cred.credential_id.includes('@')) {
                email = cred.credential_id;
            }

            if (email && seenEmails.has(email)) {
                console.log(`跳过重复邮箱的凭证: ${key} (邮箱: ${email})`);
                return;
            }

            if (email) {
                seenEmails.add(email);
            }

            filteredData[key] = cred;
        });

        console.log(`过滤结果: 原有 ${Object.keys(credentialsData).length} 个，过滤后 ${Object.keys(filteredData).length} 个`);
        return filteredData;
    }

    // 转换为TOML格式，使用 ["filename.json"] 表名，通过路径分隔文件名选择
    convertToToml(data) {
        let toml = '';

        Object.keys(data).forEach(projectKey => {
            const credentials = data[projectKey];
            const filename = projectKey.endsWith('.json') ? projectKey : `${projectKey}.json`;

            toml += `["${filename}"]\n`;

            Object.keys(credentials).forEach(key => {
                const value = credentials[key];

                if (typeof value === 'string') {
                    if (value.includes('\n')) {
                        toml += `${key} = """\n${value}\n"""\n`;
                    } else {
                        toml += `${key} = "${value}"\n`;
                    }
                } else if (typeof value === 'boolean') {
                    toml += `${key} = ${value}\n`;
                } else if (typeof value === 'number') {
                    toml += `${key} = ${value}\n`;
                } else if (Array.isArray(value)) {
                    toml += `${key} = [${value.map(v => `"${v}"`).join(', ')}]\n`;
                } else if (typeof value === 'object' && value !== null) {
                    toml += `${key} = ${JSON.stringify(value)}\n`;
                }
            });

            toml += '\n';
        });

        return toml.trim();
    }

    // 显示TOML预览
    showTomlPreview(tomlContent) {
        const previewSection = document.getElementById('tomlPreviewSection');
        const tomlPreview = document.getElementById('tomlPreview');

        if (!previewSection || !tomlPreview) return;

        tomlPreview.textContent = tomlContent;
        previewSection.style.display = 'block';
        previewSection.scrollIntoView({ behavior: 'smooth' });
    }

    // 清空JSON输入
    clearJsonInput() {
        const jsonInput = document.getElementById('jsonInput');
        if (jsonInput) {
            jsonInput.value = '';
        }
        const previewSection = document.getElementById('tomlPreviewSection');
        const resultsSection = document.getElementById('importResultsSection');
        if (previewSection) previewSection.style.display = 'none';
        if (resultsSection) resultsSection.style.display = 'none';

        this.clearErrorMessage();
        this.currentTomlContent = null;

        const convertBtn = document.querySelector('[onclick="convertJsonToToml()"]');
        if (convertBtn) convertBtn.disabled = true;
    }

    // 复制TOML到剪贴板
    async copyTomlToClipboard() {
        const tomlPreview = document.getElementById('tomlPreview');
        if (!tomlPreview) return;

        const tomlContent = tomlPreview.textContent;
        if (!tomlContent) {
            this.showErrorMessage('没有可复制的TOML内容');
            return;
        }

        try {
            await navigator.clipboard.writeText(tomlContent);
            this.showSuccessMessage('TOML内容已复制到剪贴板');
        } catch (error) {
            const textarea = document.createElement('textarea');
            textarea.value = tomlContent;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showSuccessMessage('TOML内容已复制到剪贴板');
        }
    }

    // 导入TOML到系统
    async importTomlToSystem() {
        if (!this.currentTomlContent) {
            this.showErrorMessage('没有可导入的数据，请先转换JSON');
            return;
        }

        if (!confirm('确定要导入这些凭证到系统吗？这将创建新的凭证文件。')) {
            return;
        }

        try {
            showNotification('正在导入凭证到系统...', 'info');

            const response = await fetch('/creds/import-toml', {
                method: 'POST',
                headers: getPanelAuthHeaders(),
                body: JSON.stringify({
                    content: this.currentTomlContent
                })
            });

            if (!response.ok) {
                throw new Error(`导入失败: HTTP ${response.status}`);
            }

            const result = await response.json();

            this.showImportResults(result);
            this.showSuccessMessage(`导入完成！成功导入${result.imported_count || 0}/${result.total_count || 0} 个凭证`);

            if (window.credentialsManager) {
                setTimeout(() => {
                    window.credentialsManager.loadCredentials();
                }, 1000);
            }

        } catch (error) {
            console.error('导入失败:', error);
            this.showErrorMessage('导入失败: ' + error.message);
        }
    }

    // 显示导入结果
    showImportResults(result) {
        const resultsSection = document.getElementById('importResultsSection');
        const resultSummary = document.getElementById('resultSummary');
        const resultDetails = document.getElementById('resultDetails');

        if (!resultsSection || !resultSummary || !resultDetails) return;

        const successCount = result.imported_count || 0;
        const totalCount = result.total_count || 0;
        const failCount = totalCount > successCount ? (totalCount - successCount) : 0;

        resultSummary.innerHTML = `
            <div class="summary-stats" style="display: flex; gap: 20px;">
                <div class="stat-item success">
                    <i class="fas fa-check-circle"></i>
                    <span class="stat-number">${successCount}</span>
                    <span class="stat-label">成功导入</span>
                </div>
                <div class="stat-item error">
                    <i class="fas fa-times-circle"></i>
                    <span class="stat-number">${failCount}</span>
                    <span class="stat-label">导入失败</span>
                </div>
                <div class="stat-item total">
                    <i class="fas fa-layer-group"></i>
                    <span class="stat-number">${totalCount}</span>
                    <span class="stat-label">总计</span>
                </div>
            </div>
            <div class="summary-message" style="margin-top: 12px;">
                导入完成，成功率: ${totalCount > 0 ? ((successCount / totalCount) * 100).toFixed(1) : 0}%
            </div>
        `;

        let detailsHtml = '';

        if (result.results && Array.isArray(result.results)) {
            result.results.forEach(item => {
                const isSuccess = item.status === 'success';
                detailsHtml += `
                    <div class="result-item ${isSuccess ? 'success' : 'error'}">
                        <div class="result-item-info">
                            <div class="result-item-name">${item.filename || item.project_id || ''}</div>
                            <div class="result-item-path">${item.file_path || ''}</div>
                            ${!isSuccess ? `<div class="result-item-error">${item.message || item.error || '未知错误'}</div>` : ''}
                        </div>
                        <div class="result-item-status ${isSuccess ? 'success' : 'error'}">
                            ${isSuccess ? '成功' : '失败'}
                        </div>
                    </div>
                `;
            });
        }

        resultDetails.innerHTML = detailsHtml;
        resultsSection.style.display = 'block';
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    // 显示成功消息
    showSuccessMessage(message) {
        if (typeof showNotification === 'function') {
            showNotification(message, 'success');
        } else {
            alert(message);
        }
    }

    // 获取认证token的获取工具类函数以统一
    getAuthToken() {
        return window.sessionStorage.getItem('authToken') || window.authToken || '';
    }
}

// 全局实例
let jsonImportManager;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        jsonImportManager = new JsonImportManager();
    }, 100);
});

// 导出全局函数供HTML使用
window.convertJsonToToml = () => {
    if (jsonImportManager) {
        jsonImportManager.convertJsonToToml();
    }
};

window.clearJsonInput = () => {
    if (jsonImportManager) {
        jsonImportManager.clearJsonInput();
    }
};

window.copyTomlToClipboard = () => {
    if (jsonImportManager) {
        jsonImportManager.copyTomlToClipboard();
    }
};

window.importTomlToSystem = () => {
    if (jsonImportManager) {
        jsonImportManager.importTomlToSystem();
    }
};