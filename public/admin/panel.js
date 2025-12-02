const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const statusEl = document.getElementById('status');
const tomlStatusEl = document.getElementById('tomlStatus');
const listEl = document.getElementById('accountsList');
const refreshBtn = document.getElementById('refreshBtn');
const manageStatusEl = document.getElementById('manageStatus');
const callbackUrlInput = document.getElementById('callbackUrlInput');
const submitCallbackBtn = document.getElementById('submitCallbackBtn');
const logsEl = document.getElementById('logs');
const usageEl = document.getElementById('usageSummary');
const importTomlBtn = document.getElementById('importTomlBtn');
const tomlInput = document.getElementById('tomlInput');
const replaceExistingCheckbox = document.getElementById('replaceExisting');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const deleteDisabledBtn = document.getElementById('deleteDisabledBtn');
const paginationInfo = document.getElementById('paginationInfo');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');

const PAGE_SIZE = 5;
let accountsData = [];
let currentPage = 1;

let replaceIndex = null;

function setStatus(text, type = 'info', target = statusEl) {
  if (!target) return;
  if (!text) {
    target.style.display = 'none';
    return;
  }
  target.textContent = text;
  target.className = `badge badge-${type}`;
  target.style.display = 'inline-block';
}

function activateTab(target) {
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabTarget === target);
  });
  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.dataset.tab === target);
  });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function renderUsageCard(account) {
  const { usage = {} } = account;
  const models = usage.models && usage.models.length > 0 ? usage.models.join(', ') : '暂无数据';
  const lastUsed = usage.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleString() : '未使用';
  return `
    <div class="usage"> 
      <div class="usage-row"><span>累计调用</span><strong>${usage.total || 0}</strong></div>
      <div class="usage-row"><span>成功 / 失败</span><strong>${usage.success || 0} / ${usage.failed || 0}</strong></div>
      <div class="usage-row"><span>最近使用</span><strong>${lastUsed}</strong></div>
      <div class="usage-row"><span>使用过的模型</span><strong>${models}</strong></div>
    </div>
  `;
}

function hasUsageRecord(account) {
  const usage = account?.usage || {};
  return (
    (usage.total ?? 0) > 0 ||
    (usage.success ?? 0) > 0 ||
    (usage.failed ?? 0) > 0 ||
    !!usage.lastUsedAt
  );
}

function bindAccountActions() {
  document.querySelectorAll('[data-action="refresh"]')?.forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = btn.dataset.index;
      btn.disabled = true;
      setStatus('正在刷新凭证...', 'info', manageStatusEl);
      try {
        await fetchJson(`/auth/accounts/${idx}/refresh`, { method: 'POST' });
        setStatus('刷新成功', 'success', manageStatusEl);
        refreshAccounts();
      } catch (e) {
        setStatus('刷新失败: ' + e.message, 'error', manageStatusEl);
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-action="toggle"]')?.forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = btn.dataset.index;
      const enable = btn.dataset.enable === 'false';
      btn.disabled = true;
      setStatus(enable ? '正在启用账号...' : '正在停用账号...', 'info', manageStatusEl);
      try {
        await fetchJson(`/auth/accounts/${idx}/enable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable })
        });
        setStatus(enable ? '已启用账号' : '已停用账号', 'success', manageStatusEl);
        refreshAccounts();
      } catch (e) {
        setStatus('更新状态失败: ' + e.message, 'error', manageStatusEl);
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-action="delete"]')?.forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = btn.dataset.index;
      if (!confirm('确认删除这个账号吗？删除后无法恢复')) return;
      btn.disabled = true;
      setStatus('正在删除账号...', 'info', manageStatusEl);
      try {
        await fetchJson(`/auth/accounts/${idx}`, { method: 'DELETE' });
        setStatus('账号已删除', 'success', manageStatusEl);
        refreshAccounts();
      } catch (e) {
        setStatus('删除失败: ' + e.message, 'error', manageStatusEl);
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-action="reauthorize"]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      replaceIndex = Number(btn.dataset.index);
      setStatus(`请重新授权账号 #${replaceIndex + 1}，完成后粘贴新的回调 URL 提交。`, 'info', manageStatusEl);
      loginBtn?.click();
    });
  });
}

async function refreshAccounts() {
  try {
    const data = await fetchJson('/auth/accounts');
    accountsData = data.accounts || [];
    if (!accountsData.length) {
      listEl.textContent = '暂无账号，请先添加一个。';
      if (paginationInfo) paginationInfo.textContent = '第 0 / 0 页';
      if (prevPageBtn) prevPageBtn.disabled = true;
      if (nextPageBtn) nextPageBtn.disabled = true;
    } else {
      currentPage = 1;
      renderAccountsList();
    }
    renderUsageSummary(accountsData);
  } catch (e) {
    listEl.textContent = '加载失败: ' + e.message;
  }
}

function renderAccountsList() {
  if (!accountsData.length) {
    listEl.textContent = '暂无账号，请先添加一个。';
    if (paginationInfo) paginationInfo.textContent = '第 0 / 0 页';
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(accountsData.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = accountsData.slice(start, start + PAGE_SIZE);

  listEl.innerHTML = pageItems
    .map(acc => {
      const created = acc.createdAt ? new Date(acc.createdAt).toLocaleString() : '时间未知';
      const statusClass = acc.enable ? 'status-ok' : 'status-off';
      const statusText = acc.enable ? '启用中' : '已停用';
      return `
        <div class="account-item">
          <div>
            <div class="account-title">账号 #${acc.index + 1}${
        acc.projectId ? ` <span class=\"badge\">${acc.projectId}</span>` : ''
      }</div>
            <div class="account-meta">创建时间：${created}</div>
            ${renderUsageCard(acc)}
          </div>
          <div class="account-actions">
            <div class="status-pill ${statusClass}">${statusText}</div>
            <button class="mini-btn" data-action="refresh" data-index="${acc.index}">刷新</button>
            <button class="mini-btn" data-action="toggle" data-enable="${acc.enable}" data-index="${acc.index}">${
        acc.enable ? '停用' : '启用'
      }</button>
            <button class="mini-btn" data-action="reauthorize" data-index="${acc.index}">重新授权</button>
            <button class="mini-btn danger" data-action="delete" data-index="${acc.index}">删除</button>
          </div>
        </div>
      `;
    })
    .join('');

  if (paginationInfo) {
    paginationInfo.textContent = `第 ${currentPage} / ${totalPages} 页，共 ${accountsData.length} 个凭证`;
  }
  if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
  if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
  bindAccountActions();
}

async function deleteDisabledAccounts() {
  const disabledAccounts = accountsData
    .filter(acc => !acc.enable)
    .sort((a, b) => b.index - a.index);
  if (disabledAccounts.length === 0) {
    setStatus('没有停用的凭证需要删除。', 'info', manageStatusEl);
    return;
  }

  if (!confirm(`确认删除 ${disabledAccounts.length} 个停用凭证吗？删除后无法恢复。`)) return;

  deleteDisabledBtn.disabled = true;
  setStatus('正在删除停用凭证...', 'info', manageStatusEl);

  try {
    for (const acc of disabledAccounts) {
      await fetchJson(`/auth/accounts/${acc.index}`, { method: 'DELETE' });
    }
    setStatus(`已删除 ${disabledAccounts.length} 个停用凭证。`, 'success', manageStatusEl);
    await refreshAccounts();
  } catch (e) {
    setStatus('删除停用凭证失败: ' + e.message, 'error', manageStatusEl);
  } finally {
    deleteDisabledBtn.disabled = false;
  }
}

function renderUsageSummary(accounts) {
  if (!usageEl) return;
  const activeAccounts = (accounts || []).filter(hasUsageRecord);
  const summary = activeAccounts
    .map(acc => {
      const usage = acc.usage || {};
      return `
        <div class="summary-card">
          <div class="summary-title">${acc.projectId || `账号 #${acc.index + 1}`}</div>
          <div class="summary-row"><span>总调用</span><strong>${usage.total || 0}</strong></div>
          <div class="summary-row"><span>成功 / 失败</span><strong>${usage.success || 0} / ${usage.failed || 0}</strong></div>
          <div class="summary-row"><span>最近使用</span><strong>${
        usage.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleString() : '暂无'
      }</strong></div>
        </div>
      `;
    })
    .join('');
  usageEl.innerHTML = summary || '暂无使用记录';
}

async function loadLogs() {
  if (!logsEl) return;
  try {
    const data = await fetchJson('/admin/logs?limit=200');
    const logs = data.logs || [];
    if (logs.length === 0) {
      logsEl.textContent = '暂无调用日志';
      return;
    }
    logsEl.innerHTML = logs
      .map(log => {
        const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : '未知时间';
        const cls = log.success ? 'log-success' : 'log-fail';
        return `
          <div class="log-item ${cls}">
            <div>
              <div class="log-time">${time}</div>
              <div class="log-meta">模型：${log.model || '未知模型'} | 项目：${log.projectId || '未知项目'}</div>
            </div>
            <div class="log-status">${log.success ? '成功' : '失败'}</div>
          </div>
        `;
      })
      .join('');
  } catch (e) {
    logsEl.textContent = '加载日志失败: ' + e.message;
  }
}

if (loginBtn) {
  loginBtn.addEventListener('click', async () => {
    try {
      loginBtn.disabled = true;
      setStatus('获取授权链接中...', 'info');
      const data = await fetchJson('/auth/oauth/url');
      if (!data.url) throw new Error('未返回 url');
      setStatus('已打开授权页面，请完成 Google 授权，然后复制回调页面地址栏中的完整 URL，粘贴到下方输入框并提交。', 'info');
      window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      setStatus('获取授权链接失败: ' + e.message, 'error');
    } finally {
      loginBtn.disabled = false;
    }
  });
}

if (submitCallbackBtn && callbackUrlInput) {
  submitCallbackBtn.addEventListener('click', async () => {
    const url = callbackUrlInput.value.trim();
    if (!url) {
      setStatus('请先粘贴包含 code 参数的完整回调 URL。', 'error');
      return;
    }

    try {
      submitCallbackBtn.disabled = true;
      setStatus('正在解析回调 URL 并交换 token...', 'info');
      await fetchJson('/auth/oauth/parse-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, replaceIndex })
      });

      setStatus('授权成功，账号已添加。', 'success');
      callbackUrlInput.value = '';
      replaceIndex = null;
      refreshAccounts();
    } catch (e) {
      setStatus('解析回调 URL 失败: ' + e.message, 'error');
    } finally {
      submitCallbackBtn.disabled = false;
    }
  });
}

if (importTomlBtn && tomlInput) {
  importTomlBtn.addEventListener('click', async () => {
    const content = tomlInput.value.trim();
    if (!content) {
      setStatus('请粘贴 TOML 凭证内容后再导入。', 'error', tomlStatusEl);
      return;
    }

    const replaceExisting = !!replaceExistingCheckbox?.checked;

    try {
      importTomlBtn.disabled = true;
      setStatus('正在导入 TOML 凭证...', 'info', tomlStatusEl);
      const result = await fetchJson('/auth/accounts/import-toml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toml: content, replaceExisting })
      });

      const summary = `导入成功：有效 ${result.imported ?? 0} 条，跳过 ${result.skipped ?? 0} 条，总计 ${result.total ?? 0} 个账号。`;
      setStatus(summary, 'success', tomlStatusEl);
      tomlInput.value = '';
      refreshAccounts();
      loadLogs();
    } catch (e) {
      setStatus('导入失败: ' + e.message, 'error', tomlStatusEl);
    } finally {
      importTomlBtn.disabled = false;
    }
  });
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tabTarget));
});

if (deleteDisabledBtn) {
  deleteDisabledBtn.addEventListener('click', deleteDisabledAccounts);
}

if (prevPageBtn) {
  prevPageBtn.addEventListener('click', () => {
    currentPage = Math.max(1, currentPage - 1);
    renderAccountsList();
  });
}

if (nextPageBtn) {
  nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(accountsData.length / PAGE_SIZE));
    currentPage = Math.min(totalPages, currentPage + 1);
    renderAccountsList();
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      logoutBtn.disabled = true;
      setStatus('正在退出登录...', 'info');
      await fetch('/admin/logout', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      window.location.href = '/admin/login';
    } catch (e) {
      setStatus('退出录失败: ' + e.message, 'error');
      logoutBtn.disabled = false;
    }
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    refreshAccounts();
    loadLogs();
  });
}

refreshAccounts();
loadLogs();
