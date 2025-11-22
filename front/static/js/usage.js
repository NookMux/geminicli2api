// ===========================
// 使用统计功能
// ===========================

// 使用统计相关变量
let usageStatsData = {};

// ===========================
// 使用统计主功能
// ===========================

/**
 * 刷新使用统计
 */
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

/**
 * 渲染使用统计列表
 */
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

/**
 * 创建使用统计卡片
 * @param {string} filename - 文件名
 * @param {Object} stats - 统计数据
 * @returns {HTMLElement} 使用统计卡片元素
 */
function createUsageCard(filename, stats) {
    const div = document.createElement('div');
    div.className = 'usage-card';

    const geminiPercent = Math.min((stats.pro_model_calls || 0) / (stats.daily_limit_pro_models || 100) * 100, 100);
    const totalPercent = Math.min((stats.total_calls || 0) / (stats.daily_limit_total || 1000) * 100, 100);

    div.innerHTML = `
        <div class="usage-header">
            <div class="usage-filename">${filename}</div>
        </div>

        <div class="usage-progress">
            <div class="usage-progress-label">
                <span>Pro Models</span>
                <span>${stats.pro_model_calls || 0}/${stats.daily_limit_pro_models || 100} (${geminiPercent.toFixed(1)}%)</span>
            </div>
            <div class="usage-progress-bar">
                <div class="usage-progress-fill ${getProgressClass(geminiPercent)}" style="width: ${geminiPercent}%"></div>
            </div>
        </div>

        <div class="usage-progress">
            <div class="usage-progress-label">
                <span>所有模型</span>
                <span>${stats.total_calls || 0}/${stats.daily_limit_total || 1000} (${totalPercent.toFixed(1)}%)</span>
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

// ===========================
// 统计重置功能
// ===========================

/**
 * 重置单个文件的使用统计
 * @param {string} filename - 文件名
 */
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

/**
 * 重置所有文件的使用统计
 */
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

/**
 * 初始化使用统计标签页
 */
function initUsageTab() {
    refreshUsageStats();
}