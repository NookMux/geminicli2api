// ===========================
// 凭证管理功能
// ===========================

// 凭证数据和相关变量
let credsData = {};
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

// ===========================
// 凭证文件管理
// ===========================

/**
 * 刷新凭证状态
 */
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

/**
 * 计算统计数据
 */
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

/**
 * 更新错误码徽章
 */
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

/**
 * 按错误码筛选
 * @param {number} code - 错误码
 */
function filterByErrorCode(code) {
    document.getElementById('errorCodeFilter').value = code.toString();
    applyFilters();
}

/**
 * 更新统计显示
 */
function updateStatsDisplay() {
    document.getElementById('statTotal').textContent = statsData.total;
    document.getElementById('statNormal').textContent = statsData.normal;
    document.getElementById('statDisabled').textContent = statsData.disabled;
}

/**
 * 应用筛选条件
 */
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

/**
 * 获取当前页数据
 * @returns {Array} 当前页的凭证数据
 */
function getCurrentPageData() {
    const filteredEntries = Object.entries(filteredCredsData);
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredEntries.slice(startIndex, endIndex);
}

/**
 * 获取总页数
 * @returns {number} 总页数
 */
function getTotalPages() {
    return Math.ceil(Object.keys(filteredCredsData).length / pageSize);
}

/**
 * 渲染凭证列表
 */
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

/**
 * 更新分页控件
 */
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

/**
 * 切换页面
 * @param {number} direction - 方向（-1为上一页，1为下一页）
 */
function changePage(direction) {
    const totalPages = getTotalPages();
    const newPage = currentPage + direction;

    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderCredsList();
        updatePagination();
    }
}

/**
 * 更改页面大小
 */
function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSizeSelect').value);
    currentPage = 1;
    renderCredsList();
    updatePagination();
}

/**
 * 创建凭证卡片
 * @param {string} fullPath - 完整路径
 * @param {Object} credInfo - 凭证信息
 * @returns {HTMLElement} 凭证卡片元素
 */
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
                <button class="cred-btn delete" data-filename="${filename}" data-action="delete">删除</button>
            `;

    let emailInfo = '';
    if (credInfo.user_email) {
        emailInfo = `<div class="cred-email">${credInfo.user_email}</div>`;
    } else {
        emailInfo = `<div class="cred-email">点击"获取邮箱"来刷新</div>`;
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

/**
 * 执行凭证操作
 * @param {string} filename - 文件名
 * @param {string} action - 操作类型
 */
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

/**
 * 删除凭证文件
 * @param {string} filename - 文件名
 */
async function deleteCred(filename) {
    if (!confirm(`确定要删除凭证文件吗？\n${filename}`)) {
        return;
    }
    await credAction(filename, 'delete');
}

// ===========================
// 批量操作
// ===========================

/**
 * 切换文件选择
 * @param {string} filename - 文件名
 */
function toggleFileSelection(filename) {
    if (selectedCredFiles.has(filename)) {
        selectedCredFiles.delete(filename);
    } else {
        selectedCredFiles.add(filename);
    }
    updateBatchControls();
}

/**
 * 切换全选
 */
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

/**
 * 更新批量控件状态
 */
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

/**
 * 执行批量操作
 * @param {string} action - 操作类型
 */
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
// 邮箱相关功能
// ===========================

/**
 * 获取用户邮箱
 * @param {string} filename - 文件名
 */
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

/**
 * 刷新所有邮箱
 */
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

/**
 * 初始化管理标签页
 */
function initManageTab() {
    refreshCredsStatus();
}