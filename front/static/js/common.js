// ===========================
// 通用工具函数
// ===========================

/**
 * 显示状态消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型 ('info', 'success', 'error', 'warning')
 */
function showStatus(message, type = 'info') {
    const statusSection = document.getElementById('statusSection');
    if (statusSection) {
        statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
        statusSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
 * 处理密码回车事件
 * @param {Event} event - 键盘事件
 * @param {Function} callback - 回调函数
 */
function handlePasswordEnter(event, callback) {
    if (event.key === 'Enter') {
        callback();
    }
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
 * 根据百分比获取进度条样式类
 * @param {number} percent - 百分比
 * @returns {string} 样式类名
 */
function getProgressClass(percent) {
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warning';
    return 'gemini';
}

/**
 * 根据百分比获取总进度条样式类
 * @param {number} percent - 百分比
 * @returns {string} 样式类名
 */
function getTotalProgressClass(percent) {
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warning';
    return 'total';
}

/**
 * 标签页切换功能
 * @param {Event} event - 点击事件
 * @param {string} tabName - 标签页名称
 */
function switchTab(event, tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.currentTarget.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');

    // 触发对应标签页的初始化函数
    if (typeof window[`init${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`] === 'function') {
        window[`init${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`]();
    }
}