// 鉴权工具：统一获取和使用登录 Token
function getPanelAuthToken() {
    return window.sessionStorage.getItem('authToken') || window.authToken || '';
}

function getPanelAuthHeaders(extra = {}) {
    const token = getPanelAuthToken();
    const baseHeaders = { 'Content-Type': 'application/json', ...extra };
    if (!token) {
        return baseHeaders;
    }
    return {
        ...baseHeaders,
        'Authorization': `Bearer ${token}`
    };
}

// 登录状态检查遮罩
function showLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// 检查登录状态
function checkAuthStatus() {
    const token = window.sessionStorage.getItem('authToken') || window.authToken;
    showLoadingOverlay();

    if (token) {
        validateToken(token);
    } else {
        redirectToLogin();
        hideLoadingOverlay();
    }
}

// 校验 token 是否有效
async function validateToken(token) {
    try {
        const response = await fetch('/auth/validate', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.valid) {
                showControlPanel();
            } else {
                clearAuth();
                redirectToLogin();
            }
        } else {
            redirectToLogin();
        }
    } catch (error) {
        console.error('Token validation error:', error);
        // 网络错误时默认展示控制面板，交给后续请求自行处理 401
        showControlPanel();
    } finally {
        hideLoadingOverlay();
    }
}

// 显示控制面板
function showControlPanel() {
    const controlPanel = document.getElementById('controlPanel');
    const loginPage = document.getElementById('loginPage');

    if (controlPanel) {
        controlPanel.style.display = 'block';
    }

    if (loginPage) {
        loginPage.style.display = 'none';
    }

    if (typeof initializeApp === 'function') {
        initializeApp();
    }
}

// 跳转到登录页
function redirectToLogin() {
    if (window.location.pathname !== '/') {
        window.location.href = '/';
    } else {
        const controlPanel = document.getElementById('controlPanel');
        const loginPage = document.getElementById('loginPage');

        if (controlPanel) {
            controlPanel.style.display = 'none';
        }

        if (loginPage) {
            loginPage.style.display = 'block';
        }
    }
}

// 清除登录信息
function clearAuth() {
    window.sessionStorage.removeItem('authToken');
    window.authToken = null;
}

// 页面加载后检查登录状态
document.addEventListener('DOMContentLoaded', function() {
    checkAuthStatus();
});
