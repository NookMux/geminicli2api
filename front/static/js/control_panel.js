// ===========================
// 控制面板 - 主要功能
// ===========================

let currentProjectId = '';
let authInProgress = false;
let authToken = '';
let credsData = {};

// 分页和筛选相关变量
let filteredCredsData = {};
let currentPage = 1;
let pageSize = 20;
let currentFilter = 'all';
let currentErrorCodeFilter = 'all';
let selectedCredFiles = new Set();
let availableErrorCodes = new Set();
let statsData = {
    total: 0,
    normal: 0,
    disabled: 0
};


// 使用统计相关变量
let usageStatsData = {};

// 配置管理相关变量
let currentConfig = {};
let envLockedFields = new Set();

// ===========================
// 通用函数
// ===========================

function showStatus(message, type = 'info') {
    const statusSection = document.getElementById('statusSection');
    if (statusSection) {
        statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
        statusSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

// ===========================
// 登录相关函数
// ===========================

async function login() {
    const password = document.getElementById('loginPassword').value;
    if (!password) {
        showStatus('请输入密码', 'error');
        return;
    }

    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.token;
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            showStatus('登录成功', 'success');
        } else {
            showStatus(`登录失败: ${data.detail || data.error || '密码错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

function handlePasswordEnter(event) {
    if (event.key === 'Enter') {
        login();
    }
}

// ===========================
// 标签页切换
// ===========================

function switchTab(event, tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.currentTarget.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');

    if (tabName === 'manage') {
        refreshCredsStatus();
    }
    if (tabName === 'usage') {
        refreshUsageStats();
    }
    if (tabName === 'config') {
        loadConfig();
    }
}

// ===========================
// OAuth 认证流程
// ===========================

async function startAuth() {
    const projectId = document.getElementById('projectId').value.trim();
    const getAllProjects = document.getElementById('getAllProjectsCreds').checked;
    currentProjectId = projectId || null;

    const btn = document.getElementById('getAuthBtn');
    btn.disabled = true;
    btn.textContent = '正在获取认证链接...';

    try {
        const requestBody = {};
        if (projectId) {
            requestBody.project_id = projectId;
        }
        if (getAllProjects) {
            requestBody.get_all_projects = true;
            showStatus('批量并发认证模式：将为当前账号所有项目生成认证链接...', 'info');
        } else if (projectId) {
            showStatus('使用指定的项目ID生成认证链接...', 'info');
        } else {
            showStatus('将尝试自动检测项目ID，正在生成认证链接...', 'info');
        }

        const response = await fetch('/auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('authUrl').href = data.auth_url;
            document.getElementById('authUrl').textContent = data.auth_url;
            document.getElementById('authUrlSection').classList.remove('hidden');

            if (getAllProjects) {
                showStatus('批量并发认证链接已生成，完成授权后将并发为所有可访问项目生成凭证文件', 'info');
            } else if (data.auto_project_detection) {
                showStatus('认证链接已生成（将在认证完成后自动检测项目ID），请点击链接完成授权', 'info');
            } else {
                showStatus(`认证链接已生成（项目ID: ${data.detected_project_id}），请点击链接完成授权`, 'info');
            }
            authInProgress = true;
        } else {
            showStatus(`错误: ${data.error || '获取认证链接失败'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '获取认证链接';
    }
}




// ===========================
// 回调URL处理
// ===========================

async function processCallbackUrl() {
    const callbackUrlInput = document.getElementById('callbackUrlInput');
    const callbackUrl = callbackUrlInput.value.trim();
    const getAllProjects = document.getElementById('getAllProjectsCreds').checked;

    if (!callbackUrl) {
        showStatus('请输入回调URL', 'error');
        return;
    }

    if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        showStatus('请输入有效的URL', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showStatus('❌ 这不是有效的回调URL！请确保URL包含code和state参数', 'error');
        return;
    }

    if (getAllProjects) {
        showStatus('正在从回调URL并发批量获取所有项目凭证...', 'info');
    } else {
        showStatus('正在从回调URL获取凭证...', 'info');
    }

    try {
        const projectIdInput = document.getElementById('projectId');
        const projectId = projectIdInput ? projectIdInput.value.trim() : null;

        const response = await fetch('/auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                callback_url: callbackUrl,
                project_id: projectId || null,
                get_all_projects: getAllProjects
            })
        });

        const result = await response.json();

        if (getAllProjects && result.multiple_credentials) {
            const results = result.multiple_credentials;
            let resultText = `批量并发认证完成！成功为 ${results.success.length} 个项目生成凭证：\n\n`;

            results.success.forEach((item, index) => {
                resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                resultText += `   文件: ${item.file_path}\n\n`;
            });

            if (results.failed.length > 0) {
                resultText += `\n失败的项目 (${results.failed.length} 个):\n`;
                results.failed.forEach((item, index) => {
                    resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                    resultText += `   错误: ${item.error}\n\n`;
                });
            }

            document.getElementById('credentialsContent').textContent = resultText;
            document.getElementById('credentialsSection').classList.remove('hidden');
            showStatus(`✅ 批量并发认证完成！成功生成 ${results.success.length} 个项目的凭证文件${results.failed.length > 0 ? `，${results.failed.length} 个项目失败` : ''}`, 'success');

        } else if (result.credentials) {
            showStatus(result.message || '从回调URL获取凭证成功！', 'success');
            document.getElementById('credentialsContent').innerHTML =
                '<pre>' + JSON.stringify(result.credentials, null, 2) + '</pre>';
            document.getElementById('credentialsSection').classList.remove('hidden');

        } else if (result.requires_manual_project_id) {
            showStatus('需要手动指定项目ID，请在高级选项中填入Google Cloud项目ID后重试', 'error');
        } else if (result.requires_project_selection) {
            let projectOptions = '<br><strong>可用项目：</strong><br>';
            result.available_projects.forEach(project => {
                projectOptions += `• ${project.name} (ID: ${project.projectId})<br>`;
            });
            showStatus('检测到多个项目，请在高级选项中指定项目ID：' + projectOptions, 'error');
        } else {
            showStatus(result.error || '从回调URL获取凭证失败', 'error');
        }

        callbackUrlInput.value = '';
    } catch (error) {
        console.error('从回调URL获取凭证时出错:', error);
        showStatus(`从回调URL获取凭证失败: ${error.message}`, 'error');
    }
}


// ===========================
// 凭证文件管理
// ===========================

async function refreshCredsStatus() {
    const credsLoading = document.getElementById('credsLoading');
    const credsList = document.getElementById('credsList');

    try {
        credsLoading.style.display = 'block';
        credsList.innerHTML = '';

        const response = await fetch('/creds/status', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            credsData = data.creds;
            calculateStats();
            updateStatsDisplay();
            currentPage = 1;
            applyFilters();
            showStatus(`已加载 ${Object.keys(credsData).length} 个凭证文件`, 'success');
        } else {
            showStatus(`加载失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        credsLoading.style.display = 'none';
    }
}

function calculateStats() {
    statsData = { total: 0, normal: 0, disabled: 0 };
    availableErrorCodes.clear();

    for (const [fullPath, credInfo] of Object.entries(credsData)) {
        statsData.total++;
        if (credInfo.status.disabled) {
            statsData.disabled++;
        } else {
            statsData.normal++;
        }

        if (credInfo.status.error_codes && credInfo.status.error_codes.length > 0) {
            credInfo.status.error_codes.forEach(code => {
                availableErrorCodes.add(code);
            });
        }
    }

    updateErrorCodeBadges();
}

function updateErrorCodeBadges() {
    const errorCodeBadges = document.getElementById('errorCodeBadges');
    errorCodeBadges.innerHTML = '';

    if (availableErrorCodes.size === 0) {
        errorCodeBadges.innerHTML = '<span style="color: #4CAF50;">所有文件都无错误</span>';
        return;
    }

    const sortedCodes = Array.from(availableErrorCodes).sort((a, b) => a - b);
    sortedCodes.forEach(code => {
        const badge = document.createElement('span');
        badge.className = 'error-code-badge';
        badge.textContent = code;
        badge.onclick = () => filterByErrorCode(code);
        errorCodeBadges.appendChild(badge);
    });
}

function filterByErrorCode(code) {
    document.getElementById('errorCodeFilter').value = code.toString();
    applyFilters();
}

function updateStatsDisplay() {
    document.getElementById('statTotal').textContent = statsData.total;
    document.getElementById('statNormal').textContent = statsData.normal;
    document.getElementById('statDisabled').textContent = statsData.disabled;
}

function applyFilters() {
    const statusFilter = document.getElementById('statusFilter').value;
    const errorCodeFilter = document.getElementById('errorCodeFilter').value;
    currentFilter = statusFilter;
    currentErrorCodeFilter = errorCodeFilter;
    filteredCredsData = {};

    for (const [fullPath, credInfo] of Object.entries(credsData)) {
        let shouldInclude = false;

        switch (statusFilter) {
            case 'all': shouldInclude = true; break;
            case 'normal': shouldInclude = !credInfo.status.disabled; break;
            case 'disabled': shouldInclude = credInfo.status.disabled; break;
        }

        if (!shouldInclude) continue;

        const errorCodes = credInfo.status.error_codes || [];
        switch (errorCodeFilter) {
            case 'all': break;
            case 'no-errors': shouldInclude = errorCodes.length === 0; break;
            case 'has-errors': shouldInclude = errorCodes.length > 0; break;
            default:
                const targetCode = parseInt(errorCodeFilter);
                if (!isNaN(targetCode)) {
                    shouldInclude = errorCodes.includes(targetCode);
                }
                break;
        }

        if (shouldInclude) {
            filteredCredsData[fullPath] = credInfo;
        }
    }

    selectedCredFiles.clear();
    updateBatchControls();
    currentPage = 1;
    renderCredsList();
    updatePagination();
}

function getCurrentPageData() {
    const filteredEntries = Object.entries(filteredCredsData);
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredEntries.slice(startIndex, endIndex);
}

function getTotalPages() {
    return Math.ceil(Object.keys(filteredCredsData).length / pageSize);
}

function renderCredsList() {
    const credsList = document.getElementById('credsList');
    credsList.innerHTML = '';

    const currentPageData = getCurrentPageData();

    if (currentPageData.length === 0) {
        const message = Object.keys(credsData).length === 0 ?
            '暂无凭证文件' : '当前筛选条件下暂无数据';
        credsList.innerHTML = `<p style="text-align: center; color: #666;">${message}</p>`;
        document.getElementById('paginationContainer').style.display = 'none';
        return;
    }

    for (const [fullPath, credInfo] of currentPageData) {
        const card = createCredCard(fullPath, credInfo);
        credsList.appendChild(card);
    }

    document.getElementById('paginationContainer').style.display = getTotalPages() > 1 ? 'flex' : 'none';
    updateBatchControls();
}

function updatePagination() {
    const totalPages = getTotalPages();
    const totalItems = Object.keys(filteredCredsData).length;
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    document.getElementById('paginationInfo').textContent =
        `第 ${currentPage} 页，共 ${totalPages} 页 (显示 ${startItem}-${endItem}，共 ${totalItems} 项)`;

    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

function changePage(direction) {
    const totalPages = getTotalPages();
    const newPage = currentPage + direction;

    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderCredsList();
        updatePagination();
    }
}

function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSizeSelect').value);
    currentPage = 1;
    renderCredsList();
    updatePagination();
}

function createCredCard(fullPath, credInfo) {
    const div = document.createElement('div');
    const status = credInfo.status;
    const filename = credInfo.filename;

    div.className = 'cred-card';

    let statusDotClass = 'status-dot';
    if (status.disabled) {
        statusDotClass += ' disabled';
    } else if (status.error_codes && status.error_codes.length > 0) {
        statusDotClass += ' error';
    }

    let actionButtons = '';
    if (status.disabled) {
        actionButtons += `<button class="cred-btn enable" data-filename="${filename}" data-action="enable">启用</button>`;
    } else {
        actionButtons += `<button class="cred-btn disable" data-filename="${filename}" data-action="disable">禁用</button>`;
    }

    actionButtons += `
                <button class="cred-btn email" onclick="fetchUserEmail('${filename}')">获取邮箱</button>
                <button class="cred-btn models" onclick="openModelPermissionModal('${filename}')">模型权限</button>
                <button class="cred-btn delete" data-filename="${filename}" data-action="delete">删除</button>
            `;

    let emailInfo = '';
    if (credInfo.user_email) {
        emailInfo = `<div class="cred-email">${credInfo.user_email}</div>`;
    } else {
        emailInfo = `<div class="cred-email">点击“获取邮箱”来刷新</div>`;
    }

    div.innerHTML = `
                <div class="cred-header">
                    <div class="cred-filename">
                        <span class="${statusDotClass}"></span>
                        <span>${filename}</span>
                    </div>
                    <input type="checkbox" class="file-checkbox" data-filename="${filename}" onchange="toggleFileSelection('${filename}')">
                </div>
                ${emailInfo}
                <div class="cred-actions">${actionButtons}</div>
            `;

    const actionButtonElements = div.querySelectorAll('[data-filename][data-action]');
    actionButtonElements.forEach(button => {
        button.addEventListener('click', function (e) {
            e.stopPropagation(); // Prevent card click event
            const filename = this.getAttribute('data-filename');
            const action = this.getAttribute('data-action');
            if (action === 'delete') {
                deleteCred(filename);
            } else {
                credAction(filename, action);
            }
        });
    });

    // Add event listener for checkbox as well to stop propagation
    const checkbox = div.querySelector('.file-checkbox');
    checkbox.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    return div;
}

async function credAction(filename, action) {
    try {
        const response = await fetch('/creds/action', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ filename: filename, action: action })
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(data.message, 'success');
            await refreshCredsStatus();
        } else {
            showStatus(`操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}


async function deleteCred(filename) {
    if (!confirm(`确定要删除凭证文件吗？\n${filename}`)) {
        return;
    }
    await credAction(filename, 'delete');
}

// ===========================
// 批量操作
// ===========================

function toggleFileSelection(filename) {
    if (selectedCredFiles.has(filename)) {
        selectedCredFiles.delete(filename);
    } else {
        selectedCredFiles.add(filename);
    }
    updateBatchControls();
}

function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const fileCheckboxes = document.querySelectorAll('.file-checkbox');

    if (selectAllCheckbox.checked) {
        fileCheckboxes.forEach(checkbox => {
            const filename = checkbox.getAttribute('data-filename');
            selectedCredFiles.add(filename);
            checkbox.checked = true;
        });
    } else {
        selectedCredFiles.clear();
        fileCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
    }
    updateBatchControls();
}

function updateBatchControls() {
    const selectedCount = selectedCredFiles.size;
    const selectedCountElement = document.getElementById('selectedCount');
    const batchEnableBtn = document.getElementById('batchEnableBtn');
    const batchDisableBtn = document.getElementById('batchDisableBtn');
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    selectedCountElement.textContent = `已选择 ${selectedCount} 项`;

    const hasSelection = selectedCount > 0;
    batchEnableBtn.disabled = !hasSelection;
    batchDisableBtn.disabled = !hasSelection;
    batchDeleteBtn.disabled = !hasSelection;

    const currentPageFileCount = document.querySelectorAll('.file-checkbox').length;
    const currentPageSelectedCount = Array.from(document.querySelectorAll('.file-checkbox'))
        .filter(checkbox => selectedCredFiles.has(checkbox.getAttribute('data-filename'))).length;

    if (currentPageSelectedCount === 0) {
        selectAllCheckbox.indeterminate = false;
        selectAllCheckbox.checked = false;
    } else if (currentPageSelectedCount === currentPageFileCount) {
        selectAllCheckbox.indeterminate = false;
        selectAllCheckbox.checked = true;
    } else {
        selectAllCheckbox.indeterminate = true;
        selectAllCheckbox.checked = false;
    }

    document.querySelectorAll('.file-checkbox').forEach(checkbox => {
        const filename = checkbox.getAttribute('data-filename');
        checkbox.checked = selectedCredFiles.has(filename);
    });
}

async function batchAction(action) {
    const selectedFiles = Array.from(selectedCredFiles);

    if (selectedFiles.length === 0) {
        showStatus('请先选择要操作的文件', 'error');
        return;
    }

    let confirmMessage = '';
    switch (action) {
        case 'enable': confirmMessage = `确定要启用选中的 ${selectedFiles.length} 个文件吗？`; break;
        case 'disable': confirmMessage = `确定要禁用选中的 ${selectedFiles.length} 个文件吗？`; break;
        case 'delete': confirmMessage = `确定要删除选中的 ${selectedFiles.length} 个文件吗？\n注意：此操作不可恢复！`; break;
    }

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        showStatus(`正在执行批量${action === 'enable' ? '启用' : action === 'disable' ? '禁用' : '删除'}操作...`, 'info');

        const response = await fetch('/creds/batch-action', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: action, filenames: selectedFiles })
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(`批量操作完成：成功处理 ${data.success_count}/${selectedFiles.length} 个文件`, 'success');
            selectedCredFiles.clear();
            updateBatchControls();
            await refreshCredsStatus();
        } else {
            showStatus(`批量操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`批量操作网络错误: ${error.message}`, 'error');
    }
}

// ===========================
// 邮箱相关
// ===========================

async function fetchUserEmail(filename) {
    try {
        showStatus('正在获取用户邮箱...', 'info');

        const response = await fetch(`/creds/fetch-email/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok && data.user_email) {
            showStatus(`成功获取邮箱: ${data.user_email}`, 'success');
            await refreshCredsStatus();
        } else {
            showStatus(data.message || '无法获取用户邮箱', 'error');
        }
    } catch (error) {
        showStatus(`获取邮箱失败: ${error.message}`, 'error');
    }
}

async function refreshAllEmails() {
    try {
        if (!confirm('确定要刷新所有凭证的用户邮箱吗？这可能需要一些时间。')) {
            return;
        }

        showStatus('正在刷新所有用户邮箱...', 'info');

        const response = await fetch('/creds/refresh-all-emails', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(`邮箱刷新完成：成功获取 ${data.success_count}/${data.total_count} 个邮箱地址`, 'success');
            await refreshCredsStatus();
        } else {
            showStatus(data.message || '邮箱刷新失败', 'error');
        }
    } catch (error) {
        showStatus(`邮箱刷新网络错误: ${error.message}`, 'error');
    }
}


// ===========================
// 使用统计
// ===========================

async function refreshUsageStats() {
    const usageLoading = document.getElementById('usageLoading');
    const usageList = document.getElementById('usageList');

    try {
        usageLoading.style.display = 'block';
        usageList.innerHTML = '';

        const [statsResponse, aggregatedResponse] = await Promise.all([
            fetch('/usage/stats', { method: 'GET', headers: getAuthHeaders() }),
            fetch('/usage/aggregated', { method: 'GET', headers: getAuthHeaders() })
        ]);

        const statsData = await statsResponse.json();
        const aggregatedData = await aggregatedResponse.json();

        if (statsResponse.ok && aggregatedResponse.ok) {
            usageStatsData = statsData.data;

            document.getElementById('totalApiCalls').textContent = aggregatedData.data.total_all_model_calls || 0;
            document.getElementById('geminiProCalls').textContent = aggregatedData.data.total_pro_model_calls || 0;
            document.getElementById('totalFiles').textContent = aggregatedData.data.total_files || 0;

            renderUsageList();
            showStatus(`已加载 ${aggregatedData.data.total_files} 个文件的使用统计`, 'success');
        } else {
            showStatus('加载使用统计失败', 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    } finally {
        usageLoading.style.display = 'none';
    }
}

function renderUsageList() {
    const usageList = document.getElementById('usageList');
    usageList.innerHTML = '';

    if (Object.keys(usageStatsData).length === 0) {
        usageList.innerHTML = '<p style="text-align: center; color: #666;">暂无使用统计数据</p>';
        return;
    }

    for (const [filename, stats] of Object.entries(usageStatsData)) {
        const card = createUsageCard(filename, stats);
        usageList.appendChild(card);
    }
}

function createUsageCard(filename, stats) {
    const div = document.createElement('div');
    div.className = 'usage-card';

    const geminiPercent = Math.min((stats.pro_model_calls || 0) / (stats.daily_limit_pro_models || 75) * 100, 100);
    const totalPercent = Math.min((stats.total_calls || 0) / (stats.daily_limit_total || 600) * 100, 100);

    function getProgressClass(percent) {
        if (percent >= 90) return 'danger';
        if (percent >= 70) return 'warning';
        return 'gemini';
    }

    function getTotalProgressClass(percent) {
        if (percent >= 90) return 'danger';
        if (percent >= 70) return 'warning';
        return 'total';
    }

    function formatTime(isoString) {
        if (!isoString) return '未知';
        try {
            const date = new Date(isoString);
            return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        } catch (e) {
            return '格式错误';
        }
    }

    div.innerHTML = `
        <div class="usage-header">
            <div class="usage-filename">${filename}</div>
        </div>

        <div class="usage-progress">
            <div class="usage-progress-label">
                <span>Pro Models</span>
                <span>${stats.pro_model_calls || 0}/${stats.daily_limit_pro_models || 75} (${geminiPercent.toFixed(1)}%)</span>
            </div>
            <div class="usage-progress-bar">
                <div class="usage-progress-fill ${getProgressClass(geminiPercent)}" style="width: ${geminiPercent}%"></div>
            </div>
        </div>

        <div class="usage-progress">
            <div class="usage-progress-label">
                <span>所有模型</span>
                <span>${stats.total_calls || 0}/${stats.daily_limit_total || 600} (${totalPercent.toFixed(1)}%)</span>
            </div>
            <div class="usage-progress-bar">
                <div class="usage-progress-fill ${getTotalProgressClass(totalPercent)}" style="width: ${totalPercent}%"></div>
            </div>
        </div>

        <div class="usage-info">
            <div class="usage-info-item" style="grid-column: 1 / -1;">
                <span class="usage-info-label">下次重置时间</span>
                <span class="usage-info-value">${formatTime(stats.next_reset_time)}</span>
            </div>
        </div>

        <div class="usage-actions">
            <button class="usage-btn reset" onclick="resetSingleUsageStats('${filename}')">重置统计</button>
        </div>
    `;

    return div;
}


async function resetSingleUsageStats(filename) {
    if (!confirm(`确定要重置 ${filename} 的使用统计吗？`)) {
        return;
    }

    try {
        const response = await fetch('/usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ filename: filename })
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`重置失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

async function resetAllUsageStats() {
    if (!confirm('确定要重置所有文件的使用统计吗？此操作不可恢复！')) {
        return;
    }

    try {
        const response = await fetch('/usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`重置失败: ${data.detail || data.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

// ===========================
// 模型权限管理
// ===========================

let currentCredentialName = '';
let allSupportedModels = [];

async function openModelPermissionModal(filename) {
    try {
        currentCredentialName = filename;

        // 获取支持的模型列表
        await loadSupportedModels();

        // 获取当前凭证的权限设置
        const response = await fetch(`/creds/status`, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            showStatus('获取凭证状态失败', 'error');
            return;
        }

        const data = await response.json();
        const credInfo = data.creds.find(cred => cred.filename === filename);

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
    const selectedType = document.querySelector('input[name="permissionType"]:checked').value;
    const customSelection = document.getElementById('customModelSelection');

    if (selectedType === 'custom') {
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
            await refreshCredsStatus();
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

// ===========================
// 配置管理
// ===========================

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

function populateConfigForm() {
    setConfigField('configApiPassword', currentConfig.api_password || '');
    setConfigField('configPanelPassword', currentConfig.panel_password || '');
    setConfigField('configDailyLimitProModels', currentConfig.daily_limit_pro_models || '');
    setConfigField('configDailyLimitTotal', currentConfig.daily_limit_total || '');
}

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

async function saveConfig() {
    try {
        const config = {
            ...currentConfig, // Preserve existing settings
            api_password: document.getElementById('configApiPassword').value.trim(),
            panel_password: document.getElementById('configPanelPassword').value.trim(),
            daily_limit_pro_models: parseInt(document.getElementById('configDailyLimitProModels').value) || 75,
            daily_limit_total: parseInt(document.getElementById('configDailyLimitTotal').value) || 600,
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

// ===========================
// 页面初始化
// ===========================

window.onload = function () {
    showStatus('请输入密码登录', 'info');
};
