const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const statusEl = document.getElementById('status');
const tomlStatusEl = document.getElementById('tomlStatus');
const listEl = document.getElementById('accountsList');
const refreshBtn = document.getElementById('refreshBtn');
const logsRefreshBtn = document.getElementById('logsRefreshBtn');
const hourlyUsageEl = document.getElementById('hourlyUsage');
const manageStatusEl = document.getElementById('manageStatus');
const callbackUrlInput = document.getElementById('callbackUrlInput');
const submitCallbackBtn = document.getElementById('submitCallbackBtn');
const logsEl = document.getElementById('logs');
const usageStatusEl = document.getElementById('usageStatus');
const settingsGrid = document.getElementById('settingsGrid');
const settingsStatusEl = document.getElementById('settingsStatus');
const settingsRefreshBtn = document.getElementById('settingsRefreshBtn');
const importTomlBtn = document.getElementById('importTomlBtn');
const tomlInput = document.getElementById('tomlInput');
const replaceExistingCheckbox = document.getElementById('replaceExisting');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const deleteDisabledBtn = document.getElementById('deleteDisabledBtn');
const usageRefreshBtn = document.getElementById('usageRefreshBtn');
const paginationInfo = document.getElementById('paginationInfo');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const logPaginationInfo = document.getElementById('logPaginationInfo');
const logPrevPageBtn = document.getElementById('logPrevPageBtn');
const logNextPageBtn = document.getElementById('logNextPageBtn');
const statusFilterSelect = document.getElementById('statusFilter');
const errorFilterCheckbox = document.getElementById('errorFilter');

const HOUR_WINDOW_MINUTES = 60;
const HOURLY_LIMIT = 20;

const PAGE_SIZE = 5;
let accountsData = [];
let filteredAccounts = [];
let currentPage = 1;
const LOG_PAGE_SIZE = 20;
let logsData = [];
let logCurrentPage = 1;
let statusFilter = 'all';
let errorOnly = false;
const logDetailCache = new Map();

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

function isNightTime() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 18 || hour < 6;
}

function applyAutoTheme() {
  const theme = isNightTime() ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
}

applyAutoTheme();
setInterval(applyAutoTheme, 10 * 60 * 1000);

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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatJson(value) {
  try {
    return escapeHtml(JSON.stringify(value ?? {}, null, 2));
  } catch (e) {
    return escapeHtml(String(value));
  }
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

function updateFilteredAccounts() {
  filteredAccounts = accountsData.filter(acc => {
    const matchesStatus =
      statusFilter === 'all' || (statusFilter === 'enabled' && acc.enable) || (statusFilter === 'disabled' && !acc.enable);

    const failedCount = acc?.usage?.failed || 0;
    const matchesError = !errorOnly || failedCount > 0;

    return matchesStatus && matchesError;
  });

  currentPage = 1;
  renderAccountsList();
}

function updateFilteredAccounts() {
  filteredAccounts = accountsData.filter(acc => {
    const matchesStatus =
      statusFilter === 'all' || (statusFilter === 'enabled' && acc.enable) || (statusFilter === 'disabled' && !acc.enable);

    const failedCount = acc?.usage?.failed || 0;
    const matchesError = !errorOnly || failedCount > 0;

    return matchesStatus && matchesError;
  });

  currentPage = 1;
  renderAccountsList();
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
    updateFilteredAccounts();
    loadHourlyUsage();
  } catch (e) {
    listEl.textContent = '加载失败: ' + e.message;
  }
}

function renderAccountsList() {
  if (!filteredAccounts.length) {
    listEl.textContent = accountsData.length ? '没有符合筛选条件的凭证。' : '暂无账号，请先添加一个。';
    if (paginationInfo) paginationInfo.textContent = '第 0 / 0 页';
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredAccounts.slice(start, start + PAGE_SIZE);

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
    paginationInfo.textContent = `第 ${currentPage} / ${totalPages} 页，共 ${filteredAccounts.length} 个凭证`;
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

function renderSettings(groups) {
  if (!settingsGrid) return;
  if (!groups || groups.length === 0) {
    settingsGrid.textContent = '暂无配置数据';
    return;
  }

  const html = groups
    .map(group => {
      const items = (group.items || [])
        .map(item => {
          const value = item?.value ?? '未设置';
          const badges = [
            `<span class="chip ${item.isDefault ? '' : 'chip-success'}">${item.isDefault ? '默认值' : '环境变量'}</span>`,
            item.sensitive ? '<span class="chip chip-warning">敏感信息</span>' : ''
          ]
            .filter(Boolean)
            .join('');

          const metaParts = [
            item.isDefault ? '使用默认值' : '来自环境变量',
            item.defaultValue !== null && item.defaultValue !== undefined
              ? `默认：${escapeHtml(item.defaultValue)}`
              : '无默认值',
            item.description ? escapeHtml(item.description) : ''
          ]
            .filter(Boolean)
            .join(' · ');

          return `
            <div class="setting-item ${item.isMissing ? 'missing' : ''}">
              <div class="setting-header">
                <div class="setting-key">${escapeHtml(item.label || item.key)}</div>
                ${badges}
              </div>
              <div class="setting-value">${escapeHtml(value)}</div>
              <div class="setting-meta">${metaParts}</div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="settings-group">
          <div class="settings-group-header">${escapeHtml(group.name || '配置')}</div>
          <div class="settings-list">${items || '<div class="setting-item">暂无配置</div>'}</div>
        </div>
      `;
    })
    .join('');

  settingsGrid.innerHTML = html;
}

async function loadSettings() {
  if (!settingsGrid) return;
  settingsGrid.textContent = '加载中...';
  try {
    const data = await fetchJson('/admin/settings');
    renderSettings(data.groups || []);
    if (data.updatedAt) {
      setStatus(`已更新：${new Date(data.updatedAt).toLocaleString()}`, 'success', settingsStatusEl);
    }
  } catch (e) {
    settingsGrid.textContent = '加载设置失败: ' + e.message;
    setStatus('刷新失败: ' + e.message, 'error', settingsStatusEl);
  }
}

async function loadLogs() {
  if (!logsEl) return;
  logsEl.textContent = '加载中...';
  if (logPaginationInfo) logPaginationInfo.textContent = '加载中...';
  if (logPrevPageBtn) logPrevPageBtn.disabled = true;
  if (logNextPageBtn) logNextPageBtn.disabled = true;
  try {
    const data = await fetchJson('/admin/logs?limit=200');
    logsData = data.logs || [];
    logCurrentPage = 1;
    renderLogs();
  } catch (e) {
    logsEl.textContent = '加载日志失败: ' + e.message;
    if (logPaginationInfo) logPaginationInfo.textContent = '';
  }
}

async function fetchLogDetail(logId) {
  if (!logId) throw new Error('缺少日志 ID');
  if (logDetailCache.has(logId)) return logDetailCache.get(logId);
  const data = await fetchJson(`/admin/logs/${logId}`);
  const detail = data.log;
  logDetailCache.set(logId, detail);
  return detail;
}

function renderLogDetailContent(detail, container) {
  if (!container) return;
  if (!detail) {
    container.textContent = '未找到日志详情';
    return;
  }

  const request = formatJson(detail.detail?.request);
  const response = formatJson(detail.detail?.response);

  container.innerHTML = `
    <div class="log-detail-block">
      <h4>请求</h4>
      <pre>${request}</pre>
    </div>
    <div class="log-detail-block">
      <h4>响应</h4>
      <pre>${response}</pre>
    </div>
  `;
}

function bindLogDetailToggles() {
  document.querySelectorAll('[data-log-id]')?.forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.detailTarget;
      const detailEl = document.getElementById(targetId);
      if (!detailEl) return;
      const isOpen = detailEl.classList.contains('open');
      if (isOpen) {
        detailEl.classList.remove('open');
        detailEl.style.display = 'none';
        btn.textContent = '查看请求/响应详情';
        return;
      }

      detailEl.style.display = 'block';
      detailEl.textContent = '加载中...';
      btn.disabled = true;
      try {
        const detail = await fetchLogDetail(btn.dataset.logId);
        renderLogDetailContent(detail, detailEl);
        detailEl.classList.add('open');
        btn.textContent = '收起详情';
      } catch (e) {
        detailEl.textContent = '加载详情失败: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderLogs() {
  if (!logsEl) return;

  if (!logsData.length) {
    logsEl.textContent = '暂无调用日志';
    if (logPaginationInfo) logPaginationInfo.textContent = '第 0 / 0 页';
    if (logPrevPageBtn) logPrevPageBtn.disabled = true;
    if (logNextPageBtn) logNextPageBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(logsData.length / LOG_PAGE_SIZE));
  logCurrentPage = Math.min(Math.max(logCurrentPage, 1), totalPages);
  const start = (logCurrentPage - 1) * LOG_PAGE_SIZE;
  const pageItems = logsData.slice(start, start + LOG_PAGE_SIZE);

  logsEl.innerHTML = pageItems
    .map((log, idx) => {
      const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : '未知时间';
      const cls = log.success ? 'log-success' : 'log-fail';
      const hasError = !log.success;
      const detailId = `log-detail-${start + idx}`;
      const statusText = log.status ? `HTTP ${log.status}` : log.success ? '成功' : '失败';
      const durationText = log.durationMs ? `${log.durationMs} ms` : '未知耗时';
      const pathText = `${log.method || '未知方法'} ${log.path || log.route || '未知路径'}`;
      const errorHint = hasError && log.message ? `<div class="log-error-hint">失败原因：${escapeHtml(log.message)}</div>` : '';
      const detailButton =
        log.hasDetail && log.id
          ? `<button class="mini-btn log-detail-toggle" data-log-id="${log.id}" data-detail-target="${detailId}">查看请求/响应详情</button>
             <div class="log-detail" id="${detailId}"></div>`
          : '';

      return `
        <div class="log-item ${cls}">
          <div class="log-content">
            <div class="log-time">${time}</div>
            <div class="log-meta">模型：${log.model || '未知模型'} | 项目：${log.projectId || '未知项目'}</div>
            <div class="log-meta">${pathText}</div>
            <div class="log-meta">${statusText} | ${durationText}</div>
            ${errorHint}
            ${detailButton}
          </div>
          <div class="log-status">${log.success ? '成功' : '失败'}</div>
        </div>
      `;
    })
    .join('');

  if (logPaginationInfo) {
    logPaginationInfo.textContent = `第 ${logCurrentPage} / ${totalPages} 页，共 ${logsData.length} 条`;
  }
  if (logPrevPageBtn) logPrevPageBtn.disabled = logCurrentPage === 1;
  if (logNextPageBtn) logNextPageBtn.disabled = logCurrentPage === totalPages;
  bindLogDetailToggles();
}

async function loadHourlyUsage() {
  if (!hourlyUsageEl) return;
  hourlyUsageEl.textContent = '加载中...';
  try {
    const data = await fetchJson('/admin/logs/usage');
    const usageMap = new Map();
    (data.usage || []).forEach(item => {
      if (!item) return;
      usageMap.set(item.projectId || '未知项目', item);
    });

    const merged = (accountsData.length ? accountsData : Array.from(usageMap.values()))
      .map(acc => {
        const projectId = acc.projectId || acc.project || acc.id || '未知项目';
        const stats = usageMap.get(projectId) || acc || {};
        const usage = acc.usage || {};

        const totalCalls = usage.total ?? stats.count ?? 0;
        const successCalls = usage.success ?? stats.success ?? 0;
        const failedCalls = usage.failed ?? stats.failed ?? 0;
        const lastUsedAt = usage.lastUsedAt || stats.lastUsedAt || null;

        const hasActivity =
          (stats.count || 0) > 0 ||
          (totalCalls || 0) > 0 ||
          (successCalls || 0) > 0 ||
          (failedCalls || 0) > 0 ||
          !!lastUsedAt;

        return {
          projectId,
          label: acc.projectId || acc.project || acc.label || `账号 #${(acc.index ?? 0) + 1}`,
          count: stats.count || 0,
          success: successCalls,
          failed: failedCalls,
          total: totalCalls,
          lastUsedAt,
          hasActivity
        };
      })
      .filter(item => item.hasActivity);

    const windowMinutes = data.windowMinutes || HOUR_WINDOW_MINUTES;
    const limit = data.limitPerCredential || HOURLY_LIMIT;

    if (!merged.length) {
      hourlyUsageEl.textContent = '暂无最近 1 小时内的调用记录';
      return;
    }

    const sorted = merged.sort((a, b) => {
      const aTime = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
      const bTime = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.count || 0) - (a.count || 0);
    });

    const html = sorted
      .map(item => {
        const percent = Math.min(100, Math.round(((item.count || 0) / limit) * 100));
        const lastUsedText = item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : '暂无';
        return `
          <div class="log-usage-row">
            <div class="log-usage-header">
              <div class="log-usage-title">${escapeHtml(item.label)}</div>
              <div class="log-usage-meta">${item.count || 0} / ${limit} 次 · ${windowMinutes} 分钟</div>
            </div>
            <div class="progress-bar" aria-label="${escapeHtml(item.label)} 用量">
              <div class="progress" style="width:${percent}%;"></div>
            </div>
            <div class="log-usage-stats">
              <div class="log-usage-stat">
                <span class="stat-label">总调用</span>
                <span class="stat-value">${item.total || 0}</span>
              </div>
              <div class="log-usage-stat">
                <span class="stat-label">成功 / 失败</span>
                <span class="stat-value">${item.success || 0} / ${item.failed || 0}</span>
              </div>
              <div class="log-usage-stat">
                <span class="stat-label">最近使用</span>
                <span class="stat-value">${escapeHtml(lastUsedText)}</span>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    hourlyUsageEl.innerHTML = html;
  } catch (e) {
    hourlyUsageEl.textContent = '加载用量失败: ' + e.message;
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
    const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
    currentPage = Math.min(totalPages, currentPage + 1);
    renderAccountsList();
  });
}

if (logPrevPageBtn) {
  logPrevPageBtn.addEventListener('click', () => {
    logCurrentPage = Math.max(1, logCurrentPage - 1);
    renderLogs();
  });
}

if (logNextPageBtn) {
  logNextPageBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(logsData.length / LOG_PAGE_SIZE));
    logCurrentPage = Math.min(totalPages, logCurrentPage + 1);
    renderLogs();
  });
}

if (statusFilterSelect) {
  statusFilterSelect.addEventListener('change', () => {
    statusFilter = statusFilterSelect.value || 'all';
    updateFilteredAccounts();
  });
}

if (errorFilterCheckbox) {
  errorFilterCheckbox.addEventListener('change', () => {
    errorOnly = !!errorFilterCheckbox.checked;
    updateFilteredAccounts();
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
    loadHourlyUsage();
  });
}

if (logsRefreshBtn) {
  logsRefreshBtn.addEventListener('click', async () => {
    try {
      logsRefreshBtn.disabled = true;
      logsRefreshBtn.textContent = '刷新中...';
      await loadLogs();
    } finally {
      logsRefreshBtn.textContent = '🔄 刷新日志';
      logsRefreshBtn.disabled = false;
    }
  });
}

if (usageRefreshBtn) {
  usageRefreshBtn.addEventListener('click', async () => {
    try {
      usageRefreshBtn.disabled = true;
      usageRefreshBtn.textContent = '刷新中...';
      await loadHourlyUsage();
      setStatus('用量已刷新', 'success', usageStatusEl);
    } catch (e) {
      setStatus('刷新用量失败: ' + e.message, 'error', usageStatusEl);
    } finally {
      usageRefreshBtn.textContent = '🔄 刷新用量';
      usageRefreshBtn.disabled = false;
    }
  });
}

if (settingsRefreshBtn) {
  settingsRefreshBtn.addEventListener('click', async () => {
    try {
      settingsRefreshBtn.disabled = true;
      settingsRefreshBtn.textContent = '刷新中...';
      await loadSettings();
    } finally {
      settingsRefreshBtn.textContent = '🔄 刷新配置';
      settingsRefreshBtn.disabled = false;
    }
  });
}

refreshAccounts();
loadLogs();
loadHourlyUsage();
loadSettings();
