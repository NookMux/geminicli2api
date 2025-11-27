// ===========================
// 控制面板 - 主要功能 (重构版)
// ===========================

let currentProjectId = '';
let authInProgress = false;
let authToken = '';
let credsData = {};

// 分页和筛选相关变量
let filteredCredsData = {};
let currentPage = 1;
let pageSize = 20;
let currentFilter = 'all';
let currentErrorCodeFilter = 'all';
let selectedCredFiles = new Set();
let availableErrorCodes = new Set();
let statsData = {
    total: 0,
    normal: 0,
    disabled: 0
};

// ===========================
// 主题管理
// ===========================

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (theme === 'dark') {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
    } else {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
    }
}

// ===========================
// 通用函数
// ===========================

function showStatus(message, type = 'info') {
    const statusSection = document.getElementById('statusSection');
    if (statusSection) {
        statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
        // 自动隐藏成功消息
        if (type === 'success') {
            setTimeout(() => {
                statusSection.innerHTML = '';
            }, 3000);
        }
    }
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

// ===========================
// 登录相关函数
// ===========================

async function login() {
    const password = document.getElementById('loginPassword').value;
    if (!password) {
        showStatus('请输入密码', 'error');
        return;
    }

    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.token;
            // 同步 token 给其他模块
            if (typeof setAuthToken === 'function') {
                setAuthToken(authToken);
            }
            // 切换界面
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            
            // 默认加载第一个 Tab 数据
            refreshCredsStatus(); 
        } else {
            alert(`登录失败: ${data.detail || '密码错误'}`);
        }
    } catch (error) {
        alert(`网络错误: ${error.message}`);
    }
}

function handlePasswordEnter(event) {
    if (event.key === 'Enter') {
        login();
    }
}

// ===========================
// 导航切换
// ===========================

function switchTab(event, tabName) {
    // 移除所有 nav-item 的 active 类
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    // 隐藏所有 tab-content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // 激活当前点击的按钮和对应的内容区域
    event.currentTarget.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    // 更新顶部标题
    const titles = {
        'oauth': 'OAuth 认证',
        'manage': '凭证文件管理',
        'usage': '资源使用统计',
        'apilog': 'API 调用日志',
        'import': 'JSON 凭证导入',
        'config': '系统参数配置'
    };
    document.getElementById('pageTitle').textContent = titles[tabName] || '控制台';

    // 按需加载数据
    if (tabName === 'manage') refreshCredsStatus();
    if (tabName === 'usage') refreshUsageStats();
    if (tabName === 'apilog') refreshApiLog();
    if (tabName === 'import') clearImportForm();
    if (tabName === 'config') loadConfig();
}

// ===========================
// OAuth 认证
// ===========================

async function startAuth() {
    const projectId = document.getElementById('projectId').value.trim();
    const getAllProjects = document.getElementById('getAllProjectsCreds').checked;
    
    const btn = document.getElementById('getAuthBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 请求中...';

    try {
        const response = await fetch('/auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                project_id: projectId || null,
                get_all_projects: getAllProjects
            })
        });

        const data = await response.json();

        if (response.ok) {
            const authLink = document.getElementById('authUrl');
            authLink.href = data.auth_url;
            authLink.textContent = data.auth_url.substring(0, 60) + '...';
            document.getElementById('authUrlSection').classList.remove('hidden');
            showStatus('链接生成成功，请进行授权', 'success');
        } else {
            showStatus(data.error || '获取链接失败', 'error');
        }
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fab fa-google"></i> 生成认证链接';
    }
}

async function processCallbackUrl() {
    const url = document.getElementById('callbackUrlInput').value.trim();
    if (!url) return showStatus('请输入回调 URL', 'error');

    const getAllProjects = document.getElementById('getAllProjectsCreds').checked;
    const projectId = document.getElementById('projectId').value.trim();

    try {
        const response = await fetch('/auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                callback_url: url,
                project_id: projectId || null,
                get_all_projects: getAllProjects
            })
        });

        const result = await response.json();
        
        const output = document.getElementById('credentialsContent');
        const section = document.getElementById('credentialsSection');
        section.classList.remove('hidden');

        if (response.ok) {
            output.textContent = JSON.stringify(result, null, 2);
            showStatus('认证成功，凭证已保存', 'success');
            // 自动刷新列表
            refreshCredsStatus();
        } else {
            output.textContent = JSON.stringify(result, null, 2);
            showStatus(result.error || '认证失败', 'error');
        }
    } catch (error) {
        showStatus(error.message, 'error');
    }
}

// ===========================
// 凭证管理 (Manage Tab)
// ===========================

async function refreshCredsStatus() {
    const loader = document.getElementById('credsLoading');
    const list = document.getElementById('credsList');
    
    loader.classList.remove('hidden');
    list.innerHTML = '';

    try {
        const response = await fetch('/creds/status', {
            method: 'GET',
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok) {
            credsData = data.creds;
            calculateStats();
            applyFilters();
        } else {
            showStatus('加载失败', 'error');
        }
    } catch (error) {
        showStatus('网络错误', 'error');
    } finally {
        loader.classList.add('hidden');
    }
}

function calculateStats() {
    statsData = { total: 0, normal: 0, disabled: 0 };
    availableErrorCodes.clear();

    Object.values(credsData).forEach(cred => {
        statsData.total++;
        if (cred.status.disabled) statsData.disabled++;
        else statsData.normal++;

        if (cred.status.error_codes) {
            cred.status.error_codes.forEach(code => availableErrorCodes.add(code));
        }
    });

    document.getElementById('statTotal').textContent = statsData.total;
    document.getElementById('statNormal').textContent = statsData.normal;
    document.getElementById('statDisabled').textContent = statsData.disabled;
    
    renderErrorBadges();
}

function renderErrorBadges() {
    const container = document.getElementById('errorCodeBadges');
    container.innerHTML = '';
    
    availableErrorCodes.forEach(code => {
        const badge = document.createElement('span');
        badge.className = 'status error';
        badge.style.display = 'inline-block';
        badge.style.padding = '0.2rem 0.6rem';
        badge.style.marginRight = '0.5rem';
        badge.style.cursor = 'pointer';
        badge.textContent = `Err ${code}`;
        badge.onclick = () => {
            document.getElementById('errorCodeFilter').value = code; // 这里简化处理，实际可能需要更复杂的筛选逻辑支持
            // 简单提示用户
            showStatus(`点击了错误码 ${code}，请在下拉框选择对应筛选`, 'info');
        };
        container.appendChild(badge);
    });
}

function applyFilters() {
    const statusFilter = document.getElementById('statusFilter').value;
    const errorFilter = document.getElementById('errorCodeFilter').value;
    
    filteredCredsData = {};
    
    Object.entries(credsData).forEach(([path, cred]) => {
        let match = true;
        if (statusFilter === 'normal' && cred.status.disabled) match = false;
        if (statusFilter === 'disabled' && !cred.status.disabled) match = false;
        
        if (errorFilter === 'has-errors' && (!cred.status.error_codes || cred.status.error_codes.length === 0)) match = false;
        
        if (match) filteredCredsData[path] = cred;
    });
    
    currentPage = 1;
    renderCredsList();
}

function renderCredsList() {
    const list = document.getElementById('credsList');
    list.innerHTML = '';
    
    const allItems = Object.entries(filteredCredsData);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageItems = allItems.slice(start, end);
    
    document.getElementById('paginationInfo').textContent = 
        `${currentPage} / ${Math.ceil(allItems.length / pageSize) || 1}`;

    pageItems.forEach(([path, cred]) => {
        const card = document.createElement('div');
        card.className = 'cred-card';
        
        const statusClass = cred.status.disabled ? 'disabled' : 
                          (cred.status.error_codes?.length > 0 ? 'error' : '');
        
        card.innerHTML = `
            <div class="cred-header">
                <div class="cred-filename">
                    <span class="status-dot ${statusClass}"></span>
                    ${cred.filename}
                </div>
                <input type="checkbox" class="file-checkbox" data-filename="${cred.filename}" 
                    ${selectedCredFiles.has(cred.filename) ? 'checked' : ''}
                    onchange="toggleFileSelection('${cred.filename}')">
            </div>
            <div class="cred-email">${cred.user_email || '未知邮箱'}</div>
            <div class="cred-actions">
                ${cred.status.disabled ? 
                    `<button class="cred-btn" onclick="credAction('${cred.filename}', 'enable')"><i class="fas fa-play"></i> 启用</button>` :
                    `<button class="cred-btn" onclick="credAction('${cred.filename}', 'disable')"><i class="fas fa-pause"></i> 禁用</button>`
                }
                <button class="cred-btn" onclick="fetchUserEmail('${cred.filename}')"><i class="fas fa-envelope"></i> 邮箱</button>
                <button class="cred-btn" onclick="openModelPermissionModal('${cred.filename}')"><i class="fas fa-shield-alt"></i> 权限</button>
                <button class="cred-btn" onclick="deleteCred('${cred.filename}')" style="color:var(--danger)"><i class="fas fa-trash"></i></button>
            </div>
        `;
        list.appendChild(card);
    });
}

function changePage(delta) {
    const maxPage = Math.ceil(Object.keys(filteredCredsData).length / pageSize);
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= maxPage) {
        currentPage = newPage;
        renderCredsList();
    }
}

// ===========================
// 单文件操作
// ===========================

async function credAction(filename, action) {
    try {
        const res = await fetch('/creds/action', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ filename, action })
        });
        if (res.ok) {
            showStatus('操作成功', 'success');
            refreshCredsStatus();
        } else {
            showStatus('操作失败', 'error');
        }
    } catch (e) {
        showStatus(e.message, 'error');
    }
}

function deleteCred(filename) {
    if (confirm(`确定删除 ${filename} 吗？`)) {
        credAction(filename, 'delete');
    }
}

function toggleFileSelection(filename) {
    if (selectedCredFiles.has(filename)) selectedCredFiles.delete(filename);
    else selectedCredFiles.add(filename);
    document.getElementById('selectedCount').textContent = selectedCredFiles.size > 0 ? `已选 ${selectedCredFiles.size}` : '全选';
}

function toggleSelectAll() {
    const checked = document.getElementById('selectAllCheckbox').checked;
    if (checked) {
        Object.values(filteredCredsData).forEach(c => selectedCredFiles.add(c.filename));
    } else {
        selectedCredFiles.clear();
    }
    renderCredsList();
    document.getElementById('selectedCount').textContent = checked ? `已选 ${selectedCredFiles.size}` : '全选';
}

async function batchAction(action) {
    if (selectedCredFiles.size === 0) return alert('请先选择文件');
    if (!confirm(`确定对 ${selectedCredFiles.size} 个文件执行 ${action} 吗？`)) return;
    
    try {
        const res = await fetch('/creds/batch-action', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action, filenames: Array.from(selectedCredFiles) })
        });
        const data = await res.json();
        showStatus(data.message || '批量操作完成', 'success');
        selectedCredFiles.clear();
        refreshCredsStatus();
    } catch (e) {
        showStatus(e.message, 'error');
    }
}

async function fetchUserEmail(filename) {
    try {
        const res = await fetch(`/creds/fetch-email/${filename}`, { method: 'POST', headers: getAuthHeaders() });
        if (res.ok) refreshCredsStatus();
        else showStatus('获取邮箱失败', 'error');
    } catch (e) { showStatus(e.message, 'error'); }
}

async function refreshAllEmails() {
    if(!confirm('刷新所有邮箱可能耗时较长，继续？')) return;
    try {
        const res = await fetch('/creds/refresh-all-emails', { method: 'POST', headers: getAuthHeaders() });
        const data = await res.json();
        showStatus(data.message, 'success');
        refreshCredsStatus();
    } catch (e) { showStatus(e.message, 'error'); }
}

// ===========================
// 使用统计 (Usage Tab)
// ===========================

async function refreshUsageStats() {
    const loader = document.getElementById('usageLoading');
    const list = document.getElementById('usageList');
    loader.classList.remove('hidden');
    list.innerHTML = '';

    try {
        const [statsRes, aggRes] = await Promise.all([
            fetch('/usage/stats', { headers: getAuthHeaders() }),
            fetch('/usage/aggregated', { headers: getAuthHeaders() })
        ]);
        
        const statsData = await statsRes.json();
        const aggData = await aggRes.json();
        
        // 更新顶部卡片
        document.getElementById('totalApiCalls').textContent = aggData.data.total_all_model_calls || 0;
        document.getElementById('geminiProCalls').textContent = aggData.data.total_pro_model_calls || 0;

        // 渲染列表
        Object.entries(statsData.data).forEach(([filename, stat]) => {
            const card = document.createElement('div');
            card.className = 'usage-card'; // 复用样式或新建
            card.style.background = 'var(--bg-card)';
            card.style.padding = '1rem';
            card.style.borderRadius = 'var(--radius-md)';
            card.style.border = '1px solid var(--border-color)';
            card.style.marginBottom = '1rem';
            
            const proPercent = Math.min((stat.pro_model_calls / (stat.daily_limit_pro_models || 75)) * 100, 100).toFixed(1);
            const totalPercent = Math.min((stat.total_calls / (stat.daily_limit_total || 600)) * 100, 100).toFixed(1);
            
            card.innerHTML = `
                <div style="font-weight:600; margin-bottom:0.5rem; color:var(--primary)">${filename}</div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.2rem">Pro Models: ${stat.pro_model_calls} / ${stat.daily_limit_pro_models}</div>
                <div class="progress-bar-container">
                    <div class="progress-fill blue" style="width: ${proPercent}%"></div>
                </div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.8rem; margin-bottom:0.2rem">Total: ${stat.total_calls} / ${stat.daily_limit_total}</div>
                <div class="progress-bar-container">
                    <div class="progress-fill orange" style="width: ${totalPercent}%"></div>
                </div>
                <div style="text-align:right; margin-top:0.5rem">
                    <button class="btn btn-sm btn-secondary" onclick="resetSingleUsage('${filename}')">重置</button>
                </div>
            `;
            list.appendChild(card);
        });

    } catch (e) {
        showStatus('统计加载失败', 'error');
    } finally {
        loader.classList.add('hidden');
    }
}

async function resetAllUsageStats() {
    if (!confirm('确定重置所有统计吗？')) return;
    try {
        await fetch('/usage/reset', { method: 'POST', headers: getAuthHeaders(), body: '{}' });
        refreshUsageStats();
        showStatus('已重置', 'success');
    } catch(e) { showStatus('失败', 'error'); }
}

async function resetSingleUsage(filename) {
    if (!confirm(`重置 ${filename}?`)) return;
    try {
        await fetch('/usage/reset', { 
            method: 'POST', headers: getAuthHeaders(), 
            body: JSON.stringify({ filename }) 
        });
        refreshUsageStats();
    } catch(e) { showStatus('失败', 'error'); }
}

// ===========================
// JSON 导入
// ===========================

function convertJsonToToml() {
    const input = document.getElementById('jsonInput').value;
    try {
        const data = JSON.parse(input);
        let toml = '';
        
        // 简单处理逻辑：如果是数组，遍历生成
        const items = Array.isArray(data) ? data : (data.creds ? Object.values(data.creds) : [data]);
        
        items.forEach(item => {
            const fname = item.filename || `cred-${Math.random().toString(36).substr(2,5)}.json`;
            const content = item.content || item;
            
            toml += `["${fname}"]\n`;
            if (content.client_id) toml += `client_id = "${content.client_id}"\n`;
            if (content.client_secret) toml += `client_secret = "${content.client_secret}"\n`;
            if (content.refresh_token) toml += `refresh_token = "${content.refresh_token}"\n`;
            if (content.type) toml += `type = "${content.type}"\n`;
            toml += '\n';
        });
        
        document.getElementById('tomlOutput').value = toml;
        document.getElementById('importBtn').disabled = false;
        showStatus('转换成功', 'success');
    } catch (e) {
        showStatus('JSON 格式错误', 'error');
    }
}

function clearImportForm() {
    document.getElementById('jsonInput').value = '';
    document.getElementById('tomlOutput').value = '';
    document.getElementById('importBtn').disabled = true;
}

function copyTomlOutput() {
    const el = document.getElementById('tomlOutput');
    el.select();
    document.execCommand('copy');
    showStatus('已复制', 'success');
}

async function importTomlToSystem() {
    const content = document.getElementById('tomlOutput').value;
    if (!content) return;
    if (!confirm('确认导入？')) return;
    
    try {
        const res = await fetch('/creds/import-toml', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        document.getElementById('importResult').textContent = JSON.stringify(data, null, 2);
        showStatus('导入完成', 'success');
    } catch (e) {
        showStatus(e.message, 'error');
    }
}

// ===========================
// 配置管理
// ===========================

async function loadConfig() {
    try {
        const res = await fetch('/config/get', { headers: getAuthHeaders() });
        const data = await res.json();
        const config = data.config;
        
        document.getElementById('configApiPassword').value = config.api_password || '';
        document.getElementById('configPanelPassword').value = config.panel_password || '';
        document.getElementById('configDailyLimitProModels').value = config.daily_limit_pro_models || 75;
        document.getElementById('configDailyLimitTotal').value = config.daily_limit_total || 600;
        
        // 处理锁定字段
        const locked = new Set(data.env_locked || []);
        if (locked.has('api_password')) document.getElementById('configApiPassword').disabled = true;
        // ... 其他锁定逻辑类似
        
    } catch (e) {
        showStatus('配置加载失败', 'error');
    }
}

async function saveConfig() {
    const config = {
        api_password: document.getElementById('configApiPassword').value,
        panel_password: document.getElementById('configPanelPassword').value,
        daily_limit_pro_models: parseInt(document.getElementById('configDailyLimitProModels').value),
        daily_limit_total: parseInt(document.getElementById('configDailyLimitTotal').value)
    };
    
    try {
        const res = await fetch('/config/save', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ config })
        });
        const data = await res.json();
        showStatus('保存成功', 'success');
        if (data.restart_required?.length) alert('部分配置需要重启生效');
    } catch (e) {
        showStatus(e.message, 'error');
    }
}

// 初始化
window.onload = function() {
    initTheme();
    // 检查是否有存储的 token (如果需要自动登录逻辑可在此扩展)
};