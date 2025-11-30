/**
 * JSON 导入功能前端逻辑
 * 负责：校验 JSON → 统一结构 → 过滤禁用 / 邮箱去重 → 生成 TOML → 调用导入接口
 */

class JsonImportManager {
    constructor() {
        /** 当前预览中的 TOML 文本 */
        this.currentTomlContent = '';
        this.init();
    }

    init() {
        this.bindEvents();
    }

    /** 绑定输入框等事件 */
    bindEvents() {
        const jsonInput = document.getElementById('jsonInput');
        if (jsonInput) {
            jsonInput.addEventListener(
                'input',
                this.debounce(() => this.validateJsonInput(), 400)
            );
        }
    }

    /** 简单防抖封装 */
    debounce(func, wait = 300) {
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

    /** 校验 JSON 文本是否合法，同时控制按钮可用状态 */
    validateJsonInput() {
        const jsonInput = document.getElementById('jsonInput');
        const convertBtn = document.querySelector('#convertBtn') || document.querySelector('[onclick="convertJsonToToml()"]');
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
        } catch (err) {
            convertBtn.disabled = true;
            this.showErrorMessage('JSON 格式错误：' + err.message);
        }
    }

    /** 在 JSON 文本框下方显示错误 */
    showErrorMessage(message) {
        let errorElement = document.getElementById('jsonImportError');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = 'jsonImportError';
            errorElement.className = 'status-message status-error';
            errorElement.style.marginTop = '8px';
            const wrapper = document.getElementById('jsonInput')?.parentNode;
            if (wrapper) {
                wrapper.appendChild(errorElement);
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

    /** JSON → TOML 入口：解析 / 过滤 / 预览 */
    async convertJsonToToml() {
        const jsonArea = document.getElementById('jsonInput');
        if (!jsonArea) return;

        const jsonInput = jsonArea.value.trim();
        if (!jsonInput) {
            this.showErrorMessage('请先粘贴 JSON 数据');
            return;
        }

        try {
            const jsonData = JSON.parse(jsonInput);

            // 统一成 { filename_or_key: 纯凭证内容 }，并在这里做禁用过滤 + 邮箱去重
            const standardData = this.transformToStandardFormat(jsonData);
            const keys = Object.keys(standardData);
            if (keys.length === 0) {
                this.showErrorMessage('没有可导入的有效凭证（可能都被禁用或邮箱重复被过滤掉了）');
                return;
            }

            const tomlContent = this.convertToToml(standardData);
            this.currentTomlContent = tomlContent;
            this.showTomlPreview(tomlContent);
            this.showSuccessMessage('JSON 转换为 TOML 成功，可检查后导入系统');
        } catch (error) {
            console.error('JSON 转 TOML 失败:', error);
            this.showErrorMessage('转换失败：' + error.message);
        }
    }

    /**
     * 把各种 JSON 结构统一成：
     * { key: credentialObject }
     * 其中 key 将用于 TOML 的 ["key"] 段名
     */
    transformToStandardFormat(jsonData) {
        // 先拉平为 { key: 原始对象 }，保留 status / user_email 等信息用于过滤
        const rawMap = {};

        if (Array.isArray(jsonData)) {
            // 例如：[ { project_id, credentials, status, user_email }, ... ]
            jsonData.forEach((item, idx) => {
                if (!item || typeof item !== 'object') return;
                const key =
                    item.filename ||
                    item.project_id ||
                    item.project ||
                    `item_${idx}`;
                rawMap[key] = item;
            });
        } else if (jsonData && typeof jsonData === 'object') {
            if (jsonData.creds && typeof jsonData.creds === 'object') {
                // 典型 CLI 导出的结构：{ "creds": { "xxx.json": { status, content, ... }, ... } }
                Object.keys(jsonData.creds).forEach((key) => {
                    const value = jsonData.creds[key];
                    if (value && typeof value === 'object') {
                        rawMap[key] = value;
                    }
                });
            } else {
                // 普通对象：{ "xxx.json": {...}, "yyy": {...} }
                Object.keys(jsonData).forEach((key) => {
                    const value = jsonData[key];
                    if (value && typeof value === 'object') {
                        rawMap[key] = value;
                    }
                });
            }
        }

        // 先在原始对象上做过滤（禁用 / 邮箱去重）
        const filteredRaw = this.filterCredentials(rawMap);

        // 再压平成真正需要写入 TOML 的凭证内容
        const normalized = {};

        Object.keys(filteredRaw).forEach((key) => {
            const raw = filteredRaw[key] || {};

            // 优先使用 content / credentials 字段承载的真实 OAuth 凭证
            const baseContent = raw.content || raw.credentials || raw;
            const credential = { ...baseContent };

            // 尽量把邮箱信息放到 user_email 字段里，便于后端和后续统计
            const email =
                (raw.status && raw.status.user_email) ||
                raw.user_email ||
                baseContent.user_email ||
                baseContent.email ||
                null;

            if (email && !credential.user_email) {
                credential.user_email = email;
            }

            normalized[key] = credential;
        });

        return normalized;
    }

    /**
     * 过滤掉禁用凭证，并按邮箱去重：
     * - 有 status.disabled === true 或 disabled === true 的视为禁用
     * - 按 user_email / status.user_email / credential_id 中带 @ 的值去重
     */
    filterCredentials(credentialsData) {
        const filteredData = {};
        const seenEmails = new Set();

        Object.keys(credentialsData).forEach((key) => {
            const cred = credentialsData[key];
            if (!cred) return;

            // 是否禁用
            let isEnabled = true;
            if (cred.status && cred.status.disabled === true) {
                isEnabled = false;
            } else if (cred.disabled === true) {
                isEnabled = false;
            }

            if (!isEnabled) {
                console.log(`跳过已禁用凭证: ${key}`);
                return;
            }

            // 邮箱抽取
            let email = null;
            if (cred.status && cred.status.user_email) {
                email = cred.status.user_email;
            } else if (cred.user_email) {
                email = cred.user_email;
            } else if (cred.content && cred.content.user_email) {
                email = cred.content.user_email;
            } else if (
                cred.credential_id &&
                typeof cred.credential_id === 'string' &&
                cred.credential_id.includes('@')
            ) {
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

        console.log(
            `过滤结果：原有 ${Object.keys(credentialsData).length} 条，过滤后 ${Object.keys(filteredData).length} 条`
        );
        return filteredData;
    }

    /**
     * 把 { filename: credential } 转成 TOML 文本：
     * ["filename.json"]
     * project_id = "xxx"
     * ...
     */
    convertToToml(data) {
        let toml = '';

        Object.keys(data).forEach((projectKey) => {
            const credentials = data[projectKey];
            const filename = projectKey.endsWith('.json')
                ? projectKey
                : `${projectKey}.json`;

            toml += `["${filename}"]\n`;

            Object.keys(credentials).forEach((key) => {
                const value = credentials[key];

                if (value === undefined) {
                    return;
                }

                if (typeof value === 'string') {
                    if (value.includes('\n')) {
                        toml += `${key} = """\n${value}\n"""\n`;
                    } else {
                        // 简单转义一下双引号
                        const escaped = value.replace(/"/g, '\\"');
                        toml += `${key} = "${escaped}"\n`;
                    }
                } else if (typeof value === 'boolean') {
                    toml += `${key} = ${value}\n`;
                } else if (typeof value === 'number') {
                    toml += `${key} = ${value}\n`;
                } else if (Array.isArray(value)) {
                    const arr = value
                        .map((v) =>
                            typeof v === 'string'
                                ? `"${v.replace(/"/g, '\\"')}"`
                                : `${v}`
                        )
                        .join(', ');
                    toml += `${key} = [${arr}]\n`;
                } else if (typeof value === 'object' && value !== null) {
                    toml += `${key} = ${JSON.stringify(value)}\n`;
                }
            });

            toml += '\n';
        });

        return toml.trim();
    }

    /** 把生成的 TOML 显示到预览区 */
    showTomlPreview(tomlContent) {
        const previewSection = document.getElementById('tomlPreviewSection');
        const tomlPreview = document.getElementById('tomlPreview');

        if (!previewSection || !tomlPreview) return;

        tomlPreview.textContent = tomlContent;
        previewSection.style.display = 'block';
        previewSection.scrollIntoView({ behavior: 'smooth' });
    }

    /** 清空 JSON 输入与预览/结果 */
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
        this.currentTomlContent = '';

        const convertBtn =
            document.querySelector('#convertBtn') ||
            document.querySelector('[onclick="convertJsonToToml()"]');
        if (convertBtn) convertBtn.disabled = true;
    }

    /** 复制 TOML 内容到剪贴板 */
    async copyTomlToClipboard() {
        const tomlPreview = document.getElementById('tomlPreview');
        if (!tomlPreview) return;

        const tomlContent = tomlPreview.textContent || '';
        if (!tomlContent) {
            this.showErrorMessage('没有可复制的 TOML 内容');
            return;
        }

        try {
            await navigator.clipboard.writeText(tomlContent);
            this.showSuccessMessage('TOML 内容已复制到剪贴板');
        } catch (error) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = tomlContent;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                this.showSuccessMessage('TOML 内容已复制到剪贴板');
            } catch (err) {
                console.error('复制 TOML 失败:', err);
                this.showErrorMessage('复制失败，请手动选择文本复制');
            }
        }
    }

    /** 调用后端 /creds/import-toml 接口导入 */
    async importTomlToSystem() {
        if (!this.currentTomlContent) {
            this.showErrorMessage('当前没有可导入的数据，请先完成 JSON → TOML 转换');
            return;
        }

        if (
            !window.confirm(
                '确定要将这些凭证导入系统吗？这会为每条凭证创建/覆盖对应的 creds.toml 条目。'
            )
        ) {
            return;
        }

        try {
            if (typeof showNotification === 'function') {
                showNotification('正在导入凭证到系统...', 'info');
            }

            const response = await fetch('/creds/import-toml', {
                method: 'POST',
                headers: typeof getPanelAuthHeaders === 'function'
                    ? getPanelAuthHeaders()
                    : { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: this.currentTomlContent })
            });

            if (!response.ok) {
                throw new Error(`导入失败：HTTP ${response.status}`);
            }

            const result = await response.json();

            this.showImportResults(result);
            this.showSuccessMessage(
                `导入完成：成功 ${result.imported_count || 0} / ${
                    result.total_count || 0
                } 条`
            );

            // 导入成功后，稍等一会儿刷新凭证列表
            if (window.credentialsManager && typeof window.credentialsManager.loadCredentials === 'function') {
                setTimeout(() => {
                    window.credentialsManager.loadCredentials();
                }, 1000);
            }
        } catch (error) {
            console.error('导入失败:', error);
            this.showErrorMessage('导入失败：' + error.message);
        }
    }

    /** 在结果面板里展示导入统计与明细 */
    showImportResults(result) {
        const resultsSection = document.getElementById('importResultsSection');
        const resultSummary = document.getElementById('resultSummary');
        const resultDetails = document.getElementById('resultDetails');

        if (!resultsSection || !resultSummary || !resultDetails) return;

        const successCount = result.imported_count || 0;
        const totalCount = result.total_count || 0;
        const failCount =
            totalCount > successCount ? totalCount - successCount : 0;

        resultSummary.innerHTML = `
            <div class="summary-stats">
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
                导入完成，成功率：${
                    totalCount > 0
                        ? ((successCount / totalCount) * 100).toFixed(1)
                        : 0
                }%
            </div>
        `;

        let detailsHtml = '';

        if (Array.isArray(result.results)) {
            result.results.forEach((item) => {
                const isSuccess = item.status === 'success';
                detailsHtml += `
                    <div class="result-item ${isSuccess ? 'success' : 'error'}">
                        <div class="result-item-info">
                            <div class="result-item-name">
                                ${item.filename || item.project_id || ''}
                            </div>
                            <div class="result-item-path">
                                ${item.file_path || ''}
                            </div>
                            ${
                                !isSuccess
                                    ? `<div class="result-item-error">${
                                          item.message ||
                                          item.error ||
                                          '未知错误'
                                      }</div>`
                                    : ''
                            }
                        </div>
                        <div class="result-item-status ${
                            isSuccess ? 'success' : 'error'
                        }">
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

    /** 统一的成功提示入口 */
    showSuccessMessage(message) {
        if (typeof showNotification === 'function') {
            showNotification(message, 'success');
        } else {
            alert(message);
        }
    }

    /** 预留：如需单独拿 token，可以从这里取 */
    getAuthToken() {
        return (
            window.sessionStorage.getItem('authToken') ||
            window.authToken ||
            ''
        );
    }
}

// 全局实例
let jsonImportManager;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        jsonImportManager = new JsonImportManager();
        window.jsonImportManager = jsonImportManager;
    }, 100);
});

// 暴露给 HTML 的全局函数
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

