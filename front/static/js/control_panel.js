// 模块配置
const moduleConfig = {
    oauth: {
        name: 'OAuth认证',
        subTabs: [
            { id: 'single-login', name: '单项目登录' },
            { id: 'all-login', name: '全部项目登录' }
        ]
    },
    credentials: {
        name: '凭证管理',
        subTabs: [
            { id: 'api-keys', name: 'API密钥' },
            { id: 'access-tokens', name: '访问令牌' },
            { id: 'permissions', name: '权限配置' }
        ]
    },
    statistics: {
        name: '使用统计',
        subTabs: [
            { id: 'today-stats', name: '今日统计' },
            { id: 'month-stats', name: '本月统计' },
            { id: 'custom-stats', name: '自定义时段' }
        ]
    },
    logs: {
        name: '调用日志',
        subTabs: [
            { id: 'success-logs', name: '成功日志' },
            { id: 'error-logs', name: '失败日志' },
            { id: 'all-logs', name: '全部日志' }
        ]
    },
    config: {
        name: '配置管理',
        subTabs: [
            { id: 'basic-config', name: '基础配置' },
            { id: 'advanced-config', name: '高级配置' },
            { id: 'system-settings', name: '系统设置' }
        ]
    }
};

// 当前状态
let currentModule = 'oauth';
let currentTab = 'single-login';

// DOM元素
let navItems;
let subTabsContainer;
let contentPanels;
let mobileMenuBtn;
let sidebar;

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    // 获取DOM元素
    navItems = document.querySelectorAll('.nav-item');
    subTabsContainer = document.getElementById('subTabs');
    contentPanels = document.querySelectorAll('.content-panel');
    mobileMenuBtn = document.getElementById('mobileMenuBtn');
    sidebar = document.querySelector('.sidebar');

    // 绑定事件
    bindEvents();

    // 初始化默认状态
    initializeDefaultState();

    // 初始化图表（如果需要）
    initializeCharts();
});

// 绑定事件
function bindEvents() {
    // 左侧导航点击事件
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const module = this.dataset.module;
            switchModule(module);
        });
    });

    // 移动端菜单按钮点击事件
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', toggleMobileMenu);
    }

    // 点击侧边栏外部关闭移动端菜单
    document.addEventListener('click', function(e) {
        if (window.innerWidth <= 768 &&
            sidebar &&
            sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) &&
            !mobileMenuBtn.contains(e.target)) {
            closeMobileMenu();
        }
    });

    // 窗口大小改变时关闭移动端菜单
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            closeMobileMenu();
        }
    });

    // 绑定所有子选项卡的点击事件（包括初始状态和后续动态创建的）
    bindSubTabEvents();
}

// 绑定子选项卡点击事件
function bindSubTabEvents() {
    const subTabs = document.querySelectorAll('.sub-tab');
    subTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            switchToTab(this.dataset.tab);
        });
    });
}

// 初始化默认状态
function initializeDefaultState() {
    // 默认选中OAuth认证模块的第一个子选项卡
    const oauthModule = document.querySelector('[data-module="oauth"]');
    if (oauthModule) {
        oauthModule.classList.add('active');
    }

    // 确保默认的子选项卡是激活状态
    const defaultTab = document.querySelector('.sub-tab[data-tab="single-login"]');
    if (defaultTab) {
        defaultTab.classList.add('active');
    }

    // 确保默认内容面板是显示状态
    const defaultPanel = document.getElementById('single-login');
    if (defaultPanel) {
        defaultPanel.classList.add('active');
    }
}

// 切换模块
function switchModule(moduleId) {
    if (moduleId === currentModule) return;

    const module = moduleConfig[moduleId];
    if (!module) return;

    // 更新左侧导航状态
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.module === moduleId) {
            item.classList.add('active');
        }
    });

    // 更新子选项卡
    updateSubTabs(module.subTabs);

    // 显示第一个子选项卡的内容
    if (module.subTabs.length > 0) {
        switchToTab(module.subTabs[0].id);
    }

    // 更新当前模块
    currentModule = moduleId;

    // 移动端切换模块后关闭菜单
    if (window.innerWidth <= 768) {
        closeMobileMenu();
    }
}

// 更新子选项卡
function updateSubTabs(subTabs) {
    if (!subTabsContainer) return;

    // 清空现有子选项卡
    subTabsContainer.innerHTML = '';

    // 创建新的子选项卡
    subTabs.forEach((tab, index) => {
        const button = document.createElement('button');
        button.className = 'sub-tab';
        button.dataset.tab = tab.id;
        button.textContent = tab.name;

        // 第一个子选项卡默认激活
        if (index === 0) {
            button.classList.add('active');
        }

        subTabsContainer.appendChild(button);
    });

    // 重新绑定所有子选项卡的点击事件
    bindSubTabEvents();
}

// 切换到指定子选项卡
function switchToTab(tabId) {
    if (tabId === currentTab) return;

    // 更新子选项卡状态
    const allSubTabs = subTabsContainer.querySelectorAll('.sub-tab');
    allSubTabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === tabId) {
            tab.classList.add('active');
        }
    });

    // 更新内容面板显示
    contentPanels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === tabId) {
            panel.classList.add('active');
        }
    });

    // 更新当前选项卡
    currentTab = tabId;

    // 如果是统计页面，初始化或更新图表
    if (tabId === 'month-stats') {
        setTimeout(updateMonthlyChart, 100);
    }
}

// 切换移动端菜单
function toggleMobileMenu() {
    if (!sidebar) return;

    sidebar.classList.toggle('open');

    // 更新菜单按钮图标
    const icon = mobileMenuBtn.querySelector('i');
    if (sidebar.classList.contains('open')) {
        icon.classList.remove('fa-bars');
        icon.classList.add('fa-times');
    } else {
        icon.classList.remove('fa-times');
        icon.classList.add('fa-bars');
    }
}

// 关闭移动端菜单
function closeMobileMenu() {
    if (!sidebar) return;

    sidebar.classList.remove('open');

    // 恢复菜单按钮图标
    const icon = mobileMenuBtn.querySelector('i');
    icon.classList.remove('fa-times');
    icon.classList.add('fa-bars');
}

// 初始化图表
function initializeCharts() {
    // 延迟初始化，确保Canvas元素已经渲染
    setTimeout(() => {
        if (document.getElementById('month-stats').classList.contains('active')) {
            updateMonthlyChart();
        }
    }, 500);
}

// 更新月度统计图表
function updateMonthlyChart() {
    const canvas = document.getElementById('monthlyChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // 如果已存在图表实例，先销毁
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    // 创建新的图表
    canvas.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['1日', '5日', '10日', '15日', '20日', '25日', '30日'],
            datasets: [{
                label: 'API调用次数',
                data: [650, 890, 1200, 934, 1456, 1123, 1234],
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }, {
                label: '成功次数',
                data: [580, 801, 1080, 841, 1310, 1010, 1098],
                borderColor: '#764ba2',
                backgroundColor: 'rgba(118, 75, 162, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#667eea',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        display: false
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    grid: {
                        borderDash: [5, 5]
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// 工具函数：格式化数字
function formatNumber(num) {
    return new Intl.NumberFormat('zh-CN').format(num);
}

// 工具函数：显示通知
function showNotification(message, type = 'success') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    // 样式
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;

    // 根据类型设置背景色
    if (type === 'success') {
        notification.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
    } else if (type === 'error') {
        notification.style.background = 'linear-gradient(135deg, #f44336, #da190b)';
    } else if (type === 'warning') {
        notification.style.background = 'linear-gradient(135deg, #ff9800, #e68900)';
    }

    // 添加到页面
    document.body.appendChild(notification);

    // 自动移除
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// 添加动画样式
if (!document.querySelector('#notification-animations')) {
    const style = document.createElement('style');
    style.id = 'notification-animations';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

// 显示认证状态消息
function showAuthStatus(message, type) {
    const statusElement = document.getElementById('authStatus');
    statusElement.textContent = message;
    statusElement.className = `status-message status-${type}`;
    statusElement.style.display = 'block';

    // 成功消息3秒后自动隐藏，错误和警告消息需要手动关闭
    if (type === 'success') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    } else if (type === 'error' || type === 'warning') {
        // 为错误和警告消息添加关闭按钮
        if (!statusElement.querySelector('.close-btn')) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'close-btn';
            closeBtn.innerHTML = '<i class="fas fa-times"></i>';
            closeBtn.onclick = () => {
                statusElement.style.display = 'none';
            };
            statusElement.appendChild(closeBtn);
        }
    }
}

// 获取认证token（从localStorage或其他地方）
function getAuthToken() {
    // 这里应该从安全的地方获取token，比如localStorage
    return localStorage.getItem('auth_token') || '';
}

// 导出全局函数供HTML使用
window.switchModule = switchModule;
window.switchToTab = switchToTab;
window.showNotification = showNotification;