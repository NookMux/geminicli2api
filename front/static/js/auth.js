// 检查登录状态
function checkAuthStatus() {
    const token = window.sessionStorage.getItem('authToken') || window.authToken;

    // 如果有token，验证token是否有效
    if (token) {
        validateToken(token);
    } else {
        // 没有token，重定向到登录页
        redirectToLogin();
    }
}

// 验证token有效性
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
                // token有效，显示控制面板
                showControlPanel();
            } else {
                // token无效，清除并重定向到登录页
                clearAuth();
                redirectToLogin();
            }
        } else {
            // 请求失败，可能需要登录
            redirectToLogin();
        }
    } catch (error) {
        console.error('Token validation error:', error);
        // 网络错误时尝试显示控制面板，让后续API请求处理
        showControlPanel();
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

    // 控制面板显示后初始化
    if (typeof initializeApp === 'function') {
        initializeApp();
    }
}

// 重定向到登录页
function redirectToLogin() {
    // 如果当前不是登录页，重定向
    if (window.location.pathname !== '/') {
        window.location.href = '/';
    } else {
        // 已经在登录页，显示登录表单
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

// 清除认证信息
function clearAuth() {
    window.sessionStorage.removeItem('authToken');
    window.authToken = null;
}

// 检查登录状态
document.addEventListener('DOMContentLoaded', function() {
    checkAuthStatus();
});
