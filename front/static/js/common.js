// ===========================
// 通用工具函数 (jQuery重构版)
// ===========================

/**
 * 显示状态消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型 ('info', 'success', 'error', 'warning')
 */
function showStatus(message, type = 'info') {
    const $statusSection = $('#statusSection');
    if ($statusSection.length) {
        $statusSection.html(`<div class="status ${type}">${message}</div>`)
            .get(0).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/**
 * 获取认证头
 * @returns {Object} 包含认证头的对象
 */
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.authToken || ''}`
    };
}

/**
 * 处理密码回车事件 (jQuery重构版)
 * @param {Event} event - 键盘事件
 * @param {Function} callback - 回调函数
 */
function handlePasswordEnter(event, callback) {
    if (event.key === 'Enter') callback();
}

/**
 * 格式化时间为本地时间
 * @param {string} isoString - ISO时间字符串
 * @returns {string} 格式化后的本地时间
 */
function formatTime(isoString) {
    if (!isoString) return '未知';
    try {
        const date = new Date(isoString);
        return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    } catch (e) {
        return '格式错误';
    }
}

/**
 * 进度条样式类获取器
 */
const ProgressUtils = {
    /**
     * 根据百分比获取进度条样式类
     * @param {number} percent - 百分比
     * @returns {string} 样式类名
     */
    getClass(percent) {
        if (percent >= 90) return 'danger';
        if (percent >= 70) return 'warning';
        return 'gemini';
    },

    /**
     * 根据百分比获取总进度条样式类
     * @param {number} percent - 百分比
     * @returns {string} 样式类名
     */
    getTotalClass(percent) {
        if (percent >= 90) return 'danger';
        if (percent >= 70) return 'warning';
        return 'total';
    }
};

/**
 * 标签页切换功能 (jQuery重构版)
 * @param {Event} event - 点击事件
 * @param {string} tabName - 标签页名称
 */
function switchTab(event, tabName) {
    $('.tab').removeClass('active');
    $('.tab-content').removeClass('active');

    $(event.currentTarget).addClass('active');
    $(`#${tabName}Tab`).addClass('active');

    // 触发对应标签页的初始化函数
    const initFn = window[`init${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`];
    if (typeof initFn === 'function') {
        initFn();
    }
}

// 向后兼容性
window.getProgressClass = ProgressUtils.getClass;
window.getTotalProgressClass = ProgressUtils.getTotalClass;