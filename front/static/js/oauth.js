// OAuth认证相关功能模块
// OAuth单项目认证相关变量
let currentAuthData = null;

// 批量认证相关变量
let currentBatchAuthData = null;
let batchResults = null;

// 开始单项目认证
async function startSingleAuth() {
    const projectId = document.getElementById('projectId').value.trim();
    const authStatus = document.getElementById('authStatus');

    // 显示加载状态
    showAuthStatus('正在生成认证链接...', 'loading');

    try {
        const response = await fetch('/auth/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                project_id: projectId || undefined,
                get_all_projects: false
            })
        });

        if (!response.ok) {
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
            message += ' 正在进行项目自动检测';
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

    // 验证URL格式
    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showAuthStatus('回调URL格式不正确，请确保包含code和state参数', 'error');
        return;
    }

    showAuthStatus('正在获取OAuth凭证...', 'loading');

    try {
        const response = await fetch('/auth/callback-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                callback_url: callbackUrl,
                project_id: projectId || undefined,
                get_all_projects: false
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            // 处理需要手动输入项目ID的情况
            if (data.requires_manual_project_id) {
                showAuthStatus('自动检测项目ID失败，请在高级选项中手动填写项目ID后重试', 'warning');
                // 展开高级选项
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

// 显示凭证
function displayCredentials(credentials, filePath) {
    const credentialsContent = document.getElementById('credentialsContent');
    const credentialsSection = document.getElementById('credentialsSection');

    // 格式化JSON显示
    credentialsContent.textContent = JSON.stringify(credentials, null, 2);
    credentialsSection.style.display = 'block';

    // 滚动到凭证区域
    credentialsSection.scrollIntoView({ behavior: 'smooth' });

    // 保存文件路径用于下载
    credentialsSection.dataset.filePath = filePath;
}

// 复制认证链接
function copyAuthUrl() {
    const authUrlInput = document.getElementById('authUrl');
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

// 下载凭证文件
async function downloadCredentials() {
    const credentialsSection = document.getElementById('credentialsSection');
    const filePath = credentialsSection.dataset.filePath;
    const credentialsContent = document.getElementById('credentialsContent').textContent;

    try {
        // 创建Blob对象
        const blob = new Blob([credentialsContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // 创建下载链接
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

    if (content.style.display === 'none') {
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

// 开始批量认证
async function startBatchAuth() {
    const projectId = document.getElementById('batchProjectId').value.trim();
    const batchModeEnabled = document.getElementById('batchModeCheckbox').checked;
    const authStatus = document.getElementById('batchAuthStatus');

    if (!batchModeEnabled) {
        showBatchAuthStatus('请启用批量模式', 'error');
        return;
    }

    // 显示加载状态
    showBatchAuthStatus('正在生成批量认证链接...', 'loading');

    try {
        const response = await fetch('/auth/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                project_id: projectId || undefined,
                get_all_projects: true
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        currentBatchAuthData = data;

        // 显示批量认证链接
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

        // 自动滚动到认证链接部分
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

    // 验证URL格式
    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showBatchAuthStatus('回调URL格式不正确，请确保包含code和state参数', 'error');
        return;
    }

    showBatchAuthStatus('正在批量获取OAuth凭证...', 'loading');

    try {
        const response = await fetch('/auth/callback-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                callback_url: callbackUrl,
                project_id: projectId || undefined,
                get_all_projects: true
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            showBatchAuthStatus(`批量获取凭证失败: ${data.error}`, 'error');
            return;
        }

        // 处理批量结果
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

    const { success, failed } = multipleCredentials;
    const totalCount = success.length + failed.length;
    const successCount = success.length;
    const failedCount = failed.length;

    // 显示汇总信息
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
                <span class="stat-label">总计项目数</span>
            </div>
        </div>
        <div class="summary-message">
            批量并发认证完成，成功率: ${((successCount / totalCount) * 100).toFixed(1)}%
        </div>
    `;

    // 显示详细结果
    let detailsHtml = '';

    if (success.length > 0) {
        detailsHtml += `
            <div class="result-section">
                <h4><i class="fas fa-check-circle text-success"></i> 成功获取凭证的项目 (${success.length}个)</h4>
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
                <h4><i class="fas fa-times-circle text-error"></i> 获取失败的项目 (${failed.length}个)</h4>
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

    // 滚动到结果区域
    batchResultsSection.scrollIntoView({ behavior: 'smooth' });
}

// 复制批量认证链接
function copyBatchAuthUrl() {
    const batchAuthUrlInput = document.getElementById('batchAuthUrl');
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
        // 创建一个包含所有凭证的ZIP文件（这里简化处理，分别下载每个文件）
        for (let i = 0; i < successProjects.length; i++) {
            const project = successProjects[i];
            // 为每个项目创建下载链接
            setTimeout(() => {
                downloadSingleProjectCredential(project.project_id, project.file_path);
            }, i * 100); // 错开下载时间避免浏览器阻止
        }

        showNotification(`已开始下载 ${successProjects.length} 个项目的凭证文件`, 'success');
    } catch (error) {
        console.error('批量下载凭证失败:', error);
        showNotification('批量下载凭证失败', 'error');
    }
}

// 下载单个项目凭证
async function downloadSingleProjectCredential(projectId, filePath) {
    try {
        // 这里应该调用后端API获取凭证文件内容
        // 暂时使用项目ID作为文件名
        const response = await fetch(`/credentials/${projectId}`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            throw new Error(`获取凭证失败: ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `credentials_${projectId}.json`;
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

    const failedProjects = batchResults.multiple_credentials.failed;

    showBatchAuthStatus('正在重试失败的项目...', 'loading');

    // 这里可以实现重试逻辑，暂时显示提示
    setTimeout(() => {
        showBatchAuthStatus('重试功能开发中，请手动重新认证失败的项目', 'warning');
    }, 1000);
}

// 重试单个项目
async function retrySingleProject(projectId) {
    // 切换到单项目登录页面
    switchModule('oauth');
    setTimeout(() => {
        switchToTab('single-login');

        // 填写项目ID
        document.getElementById('projectId').value = projectId;

        // 自动开始认证
        setTimeout(() => {
            startSingleAuth();
        }, 500);
    }, 100);
}

// 显示批量认证状态消息
function showBatchAuthStatus(message, type) {
    const statusElement = document.getElementById('batchAuthStatus');
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

// 获取认证token
function getAuthToken() {
    // 首先检查全局变量，然后检查sessionStorage，最后检查localStorage
    return window.authToken ||
           window.sessionStorage.getItem('authToken') ||
           localStorage.getItem('auth_token') || '';
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