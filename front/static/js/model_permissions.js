// ===========================
// 模型权限管理
// ===========================

let currentCredentialName = '';
let allSupportedModels = [];

// 设置认证token
function setAuthToken(token) {
    authToken = token;
}

async function openModelPermissionModal(filename) {
    try {
        currentCredentialName = filename;

        // 获取支持的模型列表
        await loadSupportedModels();

        // 直接从全局 credsData 中获取当前凭证信息，避免重复请求
        const allCreds = (typeof credsData === 'object' && credsData) ? credsData : {};
        const credInfo = Object.values(allCreds).find(cred => cred.filename === filename);

        if (!credInfo) {
            showStatus('未找到凭证信息', 'error');
            return;
        }

        // 设置凭证名称
        document.getElementById('modalCredentialName').value = filename;

        // 清空之前的选项
        document.querySelectorAll('input[name="permissionType"]').forEach(radio => {
            radio.checked = false;
        });

        const allowedModels = credInfo.status?.allowed_base_models;

        // 设置权限类型
        if (!allowedModels || allowedModels === null) {
            document.querySelector('input[name="permissionType"][value="all"]').checked = true;
        } else if (allowedModels.length === 0) {
            document.querySelector('input[name="permissionType"][value="none"]').checked = true;
        } else {
            document.querySelector('input[name="permissionType"][value="custom"]').checked = true;
        }

        // 生成模型复选框
        generateModelCheckboxes(allowedModels || []);

        // 显示弹窗
        document.getElementById('modelPermissionModal').style.display = 'block';

    } catch (error) {
        console.error('打开模型权限设置弹窗时出错:', error);
        showStatus(`打开权限设置失败: ${error.message}`, 'error');
    }
}

async function loadSupportedModels() {
    try {
        const response = await fetch('/config/supported-models', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            // 如果没有这个接口，使用默认模型列表
            allSupportedModels = [
                'gemini-2.5-pro',
                'gemini-2.5-flash',
                'gemini-3-pro-preview',
                'gemini-2.5-flash-image',
                'gemini-2.5-flash-image-preview'
            ];
            return;
        }

        const data = await response.json();
        allSupportedModels = data.models || [];
    } catch (error) {
        // 使用默认模型列表
        allSupportedModels = [
            'gemini-2.5-pro',
            'gemini-2.5-flash',
            'gemini-3-pro-preview',
            'gemini-2.5-flash-image',
            'gemini-2.5-flash-image-preview'
        ];
    }
}

function generateModelCheckboxes(allowedModels) {
    const container = document.getElementById('modelCheckboxes');
    container.innerHTML = '';

    allSupportedModels.forEach(model => {
        const isChecked = allowedModels.includes(model);
        const div = document.createElement('div');
        div.className = 'model-item';
        div.innerHTML = `
            <input type="checkbox" id="model_${model}" value="${model}" ${isChecked ? 'checked' : ''}>
            <label for="model_${model}">${model}</label>
        `;
        container.appendChild(div);
    });
}

function handlePermissionTypeChange() {
    const selectedType = document.querySelector('input[name="permissionType"]:checked');
    if (!selectedType) return;

    const selectedValue = selectedType.value;
    const customSelection = document.getElementById('customModelSelection');

    if (selectedValue === 'custom') {
        customSelection.style.display = 'block';
    } else {
        customSelection.style.display = 'none';
    }
}

function closeModelPermissionModal() {
    document.getElementById('modelPermissionModal').style.display = 'none';
    currentCredentialName = '';
}

async function saveModelPermissions() {
    try {
        const selectedType = document.querySelector('input[name="permissionType"]:checked').value;
        let allowedBaseModels = null;

        if (selectedType === 'none') {
            allowedBaseModels = [];
        } else if (selectedType === 'custom') {
            const selectedCheckboxes = document.querySelectorAll('#modelCheckboxes input[type="checkbox"]:checked');
            allowedBaseModels = Array.from(selectedCheckboxes).map(cb => cb.value);
        }
        // selectedType === 'all' 时保持 null

        const response = await fetch('/creds/update-models', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                filename: currentCredentialName,
                allowed_base_models: allowedBaseModels
            })
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(`凭证 ${currentCredentialName} 的模型权限已更新`, 'success');
            closeModelPermissionModal();
            // 刷新凭证状态
            if (typeof refreshCredsStatus === 'function') {
                await refreshCredsStatus();
            }
        } else {
            showStatus(`更新权限失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }

    } catch (error) {
        console.error('保存模型权限时出错:', error);
        showStatus(`保存权限失败: ${error.message}`, 'error');
    }
}

// 点击弹窗外部关闭
window.onclick = function(event) {
    const modal = document.getElementById('modelPermissionModal');
    if (event.target === modal) {
        closeModelPermissionModal();
    }
}

// 初始化：设置权限类型切换事件监听
document.addEventListener('DOMContentLoaded', function() {
    const permissionTypeRadios = document.querySelectorAll('input[name="permissionType"]');
    permissionTypeRadios.forEach(radio => {
        radio.addEventListener('change', handlePermissionTypeChange);
    });

    // 初始时隐藏自定义选择区域
    handlePermissionTypeChange();
});
