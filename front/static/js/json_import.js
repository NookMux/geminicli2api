/**
 * JSON导入功能 JavaScript
 * 处理JSON到TOML的转换和导入操作
 */

class JsonImportManager {
    constructor() {
        this.currentTomlData = null;
        this.init();
    }

    init() {
        // 绑定事件监听器
        this.bindEvents();
    }

    bindEvents() {
        // 监听JSON输入区域的 change 事件进行实时验证
        const jsonInput = document.getElementById('jsonInput');
        if (jsonInput) {
            jsonInput.addEventListener('input', this.debounce(() => {
                this.validateJsonInput();
            }, 500));
        }
    }

    // 防抖函数
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 验证JSON输入格式
    validateJsonInput() {
        const jsonInput = document.getElementById('jsonInput');
        const convertBtn = document.querySelector('[onclick="convertJsonToToml()"]');

        if (!jsonInput.value.trim()) {
            convertBtn.disabled = true;
            return;
        }

        try {
            const jsonData = JSON.parse(jsonInput.value);
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
            document.getElementById('jsonInput').parentNode.appendChild(errorElement);
        }
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }

    // 清除错误消息
    clearErrorMessage() {
        const errorElement = document.getElementById('jsonImportError');
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    }

    // 转换JSON到TOML预览
    async convertJsonToToml() {
        const jsonInput = document.getElementById('jsonInput').value.trim();

        if (!jsonInput) {
            this.showErrorMessage('请输入JSON数据');
            return;
        }

        try {
            // 解析JSON数据
            const jsonData = JSON.parse(jsonInput);

            // 转换为标准格式
            const standardData = this.transformToStandardFormat(jsonData);

            // 转换为TOML
            const tomlContent = this.convertToToml(standardData);

            // 显示TOML预览
            this.showTomlPreview(tomlContent);

            // 保存当前数据供导入使用
            this.currentTomlData = standardData;

            this.showSuccessMessage('JSON转换为TOML格式成功！');

        } catch (error) {
            console.error('JSON转换失败:', error);
            this.showErrorMessage('转换失败: ' + error.message);
        }
    }

    // 将各种JSON格式转换为标准格式，并进行过滤
    transformToStandardFormat(jsonData) {
        let standardData = {};

        // 情况1: 数组格式 [{"project_id": "xxx", "credentials": {...}}, ...]
        if (Array.isArray(jsonData)) {
            jsonData.forEach(item => {
                if (item.project_id && item.credentials) {
                    standardData[item.project_id] = item.credentials;
                }
            });
        }
        // 情况2: 对象格式 {"project1": {"credentials": {...}}, "project2": {...}}
        else if (typeof jsonData === 'object' && !jsonData.creds) {
            Object.keys(jsonData).forEach(key => {
                const value = jsonData[key];
                if (value.credentials) {
                    standardData[key] = value.credentials;
                } else {
                    standardData[key] = value;
                }
            });
        }
        // 情况3: 包含creds字段 {"creds": {"project1": {...}, "project2": {...}}}
        else if (jsonData.creds) {
            standardData = jsonData.creds;
        }
        // 情况4: 直接是credentials对象
        else if (typeof jsonData === 'object') {
            standardData = jsonData;
        }

        // 过滤逻辑：只导入启用的凭证并对相同邮箱去重
        return this.filterCredentials(standardData);
    }

    // 过滤凭证：只导入启用的凭证并对相同邮箱去重
    filterCredentials(credentialsData) {
        const filteredData = {};
        const seenEmails = new Set();

        Object.keys(credentialsData).forEach(key => {
            const cred = credentialsData[key];

            // 检查是否为启用状态
            let isEnabled = true;

            // 从status字段检查disabled状态
            if (cred.status && cred.status.disabled === true) {
                isEnabled = false;
            }
            // 从顶层检查disabled状态
            else if (cred.disabled === true) {
                isEnabled = false;
            }

            if (!isEnabled) {
                console.log(`跳过已禁用的凭证: ${key}`);
                return;
            }

            // 获取邮箱地址
            let email = null;
            if (cred.status && cred.status.user_email) {
                email = cred.status.user_email;
            } else if (cred.user_email) {
                email = cred.user_email;
            } else if (cred.credential_id && cred.credential_id.includes('@')) {
                // 从credential_id中提取邮箱（如果适用）
                email = cred.credential_id;
            }

            // 邮箱去重：如果邮箱已存在，跳过当前凭证
            if (email && seenEmails.has(email)) {
                console.log(`跳过重复邮箱的凭证: ${key} (邮箱: ${email})`);
                return;
            }

            // 记录邮箱并添加到过滤结果
            if (email) {
                seenEmails.add(email);
            }

            filteredData[key] = cred;
        });

        console.log(`过滤结果: 原始 ${Object.keys(credentialsData).length} 个，过滤后 ${Object.keys(filteredData).length} 个`);
        return filteredData;
    }

    // 转换为TOML格式（简化实现）
    convertToToml(data) {
        let toml = '';

        Object.keys(data).forEach(projectId => {
            toml += `[[${projectId}]]\n`;
            const credentials = data[projectId];

            Object.keys(credentials).forEach(key => {
                const value = credentials[key];

                if (typeof value === 'string') {
                    // 处理多行字符串
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

        tomlPreview.textContent = tomlContent;
        previewSection.style.display = 'block';

        // 滚动到预览区域
        previewSection.scrollIntoView({ behavior: 'smooth' });
    }

    // 清空JSON输入
    clearJsonInput() {
        document.getElementById('jsonInput').value = '';
        document.getElementById('tomlPreviewSection').style.display = 'none';
        document.getElementById('importResultsSection').style.display = 'none';
        this.clearErrorMessage();
        this.currentTomlData = null;

        // 禁用转换按钮
        document.querySelector('[onclick="convertJsonToToml()"]').disabled = true;
    }

    // 复制TOML到剪贴板
    async copyTomlToClipboard() {
        const tomlContent = document.getElementById('tomlPreview').textContent;

        if (!tomlContent) {
            this.showErrorMessage('没有可复制的TOML内容');
            return;
        }

        try {
            await navigator.clipboard.writeText(tomlContent);
            this.showSuccessMessage('TOML内容已复制到剪贴板');
        } catch (error) {
            // 降级方案
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
        if (!this.currentTomlData) {
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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    toml_data: this.currentTomlData
                })
            });

            if (!response.ok) {
                throw new Error(`导入失败: HTTP ${response.status}`);
            }

            const result = await response.json();

            // 显示导入结果
            this.showImportResults(result);

            this.showSuccessMessage(`导入完成！成功导入 ${result.success_count || 0} 个凭证`);

            // 如果有凭证管理器，刷新凭证列表
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

        // 显示汇总信息
        const successCount = result.success_count || 0;
        const failCount = result.fail_count || 0;
        const totalCount = successCount + failCount;

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

        // 显示详细结果
        let detailsHtml = '';

        if (result.results && Array.isArray(result.results)) {
            result.results.forEach(item => {
                const isSuccess = item.status === 'success';
                detailsHtml += `
                    <div class="result-item ${isSuccess ? 'success' : 'error'}">
                        <div class="result-item-info">
                            <div class="result-item-name">${item.project_id || item.filename}</div>
                            <div class="result-item-path">${item.file_path || ''}</div>
                            ${!isSuccess ? `<div class="result-item-error">${item.error || '未知错误'}</div>` : ''}
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

        // 滚动到结果区域
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    // 显示成功消息
    showSuccessMessage(message) {
        showNotification(message, 'success');
    }

    // 获取认证token
    getAuthToken() {
        // 统一从sessionStorage获取token，保持与其他模块一致
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
let jsonImportManager;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保DOM完全加载
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