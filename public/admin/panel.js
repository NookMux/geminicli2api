const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('accountsList');
const refreshBtn = document.getElementById('refreshBtn');
const callbackUrlInput = document.getElementById('callbackUrlInput');
const submitCallbackBtn = document.getElementById('submitCallbackBtn');

function setStatus(text) {
  if (!text) {
    statusEl.style.display = 'none';
    return;
  }
  statusEl.textContent = text;
  statusEl.style.display = 'inline-block';
}

async function refreshAccounts() {
  try {
    const res = await fetch('/auth/accounts', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('请求失败');
    const data = await res.json();
    const list = data.accounts || [];
    if (list.length === 0) {
      listEl.textContent = '暂无账号，请先添加一个。';
      return;
    }
    listEl.innerHTML = list
      .map(acc => {
        const created = acc.createdAt
          ? new Date(acc.createdAt).toLocaleString()
          : '时间未知';
        const statusClass = acc.enable ? 'status-ok' : 'status-off';
        const statusText = acc.enable ? '启用中' : '已停用';
        return (
          '<div class="account-item">' +
          '<div>' +
          '账号 #' +
          acc.index +
          (acc.projectId ? ' <span class="badge">' + acc.projectId + '</span>' : '') +
          '<div class="account-meta">创建时间：' +
          created +
          '</div>' +
          '</div>' +
          '<div class="status-pill ' +
          statusClass +
          '">' +
          statusText +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  } catch (e) {
    listEl.textContent = '加载失败: ' + e.message;
  }
}

if (loginBtn) {
  loginBtn.addEventListener('click', async () => {
    try {
      loginBtn.disabled = true;
      setStatus('获取授权链接中...');
      const res = await fetch('/auth/oauth/url', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('请求失败');
      const data = await res.json();
      if (!data.url) throw new Error('未返回 url');
      setStatus('已打开授权页面，请完成 Google 授权，然后复制回调页面地址栏中的完整 URL，粘贴到下方输入框并提交。');
      window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      setStatus('获取授权链接失败: ' + e.message);
      loginBtn.disabled = false;
    }
  });
}

if (submitCallbackBtn && callbackUrlInput) {
  submitCallbackBtn.addEventListener('click', async () => {
    const url = callbackUrlInput.value.trim();
    if (!url) {
      setStatus('请先粘贴包含 code 参数的完整回调 URL。');
      return;
    }

    try {
      submitCallbackBtn.disabled = true;
      setStatus('正在解析回调 URL 并交换 token...');
      const res = await fetch('/auth/oauth/parse-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setStatus('授权成功，账号已添加。');
      callbackUrlInput.value = '';
      refreshAccounts();
    } catch (e) {
      setStatus('解析回调 URL 失败: ' + e.message);
    } finally {
      submitCallbackBtn.disabled = false;
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      logoutBtn.disabled = true;
      setStatus('正在退出登录...');
      await fetch('/admin/logout', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      window.location.href = '/admin/login';
    } catch (e) {
      setStatus('退出登录失败: ' + e.message);
      logoutBtn.disabled = false;
    }
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    refreshAccounts();
  });
}

refreshAccounts();

