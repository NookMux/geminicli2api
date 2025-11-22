// ===========================
// 凭证管理功能 (jQuery重构版)
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
    const $credsLoading = $('#credsLoading');
    const $credsList = $('#credsList');

    try {
        $credsLoading.show();
        $credsList.empty();

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
        $credsLoading.hide();
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
    const $errorCodeBadges = $('#errorCodeBadges');
    $errorCodeBadges.empty();

    if (availableErrorCodes.size === 0) {
        $errorCodeBadges.html('<span style="color: #4CAF50;">所有文件都无错误</span>');
        return;
    }

    const sortedCodes = Array.from(availableErrorCodes).sort((a, b) => a - b);
    sortedCodes.forEach(code => {
        const $badge = $('<span>')
            .addClass('error-code-badge')
            .text(code)
            .click(() => filterByErrorCode(code));
        $errorCodeBadges.append($badge);
    });
}

/**
 * 按错误码筛选
 * @param {number} code - 错误码
 */
function filterByErrorCode(code) {
    $('#errorCodeFilter').val(code.toString());
    applyFilters();
}

/**
 * 更新统计显示
 */
function updateStatsDisplay() {
    $('#statTotal').text(statsData.total);
    $('#statNormal').text(statsData.normal);
    $('#statDisabled').text(statsData.disabled);
}

/**
 * 应用筛选条件
 */
function applyFilters() {
    const statusFilter = $('#statusFilter').val();
    const errorCodeFilter = $('#errorCodeFilter').val();
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
    const $credsList = $('#credsList');
    $credsList.empty();

    const currentPageData = getCurrentPageData();

    if (currentPageData.length === 0) {
        const message = Object.keys(credsData).length === 0 ?
            '暂无凭证文件' : '当前筛选条件下暂无数据';
        $credsList.html(`<p style="text-align: center; color: #666;">${message}</p>`);
        $('#paginationContainer').hide();
        return;
    }

    for (const [fullPath, credInfo] of currentPageData) {
        const $card = createCredCard(fullPath, credInfo);
        $credsList.append($card);
    }

    $('#paginationContainer').toggle(getTotalPages() > 1);
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

    $('#paginationInfo').text(
        `第 ${currentPage} 页，共 ${totalPages} 页 (显示 ${startItem}-${endItem}，共 ${totalItems} 项)`
    );

    $('#prevPageBtn').prop('disabled', currentPage <= 1);
    $('#nextPageBtn').prop('disabled', currentPage >= totalPages);
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
    pageSize = parseInt($('#pageSizeSelect').val());
    currentPage = 1;
    renderCredsList();
    updatePagination();
}

/**
 * 创建凭证卡片
 * @param {string} fullPath - 完整路径
 * @param {Object} credInfo - 凭证信息
 * @returns {jQuery} 凭证卡片元素
 */
function createCredCard(fullPath, credInfo) {
    const status = credInfo.status;
    const filename = credInfo.filename;

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

    const $div = $('<div>').addClass('cred-card').html(`
        <div class="cred-header">
            <div class="cred-filename">
                <span class="${statusDotClass}"></span>
                <span>${filename}</span>
            </div>
            <input type="checkbox" class="file-checkbox" data-filename="${filename}" onchange="toggleFileSelection('${filename}')">
        </div>
        ${emailInfo}
        <div class="cred-actions">${actionButtons}</div>
    `);

    $div.find('[data-filename][data-action]').on('click', function(e) {
        e.stopPropagation();
        const filename = $(this).data('filename');
        const action = $(this).data('action');
        if (action === 'delete') {
            deleteCred(filename);
        } else {
            credAction(filename, action);
        }
    });

    $div.find('.file-checkbox').on('click', function(e) {
        e.stopPropagation();
    });

    return $div;
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
    const $selectAllCheckbox = $('#selectAllCheckbox');
    const $fileCheckboxes = $('.file-checkbox');

    if ($selectAllCheckbox.prop('checked')) {
        $fileCheckboxes.each(function() {
            const filename = $(this).data('filename');
            selectedCredFiles.add(filename);
            $(this).prop('checked', true);
        });
    } else {
        selectedCredFiles.clear();
        $fileCheckboxes.prop('checked', false);
    }
    updateBatchControls();
}

/**
 * 更新批量控件状态
 */
function updateBatchControls() {
    const selectedCount = selectedCredFiles.size;
    const $selectedCountElement = $('#selectedCount');
    const $batchEnableBtn = $('#batchEnableBtn');
    const $batchDisableBtn = $('#batchDisableBtn');
    const $batchDeleteBtn = $('#batchDeleteBtn');
    const $selectAllCheckbox = $('#selectAllCheckbox');

    $selectedCountElement.text(`已选择 ${selectedCount} 项`);

    const hasSelection = selectedCount > 0;
    $batchEnableBtn.prop('disabled', !hasSelection);
    $batchDisableBtn.prop('disabled', !hasSelection);
    $batchDeleteBtn.prop('disabled', !hasSelection);

    const currentPageFileCount = $('.file-checkbox').length;
    const currentPageSelectedCount = $('.file-checkbox')
        .filter(function() {
            return selectedCredFiles.has($(this).data('filename'));
        }).length;

    if (currentPageSelectedCount === 0) {
        $selectAllCheckbox.prop('indeterminate', false).prop('checked', false);
    } else if (currentPageSelectedCount === currentPageFileCount) {
        $selectAllCheckbox.prop('indeterminate', false).prop('checked', true);
    } else {
        $selectAllCheckbox.prop('indeterminate', true).prop('checked', false);
    }

    $('.file-checkbox').each(function() {
        const filename = $(this).data('filename');
        $(this).prop('checked', selectedCredFiles.has(filename));
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