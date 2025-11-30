// OAuth认证相关功能模块
// OAuth单项认证相关变量
let currentAuthData = null;

// 批量认证相关变量
let currentBatchAuthData = null;
let batchResults = null;

// 开始单项认证
async function startSingleAuth() {
    const projectId = document.getElementById('projectId').value.trim();

    // 显示加载状态
    showAuthStatus('正在生成认证链接...', 'loading');

    try {
        const response = await fetch('/auth/start', {
            method: 'POST',
            headers: getPanelAuthHeaders(),
            body: JSON.stringify({
                project_id: projectId || undefined,
                get_all_projects: false
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                clearAuth();
                showAuthStatus('认证已过期、未登录或未成功，请重新登录', 'error');
                setTimeout(() => window.location.href = '/', 1000);
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        currentAuthData = data;

        // 显示认证链接
        document.getElementById('authUrl').value = data.auth_url;
        document.getElementById('authUrlSection').style.display = 'block';
        document.getElementById('callbackSection').style.display = 'block';

        // 根据检测结果显示不同提示
        let message = '认证链接已生成！';
        if (data.auto_project_detection && data.detected_project_id) {
            message += ` 已自动检测到项目ID: ${data.detected_project_id}`;
        } else if (projectId) {
            message += ` 使用指定项目ID: ${projectId}`;
        } else {
            message += ' 正在进行项目自动检测...';
        }

        showAuthStatus(message, 'success');

        // 自动滚动到认证链接部分
        document.getElementById('authUrlSection').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error('生成认证链接失败:', error);
        showAuthStatus(`生成认证链接失败: ${error.message}`, 'error');
    }
}

// 处理OAuth回调
async function handleCallback() {
    const callbackUrl = document.getElementById('callbackUrl').value.trim();
    const projectId = document.getElementById('projectId').value.trim() ||
                     document.getElementById('manualProjectId').value.trim();

    if (!callbackUrl) {
        showAuthStatus('请输入回调URL', 'error');
        return;
    }

    // 确认URL格式
    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showAuthStatus('回调URL格式不正确，请确保包含code和state参数', 'error');
        return;
    }

    showAuthStatus('正在获取OAuth凭证...', 'loading');

    try {
        const response = await fetch('/auth/callback-url', {
            method: 'POST',
            headers: getPanelAuthHeaders(),
            body: JSON.stringify({
                callback_url: callbackUrl,
                project_id: projectId || undefined,
                get_all_projects: false
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                clearAuth();
                showAuthStatus('认证已过期、未登录或未成功，请重新登录', 'error');
                setTimeout(() => window.location.href = '/', 1000);
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            // 处理需要手动输入项目ID的情况
            if (data.requires_manual_project_id) {
                showAuthStatus('自动检测项目ID失败，请在高级选项中手动输入项目ID后重试', 'warning');
                const advancedContent = document.getElementById('advancedOptionsContent');
                if (advancedContent) {
                    advancedContent.style.display = 'block';
                    const chevron = document.querySelector('.options-header i');
                    if (chevron) {
                        chevron.classList.add('rotated');
                    }
                }
                document.getElementById('manualProjectId').focus();
            } else {
                showAuthStatus(`获取凭证失败: ${data.error}`, 'error');
            }
            return;
        }

        // 显示凭证
        displayCredentials(data.credentials, data.file_path);
        showAuthStatus('OAuth凭证获取成功！', 'success');

    } catch (error) {
        console.error('处理回调失败:', error);
        showAuthStatus(`处理回调失败: ${error.message}`, 'error');
    }
}

// 显示凭证内容
function displayCredentials(credentials, filePath) {
    const credentialsSection = document.getElementById('credentialsSection');
    const credentialsContent = document.getElementById('credentialsContent');

    if (!credentialsSection || !credentialsContent) return;

    credentialsSection.style.display = 'block';
    credentialsContent.textContent = JSON.stringify(credentials, null, 2);

    // 滚动到凭证区域
    credentialsSection.scrollIntoView({ behavior: 'smooth' });

    // 保存文件路径用于下载
    credentialsSection.dataset.filePath = filePath;
}

// 复制认证链接
function copyAuthUrl() {
    const authUrlInput = document.getElementById('authUrl');
    if (!authUrlInput) return;
    authUrlInput.select();
    document.execCommand('copy');
    showNotification('认证链接已复制到剪贴板', 'success');
}

// 在浏览器中打开认证链接
function openAuthUrl() {
    const authUrl = document.getElementById('authUrl').value;
    if (authUrl) {
        window.open(authUrl, '_blank');
    }
}

// 下载凭证文件，当前获取本地JSON内容
async function downloadCredentials() {
    const credentialsSection = document.getElementById('credentialsSection');
    const credentialsContent = document.getElementById('credentialsContent').textContent;

    if (!credentialsSection || !credentialsContent) return;

    try {
        const blob = new Blob([credentialsContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `credentials_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification('凭证文件下载成功', 'success');
    } catch (error) {
        console.error('下载凭证文件失败:', error);
        showNotification('下载凭证文件失败', 'error');
    }
}

// 切换高级选项
function toggleAdvancedOptions() {
    const content = document.getElementById('advancedOptionsContent');
    const chevron = document.querySelector('.options-header i');

    if (!content || !chevron) return;

    if (content.style.display === 'none' || !content.style.display) {
        content.style.display = 'block';
        chevron.classList.add('rotated');
    } else {
        content.style.display = 'none';
        chevron.classList.remove('rotated');
    }
}

// 显示认证状态消息
function showAuthStatus(message, type) {
    const statusElement = document.getElementById('authStatus');
    if (!statusElement) return;

    statusElement.textContent = message;
    statusElement.className = `status-message status-${type}`;
    statusElement.style.display = 'block';

    if (type === 'success') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    } else if (type === 'error' || type === 'warning') {
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

// 开始批量认证
async function startBatchAuth() {
    const projectId = document.getElementById('batchProjectId').value.trim();
    const batchModeEnabled = document.getElementById('batchModeCheckbox').checked;

    if (!batchModeEnabled) {
        showBatchAuthStatus('请启用批量模式', 'error');
        return;
    }

    showBatchAuthStatus('正在生成批量认证链接...', 'loading');

    try {
        const response = await fetch('/auth/start', {
            method: 'POST',
            headers: getPanelAuthHeaders(),
            body: JSON.stringify({
                project_id: projectId || undefined,
                get_all_projects: true
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                clearAuth();
                showBatchAuthStatus('认证已过期、未登录或未成功，请重新登录', 'error');
                setTimeout(() => window.location.href = '/', 1000);
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        currentBatchAuthData = data;

        document.getElementById('batchAuthUrl').value = data.auth_url;
        document.getElementById('batchAuthUrlSection').style.display = 'block';
        document.getElementById('batchCallbackSection').style.display = 'block';

        let message = '批量认证链接已生成！';
        if (data.auto_project_detection && data.detected_project_id) {
            message += ` 已自动检测到项目ID: ${data.detected_project_id}`;
        } else if (projectId) {
            message += ` 使用指定项目ID: ${projectId}`;
        } else {
            message += ' 将为所有可访问项目获取凭证';
        }

        showBatchAuthStatus(message, 'success');
        document.getElementById('batchAuthUrlSection').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error('生成批量认证链接失败:', error);
        showBatchAuthStatus(`生成批量认证链接失败: ${error.message}`, 'error');
    }
}

// 处理批量OAuth回调
async function handleBatchCallback() {
    const callbackUrl = document.getElementById('batchCallbackUrl').value.trim();
    const projectId = document.getElementById('batchProjectId').value.trim();

    if (!callbackUrl) {
        showBatchAuthStatus('请输入回调URL', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showBatchAuthStatus('回调URL格式不正确，请确保包含code和state参数', 'error');
        return;
    }

    showBatchAuthStatus('正在批量获取OAuth凭证...', 'loading');

    try {
        const response = await fetch('/auth/callback-url', {
            method: 'POST',
            headers: getPanelAuthHeaders(),
            body: JSON.stringify({
                callback_url: callbackUrl,
                project_id: projectId || undefined,
                get_all_projects: true
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                clearAuth();
                showBatchAuthStatus('认证已过期、未登录或未成功，请重新登录', 'error');
                setTimeout(() => window.location.href = '/', 1000);
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            showBatchAuthStatus(`批量获取凭证失败: ${data.error}`, 'error');
            return;
        }

        batchResults = data;
        displayBatchResults(data.multiple_credentials);
        showBatchAuthStatus('批量OAuth凭证获取完成！', 'success');

    } catch (error) {
        console.error('处理批量回调失败:', error);
        showBatchAuthStatus(`处理批量回调失败: ${error.message}`, 'error');
    }
}

// 显示批量认证结果
function displayBatchResults(multipleCredentials) {
    const batchResultsSection = document.getElementById('batchResultsSection');
    const batchSummary = document.getElementById('batchSummary');
    const batchDetails = document.getElementById('batchDetails');

    if (!batchResultsSection || !batchSummary || !batchDetails) return;

    const { success, failed } = multipleCredentials;
    const totalCount = success.length + failed.length;
    const successCount = success.length;
    const failedCount = failed.length;

    batchSummary.innerHTML = `
        <div class="summary-stats">
            <div class="stat-item success">
                <i class="fas fa-check-circle"></i>
                <span class="stat-number">${successCount}</span>
                <span class="stat-label">成功获取凭证</span>
            </div>
            <div class="stat-item error">
                <i class="fas fa-times-circle"></i>
                <span class="stat-number">${failedCount}</span>
                <span class="stat-label">获取失败</span>
            </div>
            <div class="stat-item total">
                <i class="fas fa-layer-group"></i>
                <span class="stat-number">${totalCount}</span>
                <span class="stat-label">总项目数</span>
            </div>
        </div>
        <div class="summary-message">
            批量并发认证完成，成功率: ${totalCount > 0 ? ((successCount / totalCount) * 100).toFixed(1) : 0}%
        </div>
    `;

    let detailsHtml = '';

    if (success.length > 0) {
        detailsHtml += `
            <div class="result-section">
                <h4><i class="fas fa-check-circle text-success"></i> 成功获取凭证的项目(${success.length}个)</h4>
                <div class="project-list">
        `;

        success.forEach(project => {
            detailsHtml += `
                <div class="project-item success">
                    <div class="project-info">
                        <span class="project-name">${project.project_name || project.project_id}</span>
                        <span class="project-id">ID: ${project.project_id}</span>
                        <span class="file-path">保存位置: ${project.file_path}</span>
                    </div>
                    <div class="project-actions">
                        <button class="btn-sm btn-success" onclick="downloadSingleProjectCredential('${project.project_id}', '${project.file_path}')">
                            <i class="fas fa-download"></i> 下载
                        </button>
                    </div>
                </div>
            `;
        });

        detailsHtml += `
                </div>
            </div>
        `;
    }

    if (failed.length > 0) {
        detailsHtml += `
            <div class="result-section">
                <h4><i class="fas fa-times-circle text-error"></i> 获取失败的项目(${failed.length}个)</h4>
                <div class="project-list">
        `;

        failed.forEach(project => {
            detailsHtml += `
                <div class="project-item failed">
                    <div class="project-info">
                        <span class="project-name">${project.project_name || project.project_id}</span>
                        <span class="project-id">ID: ${project.project_id}</span>
                        <span class="error-message">错误: ${project.error}</span>
                    </div>
                    <div class="project-actions">
                        <button class="btn-sm btn-warning" onclick="retrySingleProject('${project.project_id}')">
                            <i class="fas fa-redo"></i> 重试
                        </button>
                    </div>
                </div>
            `;
        });

        detailsHtml += `
                </div>
            </div>
        `;
    }

    batchDetails.innerHTML = detailsHtml;
    batchResultsSection.style.display = 'block';
    batchResultsSection.scrollIntoView({ behavior: 'smooth' });
}

// 复制批量认证链接
function copyBatchAuthUrl() {
    const batchAuthUrlInput = document.getElementById('batchAuthUrl');
    if (!batchAuthUrlInput) return;
    batchAuthUrlInput.select();
    document.execCommand('copy');
    showNotification('批量认证链接已复制到剪贴板', 'success');
}

// 在浏览器中打开批量认证链接
function openBatchAuthUrl() {
    const batchAuthUrl = document.getElementById('batchAuthUrl').value;
    if (batchAuthUrl) {
        window.open(batchAuthUrl, '_blank');
    }
}

// 下载所有凭证
async function downloadAllCredentials() {
    if (!batchResults || !batchResults.multiple_credentials) {
        showNotification('没有可下载的凭证', 'error');
        return;
    }

    const successProjects = batchResults.multiple_credentials.success;

    try {
        for (let i = 0; i < successProjects.length; i++) {
            const project = successProjects[i];
            setTimeout(() => {
                downloadSingleProjectCredential(project.project_id, project.file_path);
            }, i * 100);
        }

        showNotification(`已开始下载 ${successProjects.length} 个项目的凭证文件`, 'success');
    } catch (error) {
        console.error('批量下载凭证失败:', error);
        showNotification('批量下载凭证失败', 'error');
    }
}

// 从filePath获取文件名
function getFilenameFromPath(filePath) {
    if (!filePath) return null;
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || null;
}

// 下载单个项目凭证：统一使用 /creds/download/{filename}
async function downloadSingleProjectCredential(projectId, filePath) {
    try {
        const filename = getFilenameFromPath(filePath);
        if (!filename) {
            showNotification(`无法解析项目 ${projectId} 凭证文件名`, 'error');
            return;
        }

        const response = await fetch(`/creds/download/${encodeURIComponent(filename)}`, {
            method: 'GET',
            headers: getPanelAuthHeaders({})
        });

        if (!response.ok) {
            throw new Error(`获取凭证失败: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`项目 ${projectId} 凭证下载成功`, 'success');
    } catch (error) {
        console.error(`下载项目 ${projectId} 凭证失败:`, error);
        showNotification(`下载项目 ${projectId} 凭证失败`, 'error');
    }
}

// 重试失败的项目
async function retryFailedProjects() {
    if (!batchResults || !batchResults.multiple_credentials.failed) {
        showNotification('没有需要重试的项目', 'warning');
        return;
    }

    showBatchAuthStatus('正在重试失败的项目...', 'loading');

    setTimeout(() => {
        showBatchAuthStatus('重试功能开发中，请手动重新认证失败的项目', 'warning');
    }, 1000);
}

// 重试单个项目
async function retrySingleProject(projectId) {
    switchModule('oauth');
    setTimeout(() => {
        switchToTab('single-login');
        document.getElementById('projectId').value = projectId;
        setTimeout(() => {
            startSingleAuth();
        }, 500);
    }, 100);
}

// 显示批量认证状态消息
function showBatchAuthStatus(message, type) {
    const statusElement = document.getElementById('batchAuthStatus');
    if (!statusElement) return;

    statusElement.textContent = message;
    statusElement.className = `status-message status-${type}`;
    statusElement.style.display = 'block';

    if (type === 'success') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    } else if (type === 'error' || type === 'warning') {
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

// 导出OAuth相关函数供HTML使用
window.startSingleAuth = startSingleAuth;
window.handleCallback = handleCallback;
window.copyAuthUrl = copyAuthUrl;
window.openAuthUrl = openAuthUrl;
window.downloadCredentials = downloadCredentials;
window.toggleAdvancedOptions = toggleAdvancedOptions;

// 导出批量认证相关函数供HTML使用
window.startBatchAuth = startBatchAuth;
window.handleBatchCallback = handleBatchCallback;
window.copyBatchAuthUrl = copyBatchAuthUrl;
window.openBatchAuthUrl = openBatchAuthUrl;
window.downloadAllCredentials = downloadAllCredentials;
window.downloadSingleProjectCredential = downloadSingleProjectCredential;
window.retryFailedProjects = retryFailedProjects;
window.retrySingleProject = retrySingleProject;