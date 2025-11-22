// ===========================
// 配置管理功能
// ===========================

// 配置管理相关变量
let currentConfig = {};
let envLockedFields = new Set();

// ===========================
// 配置管理主功能
// ===========================

/**
 * 加载配置
 */
async function loadConfig() {
    const configLoading = document.getElementById('configLoading');
    const configForm = document.getElementById('configForm');

    try {
        configLoading.style.display = 'block';
        configForm.classList.add('hidden');

        const response = await fetch('/config/get', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            currentConfig = data.config;
            envLockedFields = new Set(data.env_locked || []);
            populateConfigForm();
            configForm.classList.remove('hidden');
            showStatus('配置加载成功', 'success');
        } else {
            showStatus(`加载配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        configLoading.style.display = 'none';
    }
}

/**
 * 填充配置表单
 */
function populateConfigForm() {
    setConfigField('configApiPassword', currentConfig.api_password || '');
    setConfigField('configPanelPassword', currentConfig.panel_password || '');
}

/**
 * 设置配置字段
 * @param {string} fieldId - 字段ID
 * @param {string} value - 字段值
 */
function setConfigField(fieldId, value) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.value = value;

        const configKey = fieldId.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (envLockedFields.has(configKey)) {
            field.disabled = true;
            field.classList.add('env-locked');
        } else {
            field.disabled = false;
            field.classList.remove('env-locked');
        }
    }
}

/**
 * 保存配置
 */
async function saveConfig() {
    try {
        const config = {
            ...currentConfig, // Preserve existing settings
            api_password: document.getElementById('configApiPassword').value.trim(),
            panel_password: document.getElementById('configPanelPassword').value.trim(),
        };

        const response = await fetch('/config/save', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ config: config })
        });

        const data = await response.json();

        if (response.ok) {
            let message = '配置保存成功';

            if (data.hot_updated && data.hot_updated.length > 0) {
                message += `，以下配置已立即生效: ${data.hot_updated.join(', ')}`;
            }

            if (data.restart_required && data.restart_required.length > 0) {
                message += `\n⚠️ 重启提醒: ${data.restart_notice}`;
                showStatus(message, 'info');
            } else {
                showStatus(message, 'success');
            }

            setTimeout(() => loadConfig(), 1000);
        } else {
            showStatus(`保存配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

/**
 * 初始化配置标签页
 */
function initConfigTab() {
    loadConfig();
}