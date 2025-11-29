async function handleLogin() {
    const password = document.getElementById('passwordInput').value;
    const button = document.getElementById('loginButton');
    const errorMessage = document.getElementById('errorMessage');

    if (!password) {
        showError('请输入密码');
        return;
    }

    // 显示加载状态
    button.classList.add('loading');
    button.textContent = '登录中...';
    errorMessage.style.display = 'none';

    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (response.ok) {
            // 将 token 存到窗口级存储（关闭标签页即清空）
            window.sessionStorage.setItem('authToken', data.token);
            // 同步到全局变量，方便后续脚本直接访问
            window.authToken = data.token;

            // 登录成功，重新加载页面获取控制面板（后端会通过 Set-Cookie 维护登录态）
            window.location.href = '/root';
        } else {
            showError(data.detail || '登录失败');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('网络错误，请稍后重试');
    } finally {
        // 恢复按钮状态
        button.classList.remove('loading');
        button.textContent = '登录';
    }
}

function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        handleLogin();
    }
}

// 页面加载完成后聚焦密码输入框
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('passwordInput').focus();
});
