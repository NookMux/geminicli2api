// 调用日志模块 JavaScript

// 全局变量
let apiLogData = [];
let filteredApiLogData = [];
let apiLogCurrentPage = 1;
let apiLogPageSize = 50;
let sortField = 'timestamp';
let sortDirection = 'desc';
let charts = {};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    // 检查是否在调用日志标签页
    if (document.getElementById('apilogTab') && typeof authToken !== 'undefined' && authToken) {
        refreshApiLog();
    }
});

// 刷新调用日志数据
async function refreshApiLog() {
    try {
        showLoading('apiLogLoading');

        const response = await fetch('/usage/api-log?limit=1000', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const result = await response.json();

        if (response.status === 401) {
            throw new Error('未登录或登录已过期，请先在上方输入密码登录后再查看调用日志');
        }

        if (!response.ok || !result.success) {
            throw new Error(result.detail || `加载调用日志失败（HTTP ${response.status}）`);
        }

        apiLogData = result.data || [];
        filteredApiLogData = [...apiLogData];

        updateFilters();
        updateStats();
        renderTable();
        initCharts();

        // 如果之前有错误提示，这里移除
        const section = document.getElementById('apiLogSection');
        if (section) {
            const errorState = section.querySelector('.error-state');
            if (errorState) {
                errorState.remove();
            }
        }

        hideLoading('apiLogLoading');
        const tableContainer = document.getElementById('apiLogTableContainer');
        if (tableContainer) {
            tableContainer.classList.remove('hidden');
        }

    } catch (error) {
        console.error('刷新调用日志失败:', error);
        hideLoading('apiLogLoading');
        showError('apiLogSection', error.message);
    }
}

// 更新筛选器选项
function updateFilters() {
    const credentials = [...new Set(apiLogData.map(item => item.credential))].sort();
    const models = [...new Set(apiLogData.map(item => item.model))].sort();

    const credentialFilter = document.getElementById('credentialFilter');
    const modelFilter = document.getElementById('modelFilter');

    // 保存当前选择
    const currentCredential = credentialFilter.value;
    const currentModel = modelFilter.value;

    // 清空选项
    credentialFilter.innerHTML = '<option value="all">全部凭证</option>';
    modelFilter.innerHTML = '<option value="all">全部模型</option>';

    // 添加选项
    credentials.forEach(cred => {
        const option = document.createElement('option');
        option.value = cred;
        option.textContent = cred;
        credentialFilter.appendChild(option);
    });

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelFilter.appendChild(option);
    });

    // 恢复选择
    credentialFilter.value = currentCredential;
    modelFilter.value = currentModel;
}

// 更新统计信息
function updateStats() {
    const totalEntries = filteredApiLogData.length;
    document.getElementById('totalLogEntries').textContent = totalEntries.toLocaleString();
}

// 应用筛选
function applyLogFilters() {
    const credentialFilter = document.getElementById('credentialFilter').value;
    const modelFilter = document.getElementById('modelFilter').value;

    filteredApiLogData = apiLogData.filter(item => {
        const credentialMatch = credentialFilter === 'all' || item.credential === credentialFilter;
        const modelMatch = modelFilter === 'all' || item.model === modelFilter;
        return credentialMatch && modelMatch;
    });

    apiLogCurrentPage = 1;
    updateStats();
    renderTable();
    updateCharts();
}

// 渲染表格
function renderTable() {
    const tbody = document.getElementById('apiLogTableBody');
    tbody.innerHTML = '';

    if (filteredApiLogData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <h3>暂无调用记录</h3>
                    <p>还没有API调用记录，或者筛选条件过于严格</p>
                </td>
            </tr>
        `;
        updatePagination();
        return;
    }

    // 计算分页
    const startIndex = (apiLogCurrentPage - 1) * apiLogPageSize;
    const endIndex = startIndex + apiLogPageSize;
    const pageData = filteredApiLogData.slice(startIndex, endIndex);

    // 渲染每一行
    pageData.forEach((item, index) => {
        const row = document.createElement('tr');
        row.style.animationDelay = `${index * 0.05}s`;

        row.innerHTML = `
            <td>
                <span class="timestamp" title="${item.timestamp}">
                    ${item.timestamp || ''}
                </span>
            </td>
            <td>
                <span class="credential tooltip" data-tooltip="${item.credential}">
                    ${truncateText(item.credential, 25)}
                </span>
            </td>
            <td>
                <span class="model">${item.model}</span>
            </td>
        `;

        tbody.appendChild(row);
    });

    updatePagination();
}

// 更新分页信息
function updatePagination() {
    const totalPages = Math.ceil(filteredApiLogData.length / apiLogPageSize);
    const paginationInfo = document.getElementById('logPaginationInfo');
    const prevBtn = document.getElementById('logPrevPageBtn');
    const nextBtn = document.getElementById('logNextPageBtn');

    paginationInfo.textContent = `第 ${apiLogCurrentPage} 页，共 ${totalPages} 页 (${filteredApiLogData.length} 条记录)`;

    prevBtn.disabled = apiLogCurrentPage === 1;
    nextBtn.disabled = apiLogCurrentPage >= totalPages;
}

// 翻页
function changeLogPage(direction) {
    const totalPages = Math.ceil(filteredApiLogData.length / apiLogPageSize);
    const newPage = apiLogCurrentPage + direction;

    if (newPage >= 1 && newPage <= totalPages) {
        apiLogCurrentPage = newPage;
        renderTable();
    }
}

// 改变页面大小
function changeLogPageSize() {
    const select = document.getElementById('logPageSizeSelect');
    apiLogPageSize = parseInt(select.value);
    apiLogCurrentPage = 1;
    renderTable();
}

// 表格排序
function sortLogTable(field) {
    if (sortField === field) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortField = field;
        sortDirection = 'asc';
    }

    // 更新排序图标
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.className = 'fas fa-sort sort-icon';
    });

    const currentIcon = document.getElementById(`${field}-sort`);
    if (currentIcon) {
        currentIcon.className = `fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'} sort-icon`;
    }

    // 执行排序
    filteredApiLogData.sort((a, b) => {
        let aVal = a[field];
        let bVal = b[field];

        // 处理数字字段
        if (field.includes('tokens')) {
            aVal = aVal || 0;
            bVal = bVal || 0;
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }

        // 处理字符串字段
        aVal = (aVal || '').toString().toLowerCase();
        bVal = (bVal || '').toString().toLowerCase();

        if (sortDirection === 'asc') {
            return aVal.localeCompare(bVal);
        } else {
            return bVal.localeCompare(aVal);
        }
    });

    renderTable();
}

// 初始化图表（Token 统计已废弃，这里仅保持兼容，不再绘制图表）
function initCharts() {
    const chartsContainer = document.getElementById('apiLogChartsContainer');
    if (chartsContainer) {
        chartsContainer.classList.add('hidden');
    }
}

// 初始化Token使用趋势图表
function initTokenTrendChart() {
    const ctx = document.getElementById('tokenTrendChart').getContext('2d');

    // 销毁旧图表
    if (charts.tokenTrend) {
        charts.tokenTrend.destroy();
    }

    // 按日期聚合数据
    const dailyData = aggregateTokensByDate();

    charts.tokenTrend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dailyData.labels,
            datasets: [
                {
                    label: '输入Token',
                    data: dailyData.inputTokens,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4
                },
                {
                    label: '输出Token',
                    data: dailyData.outputTokens,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 初始化模型分布图表
function initModelDistributionChart() {
    const ctx = document.getElementById('modelDistributionChart').getContext('2d');

    // 销毁旧图表
    if (charts.modelDistribution) {
        charts.modelDistribution.destroy();
    }

    // 按模型聚合数据
    const modelData = aggregateByModel();

    charts.modelDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: modelData.labels,
            datasets: [{
                data: modelData.counts,
                backgroundColor: [
                    '#3b82f6',
                    '#8b5cf6',
                    '#ec4899',
                    '#f59e0b',
                    '#10b981',
                    '#6b7280'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                },
                title: {
                    display: false
                }
            }
        }
    });
}

// 初始化凭证使用统计图表
function initCredentialUsageChart() {
    const ctx = document.getElementById('credentialUsageChart').getContext('2d');

    // 销毁旧图表
    if (charts.credentialUsage) {
        charts.credentialUsage.destroy();
    }

    // 按凭证聚合数据
    const credentialData = aggregateByCredential();

    charts.credentialUsage = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: credentialData.labels,
            datasets: [{
                label: '总Token数',
                data: credentialData.tokens,
                backgroundColor: '#6366f1',
                borderColor: '#4f46e5',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }
        }
    });
}

// 更新图表（兼容旧调用，当前不再展示图表）
function updateCharts() {
    // no-op
}

// 导出CSV（仅导出时间/凭证/模型三列）
function exportApiLog() {
    if (filteredApiLogData.length === 0) {
        alert('没有可导出的数据');
        return;
    }

    let csv = 'timestamp,credential,model\\n';

    filteredApiLogData.forEach(item => {
        csv += `"${item.timestamp}","${item.credential}","${item.model}"\\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `api_log_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 工具函数
function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 7) {
        return timestamp;
    } else if (diffDays > 0) {
        return `${diffDays}天前`;
    } else if (diffHours > 0) {
        return `${diffHours}小时前`;
    } else {
        return '刚刚';
    }
}

function formatNumber(num) {
    if (num === 0) return '-';
    if (num < 1000) return num.toString();
    if (num < 1000000) return (num / 1000).toFixed(1) + 'K';
    return (num / 1000000).toFixed(1) + 'M';
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

function showLoading(loadingId) {
    const el = document.getElementById(loadingId);
    if (el) {
        el.classList.remove('hidden');
    }
}

function hideLoading(loadingId) {
    const el = document.getElementById(loadingId);
    if (el) {
        el.classList.add('hidden');
    }
}

function showError(containerId, message) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    // 隐藏表格和图表区域，避免展示旧数据
    const tableContainer = document.getElementById('apiLogTableContainer');
    if (tableContainer) {
        tableContainer.classList.add('hidden');
    }
    const chartsContainer = document.getElementById('apiLogChartsContainer');
    if (chartsContainer) {
        chartsContainer.classList.add('hidden');
    }

    let errorContainer = container.querySelector('.error-state');
    if (!errorContainer) {
        errorContainer = document.createElement('div');
        errorContainer.className = 'error-state';
        container.appendChild(errorContainer);
    }

    errorContainer.innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        <h3>加载失败</h3>
        <p>${message}</p>
        <button class="btn" onclick="refreshApiLog()">
            <i class="fas fa-sync-alt"></i> 重试
        </button>
    `;
}
