// ===========================
// 配置管理功能 (jQuery重构版)
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
    const $configLoading = $('#configLoading');
    const $configForm = $('#configForm');

    try {
        $configLoading.show();
        $configForm.addClass('hidden');

        const response = await fetch('/config/get', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            currentConfig = data.config;
            envLockedFields = new Set(data.env_locked || []);
            populateConfigForm();
            $configForm.removeClass('hidden');
            showStatus('配置加载成功', 'success');
        } else {
            showStatus(`加载配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        $configLoading.hide();
    }
}

/**
 * 填充配置表单
 */
function populateConfigForm() {
    setConfigField('configApiPassword', currentConfig.api_password || '');
    setConfigField('configPanelPassword', currentConfig.panel_password || '');
    setConfigField('configDailyLimitProModels', currentConfig.daily_limit_pro_models || '');
    setConfigField('configDailyLimitTotal', currentConfig.daily_limit_total || '');
}

/**
 * 设置配置字段
 * @param {string} fieldId - 字段ID
 * @param {string} value - 字段值
 */
function setConfigField(fieldId, value) {
    const $field = $(`#${fieldId}`);
    if ($field.length) {
        $field.val(value);

        const configKey = fieldId.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (envLockedFields.has(configKey)) {
            $field.prop('disabled', true).addClass('env-locked');
        } else {
            $field.prop('disabled', false).removeClass('env-locked');
        }
    }
}

/**
 * 保存配置
 */
async function saveConfig() {
    try {
        const config = {
            ...currentConfig,
            api_password: $('#configApiPassword').val().trim(),
            panel_password: $('#configPanelPassword').val().trim(),
            daily_limit_pro_models: parseInt($('#configDailyLimitProModels').val()) || 75,
            daily_limit_total: parseInt($('#configDailyLimitTotal').val()) || 600,
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