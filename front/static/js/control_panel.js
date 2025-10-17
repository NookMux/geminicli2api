        // ===========================
        // 控制面板 - 主要功能
        // ===========================

        let currentProjectId = '';
        let authInProgress = false;
        let authToken = '';
        let credsData = {};
        let uploadSelectedFiles = []; // 上传页面用的文件列表

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

        // WebSocket日志相关变量
        let logWebSocket = null;
        let allLogs = [];
        let filteredLogs = [];
        let currentLogFilter = 'all';

        // 使用统计相关变量
        let usageStatsData = {};
        let currentEditingFile = '';

        // 配置管理相关变量
        let currentConfig = {};
        let envLockedFields = new Set();

        // ===========================
        // 通用函数
        // ===========================

        function showStatus(message, type = 'info') {
            const statusSection = document.getElementById('statusSection');
            if (statusSection) {
                statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
                statusSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
                    document.getElementById('loginSection').classList.add('hidden');
                    document.getElementById('mainSection').classList.remove('hidden');
                    showStatus('登录成功', 'success');
                } else {
                    showStatus(`登录失败: ${data.detail || data.error || '密码错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        function handlePasswordEnter(event) {
            if (event.key === 'Enter') {
                login();
            }
        }

        // ===========================
        // 标签页切换
        // ===========================

        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            event.target.classList.add('active');
            document.getElementById(tabName + 'Tab').classList.add('active');

            if (tabName === 'upload') {
                // The upload tab is mostly static, maybe setup drag-drop here if not done globally
            }
            if (tabName === 'envload') {
                checkEnvCredsStatus();
            }
            if (tabName === 'manage') {
                refreshCredsStatus();
            }
            if (tabName === 'usage') {
                refreshUsageStats();
            }
            if (tabName === 'config') {
                loadConfig();
            }
            if (tabName === 'logs') {
                connectWebSocket();
            }
        }

        // ===========================
        // OAuth 认证流程
        // ===========================

        async function startAuth() {
            const projectId = document.getElementById('projectId').value.trim();
            const getAllProjects = document.getElementById('getAllProjectsCreds').checked;
            currentProjectId = projectId || null;

            const btn = document.getElementById('getAuthBtn');
            btn.disabled = true;
            btn.textContent = '正在获取认证链接...';

            try {
                const requestBody = {};
                if (projectId) {
                    requestBody.project_id = projectId;
                }
                if (getAllProjects) {
                    requestBody.get_all_projects = true;
                    showStatus('批量并发认证模式：将为当前账号所有项目生成认证链接...', 'info');
                } else if (projectId) {
                    showStatus('使用指定的项目ID生成认证链接...', 'info');
                } else {
                    showStatus('将尝试自动检测项目ID，正在生成认证链接...', 'info');
                }

                const response = await fetch('/auth/start', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (response.ok) {
                    document.getElementById('authUrl').href = data.auth_url;
                    document.getElementById('authUrl').textContent = data.auth_url;
                    document.getElementById('authUrlSection').classList.remove('hidden');

                    if (getAllProjects) {
                        showStatus('批量并发认证链接已生成，完成授权后将并发为所有可访问项目生成凭证文件', 'info');
                    } else if (data.auto_project_detection) {
                        showStatus('认证链接已生成（将在认证完成后自动检测项目ID），请点击链接完成授权', 'info');
                    } else {
                        showStatus(`认证链接已生成（项目ID: ${data.detected_project_id}），请点击链接完成授权`, 'info');
                    }
                    authInProgress = true;
                } else {
                    showStatus(`错误: ${data.error || '获取认证链接失败'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = '获取认证链接';
            }
        }

        async function getCredentials() {
            if (!authInProgress) {
                showStatus('请先获取认证链接并完成授权', 'error');
                return;
            }

            const btn = document.getElementById('getCredsBtn');
            const getAllProjects = document.getElementById('getAllProjectsCreds').checked;
            btn.disabled = true;
            btn.textContent = getAllProjects ? '并发批量获取所有项目凭证中...' : '等待OAuth回调中...';

            try {
                if (getAllProjects) {
                    showStatus('正在并发为所有项目获取认证凭证，采用并发处理提升速度...', 'info');
                } else {
                    showStatus('正在等待OAuth回调...', 'info');
                }

                const requestBody = {};
                if (currentProjectId) {
                    requestBody.project_id = currentProjectId;
                }
                if (getAllProjects) {
                    requestBody.get_all_projects = true;
                }

                const response = await fetch('/auth/callback', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (response.ok) {
                    const credentialsSection = document.getElementById('credentialsSection');
                    const credentialsContent = document.getElementById('credentialsContent');

                    if (getAllProjects && data.multiple_credentials) {
                        const results = data.multiple_credentials;
                        let resultText = `批量并发认证完成！成功为 ${results.success.length} 个项目生成凭证：\n\n`;

                        results.success.forEach((item, index) => {
                            resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                            resultText += `   文件: ${item.file_path}\n\n`;
                        });

                        if (results.failed.length > 0) {
                            resultText += `\n失败的项目 (${results.failed.length} 个):\n`;
                            results.failed.forEach((item, index) => {
                                resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                                resultText += `   错误: ${item.error}\n\n`;
                            });
                        }

                        credentialsContent.textContent = resultText;
                        showStatus(`✅ 批量并发认证完成！成功生成 ${results.success.length} 个项目的凭证文件${results.failed.length > 0 ? `，${results.failed.length} 个项目失败` : ''}`, 'success');
                    } else {
                        credentialsContent.textContent = JSON.stringify(data.credentials, null, 2);

                        if (data.auto_detected_project) {
                            showStatus(`✅ 认证成功！项目ID已自动检测为: ${data.credentials.project_id}，文件已保存到: ${data.file_path}`, 'success');
                        } else {
                            showStatus(`✅ 认证成功！文件已保存到: ${data.file_path}`, 'success');
                        }
                    }

                    credentialsSection.classList.remove('hidden');
                    authInProgress = false;
                } else {
                    if (data.requires_project_selection && data.available_projects) {
                        let projectOptions = "请选择一个项目：\n\n";
                        data.available_projects.forEach((project, index) => {
                            projectOptions += `${index + 1}. ${project.name} (${project.projectId})\n`;
                        });
                        projectOptions += `\n请输入序号 (1-${data.available_projects.length}):`;

                        const selection = prompt(projectOptions);
                        const projectIndex = parseInt(selection) - 1;

                        if (projectIndex >= 0 && projectIndex < data.available_projects.length) {
                            const selectedProject = data.available_projects[projectIndex];
                            currentProjectId = selectedProject.projectId;
                            btn.textContent = '重新尝试获取认证文件';
                            showStatus(`使用选择的项目 ${selectedProject.name} (${selectedProject.projectId}) 重新尝试...`, 'info');
                            setTimeout(() => getCredentials(), 1000);
                            return;
                        } else {
                            showStatus('无效的选择，请重新开始认证', 'error');
                        }
                    } else if (data.requires_manual_project_id) {
                        const userProjectId = prompt('无法自动检测项目ID，请手动输入您的Google Cloud项目ID:');
                        if (userProjectId && userProjectId.trim()) {
                            currentProjectId = userProjectId.trim();
                            btn.textContent = '重新尝试获取认证文件';
                            showStatus('使用手动输入的项目ID重新尝试...', 'info');
                            setTimeout(() => getCredentials(), 1000);
                            return;
                        } else {
                            showStatus('需要项目ID才能完成认证，请重新开始并输入正确的项目ID', 'error');
                        }
                    } else {
                        showStatus(`❌ 错误: ${data.error || '获取认证文件失败'}`, 'error');
                        if (data.error && data.error.includes('未接收到授权回调')) {
                            showStatus('提示：请确保已完成浏览器中的OAuth认证', 'info');
                        }
                    }
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = '获取认证文件';
            }
        }

        // ===========================
        // 折叠区域切换
        // ===========================

        function toggleProjectIdSection() {
            const section = document.getElementById('projectIdSection');
            const icon = document.getElementById('projectIdToggleIcon');

            if (section.style.display === 'none') {
                section.style.display = 'block';
                icon.style.transform = 'rotate(90deg)';
                icon.textContent = '▼';
            } else {
                section.style.display = 'none';
                icon.style.transform = 'rotate(0deg)';
                icon.textContent = '▶';
            }
        }

        function toggleCallbackUrlSection() {
            const section = document.getElementById('callbackUrlSection');
            const icon = document.getElementById('callbackUrlToggleIcon');

            if (section.style.display === 'none') {
                section.style.display = 'block';
                icon.style.transform = 'rotate(180deg)';
                icon.textContent = '▲';
            } else {
                section.style.display = 'none';
                icon.style.transform = 'rotate(0deg)';
                icon.textContent = '▼';
            }
        }

        // ===========================
        // 回调URL处理
        // ===========================

        async function processCallbackUrl() {
            const callbackUrlInput = document.getElementById('callbackUrlInput');
            const callbackUrl = callbackUrlInput.value.trim();
            const getAllProjects = document.getElementById('getAllProjectsCreds').checked;

            if (!callbackUrl) {
                showStatus('请输入回调URL', 'error');
                return;
            }

            if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
                showStatus('请输入有效的URL', 'error');
                return;
            }

            if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
                showStatus('❌ 这不是有效的回调URL！请确保URL包含code和state参数', 'error');
                return;
            }

            if (getAllProjects) {
                showStatus('正在从回调URL并发批量获取所有项目凭证...', 'info');
            } else {
                showStatus('正在从回调URL获取凭证...', 'info');
            }

            try {
                const projectIdInput = document.getElementById('projectId');
                const projectId = projectIdInput ? projectIdInput.value.trim() : null;

                const response = await fetch('/auth/callback-url', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        callback_url: callbackUrl,
                        project_id: projectId || null,
                        get_all_projects: getAllProjects
                    })
                });

                const result = await response.json();

                if (getAllProjects && result.multiple_credentials) {
                    const results = result.multiple_credentials;
                    let resultText = `批量并发认证完成！成功为 ${results.success.length} 个项目生成凭证：\n\n`;

                    results.success.forEach((item, index) => {
                        resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                        resultText += `   文件: ${item.file_path}\n\n`;
                    });

                    if (results.failed.length > 0) {
                        resultText += `\n失败的项目 (${results.failed.length} 个):\n`;
                        results.failed.forEach((item, index) => {
                            resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                            resultText += `   错误: ${item.error}\n\n`;
                        });
                    }

                    document.getElementById('credentialsContent').textContent = resultText;
                    document.getElementById('credentialsSection').classList.remove('hidden');
                    showStatus(`✅ 批量并发认证完成！成功生成 ${results.success.length} 个项目的凭证文件${results.failed.length > 0 ? `，${results.failed.length} 个项目失败` : ''}`, 'success');

                } else if (result.credentials) {
                    showStatus(result.message || '从回调URL获取凭证成功！', 'success');
                    document.getElementById('credentialsContent').innerHTML =
                        '<pre>' + JSON.stringify(result.credentials, null, 2) + '</pre>';
                    document.getElementById('credentialsSection').classList.remove('hidden');

                } else if (result.requires_manual_project_id) {
                    showStatus('需要手动指定项目ID，请在高级选项中填入Google Cloud项目ID后重试', 'error');
                } else if (result.requires_project_selection) {
                    let projectOptions = '<br><strong>可用项目：</strong><br>';
                    result.available_projects.forEach(project => {
                        projectOptions += `• ${project.name} (ID: ${project.projectId})<br>`;
                    });
                    showStatus('检测到多个项目，请在高级选项中指定项目ID：' + projectOptions, 'error');
                } else {
                    showStatus(result.error || '从回调URL获取凭证失败', 'error');
                }

                callbackUrlInput.value = '';
            } catch (error) {
                console.error('从回调URL获取凭证时出错:', error);
                showStatus(`从回调URL获取凭证失败: ${error.message}`, 'error');
            }
        }

        function handleGetAllProjectsChange() {
            const checkbox = document.getElementById('getAllProjectsCreds');
            const note = document.getElementById('allProjectsNote');
            const projectIdSection = document.getElementById('projectIdSection');
            const projectIdToggle = document.querySelector('[onclick="toggleProjectIdSection()"]');

            if (checkbox.checked) {
                note.style.display = 'block';
                if (projectIdSection.style.display !== 'none') {
                    toggleProjectIdSection();
                }
                projectIdToggle.style.opacity = '0.5';
                projectIdToggle.style.pointerEvents = 'none';
            } else {
                note.style.display = 'none';
                projectIdToggle.style.opacity = '1';
                projectIdToggle.style.pointerEvents = 'auto';
            }
        }

        // ===========================
        // 凭证文件管理
        // ===========================

        async function refreshCredsStatus() {
            const credsLoading = document.getElementById('credsLoading');
            const credsList = document.getElementById('credsList');

            try {
                credsLoading.style.display = 'block';
                credsList.innerHTML = '';

                const response = await fetch('/creds/status', {
                    method: 'GET',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    credsData = data.creds;
                    calculateStats();
                    updateStatsDisplay();
                    currentPage = 1;
                    applyFilters();
                    showStatus(`已加载 ${Object.keys(credsData).length} 个凭证文件`, 'success');
                } else {
                    showStatus(`加载失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                credsLoading.style.display = 'none';
            }
        }

        function calculateStats() {
            statsData = { total: 0, normal: 0, disabled: 0 };
            availableErrorCodes.clear();

            for (const [fullPath, credInfo] of Object.entries(credsData)) {
                statsData.total++;
                if (credInfo.status.disabled) {
                    statsData.disabled++;
                } else {
                    statsData.normal++;
                }

                if (credInfo.status.error_codes && credInfo.status.error_codes.length > 0) {
                    credInfo.status.error_codes.forEach(code => {
                        availableErrorCodes.add(code);
                    });
                }
            }

            updateErrorCodeBadges();
        }

        function updateErrorCodeBadges() {
            const errorCodeBadges = document.getElementById('errorCodeBadges');
            errorCodeBadges.innerHTML = '';

            if (availableErrorCodes.size === 0) {
                errorCodeBadges.innerHTML = '<span style="color: #4CAF50;">所有文件都无错误</span>';
                return;
            }

            const sortedCodes = Array.from(availableErrorCodes).sort((a, b) => a - b);
            sortedCodes.forEach(code => {
                const badge = document.createElement('span');
                badge.className = 'error-code-badge';
                badge.textContent = code;
                badge.onclick = () => filterByErrorCode(code);
                errorCodeBadges.appendChild(badge);
            });
        }

        function filterByErrorCode(code) {
            document.getElementById('errorCodeFilter').value = code.toString();
            applyFilters();
        }

        function updateStatsDisplay() {
            document.getElementById('statTotal').textContent = statsData.total;
            document.getElementById('statNormal').textContent = statsData.normal;
            document.getElementById('statDisabled').textContent = statsData.disabled;
        }

        function applyFilters() {
            const statusFilter = document.getElementById('statusFilter').value;
            const errorCodeFilter = document.getElementById('errorCodeFilter').value;
            currentFilter = statusFilter;
            currentErrorCodeFilter = errorCodeFilter;
            filteredCredsData = {};

            for (const [fullPath, credInfo] of Object.entries(credsData)) {
                let shouldInclude = false;

                switch (statusFilter) {
                    case 'all': shouldInclude = true; break;
                    case 'normal': shouldInclude = !credInfo.status.disabled; break;
                    case 'disabled': shouldInclude = credInfo.status.disabled; break;
                }

                if (!shouldInclude) continue;

                const errorCodes = credInfo.status.error_codes || [];
                switch (errorCodeFilter) {
                    case 'all': break;
                    case 'no-errors': shouldInclude = errorCodes.length === 0; break;
                    case 'has-errors': shouldInclude = errorCodes.length > 0; break;
                    default:
                        const targetCode = parseInt(errorCodeFilter);
                        if (!isNaN(targetCode)) {
                            shouldInclude = errorCodes.includes(targetCode);
                        }
                        break;
                }

                if (shouldInclude) {
                    filteredCredsData[fullPath] = credInfo;
                }
            }

            selectedCredFiles.clear();
            updateBatchControls();
            currentPage = 1;
            renderCredsList();
            updatePagination();
        }

        function getCurrentPageData() {
            const filteredEntries = Object.entries(filteredCredsData);
            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            return filteredEntries.slice(startIndex, endIndex);
        }

        function getTotalPages() {
            return Math.ceil(Object.keys(filteredCredsData).length / pageSize);
        }

        function renderCredsList() {
            const credsList = document.getElementById('credsList');
            credsList.innerHTML = '';

            const currentPageData = getCurrentPageData();

            if (currentPageData.length === 0) {
                const message = Object.keys(credsData).length === 0 ?
                    '暂无凭证文件' : '当前筛选条件下暂无数据';
                credsList.innerHTML = `<p style="text-align: center; color: #666;">${message}</p>`;
                document.getElementById('paginationContainer').style.display = 'none';
                return;
            }

            for (const [fullPath, credInfo] of currentPageData) {
                const card = createCredCard(fullPath, credInfo);
                credsList.appendChild(card);
            }

            document.getElementById('paginationContainer').style.display = getTotalPages() > 1 ? 'flex' : 'none';
            updateBatchControls();
        }

        function updatePagination() {
            const totalPages = getTotalPages();
            const totalItems = Object.keys(filteredCredsData).length;
            const startItem = (currentPage - 1) * pageSize + 1;
            const endItem = Math.min(currentPage * pageSize, totalItems);

            document.getElementById('paginationInfo').textContent =
                `第 ${currentPage} 页，共 ${totalPages} 页 (显示 ${startItem}-${endItem}，共 ${totalItems} 项)`;

            document.getElementById('prevPageBtn').disabled = currentPage <= 1;
            document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
        }

        function changePage(direction) {
            const totalPages = getTotalPages();
            const newPage = currentPage + direction;

            if (newPage >= 1 && newPage <= totalPages) {
                currentPage = newPage;
                renderCredsList();
                updatePagination();
            }
        }

        function changePageSize() {
            pageSize = parseInt(document.getElementById('pageSizeSelect').value);
            currentPage = 1;
            renderCredsList();
            updatePagination();
        }

        function createCredCard(fullPath, credInfo) {
            const div = document.createElement('div');
            const status = credInfo.status;
            const filename = credInfo.filename;

            let cardClass = 'cred-card';
            if (status.disabled) cardClass += ' disabled';
            div.className = cardClass;

            let statusBadges = '';
            if (status.disabled) {
                statusBadges += '<span class="status-badge disabled">已禁用</span>';
            } else {
                statusBadges += '<span class="status-badge enabled">已启用</span>';
            }

            if (status.error_codes && status.error_codes.length > 0) {
                statusBadges += `<span class="error-codes">错误码: ${status.error_codes.join(', ')}</span>`;
                const autoBanErrors = status.error_codes.filter(code => code === 400 || code === 403);
                if (autoBanErrors.length > 0 && status.disabled) {
                    statusBadges += `<span class="status-badge" style="background: linear-gradient(135deg, #F44336 0%, #D32F2F 100%);">AUTO_BAN</span>`;
                }
            } else {
                statusBadges += `<span class="status-badge" style="background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%);">无错误</span>`;
            }

            const pathId = btoa(encodeURIComponent(fullPath)).replace(/[+/=]/g, '_');

            let actionButtons = '';
            if (status.disabled) {
                actionButtons += `<button class="cred-btn enable" data-filename="${filename}" data-action="enable">启用</button>`;
            } else {
                actionButtons += `<button class="cred-btn disable" data-filename="${filename}" data-action="disable">禁用</button>`;
            }

            actionButtons += `
        <button class="cred-btn view" onclick="toggleCredDetails('${pathId}')">查看内容</button>
        <button class="cred-btn download" onclick="downloadCred('${filename}')">下载</button>
        <button class="cred-btn email" onclick="fetchUserEmail('${filename}')">查看账号邮箱</button>
        <button class="cred-btn delete" data-filename="${filename}" data-action="delete">删除</button>
    `;

            let emailInfo = '';
            if (credInfo.user_email) {
                emailInfo = `<div class="cred-email">${credInfo.user_email}</div>`;
            } else {
                emailInfo = `<div class="cred-email" style="color: #999; font-style: italic;">未获取邮箱</div>`;
            }

            div.innerHTML = `
        <div class="cred-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" class="file-checkbox" data-filename="${filename}" onchange="toggleFileSelection('${filename}')">
                <div>
                    <div class="cred-filename">${filename}</div>
                    ${emailInfo}
                </div>
            </div>
            <div class="cred-status">${statusBadges}</div>
        </div>
        <div class="cred-actions">${actionButtons}</div>
        <div class="cred-details" id="details-${pathId}">
            <div class="cred-content"></div>
        </div>
    `;

            const contentDiv = div.querySelector('.cred-content');
            if (credInfo.content) {
                contentDiv.textContent = JSON.stringify(credInfo.content, null, 2);
            } else {
                contentDiv.textContent = credInfo.error || '无法读取文件内容';
            }

            const actionButtonElements = div.querySelectorAll('[data-filename][data-action]');
            actionButtonElements.forEach(button => {
                button.addEventListener('click', function () {
                    const filename = this.getAttribute('data-filename');
                    const action = this.getAttribute('data-action');
                    if (action === 'delete') {
                        deleteCred(filename);
                    } else {
                        credAction(filename, action);
                    }
                });
            });

            return div;
        }

        async function credAction(filename, action) {
            try {
                const response = await fetch('/creds/action', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ filename: filename, action: action })
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message, 'success');
                    await refreshCredsStatus();
                } else {
                    showStatus(`操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        function toggleCredDetails(pathId) {
            const details = document.getElementById('details-' + pathId);
            if (details) {
                details.classList.toggle('show');
            }
        }

        async function downloadCred(filename) {
            try {
                const response = await fetch(`/creds/download/${filename}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    showStatus(`已下载文件: ${filename}`, 'success');
                } else {
                    const data = await response.json();
                    showStatus(`下载失败: ${data.error}`, 'error');
                }
            } catch (error) {
                showStatus(`下载失败: ${error.message}`, 'error');
            }
        }

        async function downloadAllCreds() {
            try {
                const response = await fetch('/creds/download-all', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = 'credentials.zip';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    showStatus('已下载所有凭证文件', 'success');
                } else {
                    const data = await response.json();
                    showStatus(`打包下载失败: ${data.error}`, 'error');
                }
            } catch (error) {
                showStatus(`打包下载失败: ${error.message}`, 'error');
            }
        }

        async function deleteCred(filename) {
            if (!confirm(`确定要删除凭证文件吗？\n${filename}`)) {
                return;
            }
            await credAction(filename, 'delete');
        }

        // ===========================
        // 批量操作
        // ===========================

        function toggleFileSelection(filename) {
            if (selectedCredFiles.has(filename)) {
                selectedCredFiles.delete(filename);
            } else {
                selectedCredFiles.add(filename);
            }
            updateBatchControls();
        }

        function toggleSelectAll() {
            const selectAllCheckbox = document.getElementById('selectAllCheckbox');
            const fileCheckboxes = document.querySelectorAll('.file-checkbox');

            if (selectAllCheckbox.checked) {
                fileCheckboxes.forEach(checkbox => {
                    const filename = checkbox.getAttribute('data-filename');
                    selectedCredFiles.add(filename);
                    checkbox.checked = true;
                });
            } else {
                selectedCredFiles.clear();
                fileCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                });
            }
            updateBatchControls();
        }

        function updateBatchControls() {
            const selectedCount = selectedCredFiles.size;
            const selectedCountElement = document.getElementById('selectedCount');
            const batchEnableBtn = document.getElementById('batchEnableBtn');
            const batchDisableBtn = document.getElementById('batchDisableBtn');
            const batchDeleteBtn = document.getElementById('batchDeleteBtn');
            const selectAllCheckbox = document.getElementById('selectAllCheckbox');

            selectedCountElement.textContent = `已选择 ${selectedCount} 项`;

            const hasSelection = selectedCount > 0;
            batchEnableBtn.disabled = !hasSelection;
            batchDisableBtn.disabled = !hasSelection;
            batchDeleteBtn.disabled = !hasSelection;

            const currentPageFileCount = document.querySelectorAll('.file-checkbox').length;
            const currentPageSelectedCount = Array.from(document.querySelectorAll('.file-checkbox'))
                .filter(checkbox => selectedCredFiles.has(checkbox.getAttribute('data-filename'))).length;

            if (currentPageSelectedCount === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (currentPageSelectedCount === currentPageFileCount) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
                selectAllCheckbox.checked = false;
            }

            document.querySelectorAll('.file-checkbox').forEach(checkbox => {
                const filename = checkbox.getAttribute('data-filename');
                checkbox.checked = selectedCredFiles.has(filename);
            });
        }

        async function batchAction(action) {
            const selectedFiles = Array.from(selectedCredFiles);

            if (selectedFiles.length === 0) {
                showStatus('请先选择要操作的文件', 'error');
                return;
            }

            let confirmMessage = '';
            switch (action) {
                case 'enable': confirmMessage = `确定要启用选中的 ${selectedFiles.length} 个文件吗？`; break;
                case 'disable': confirmMessage = `确定要禁用选中的 ${selectedFiles.length} 个文件吗？`; break;
                case 'delete': confirmMessage = `确定要删除选中的 ${selectedFiles.length} 个文件吗？\n注意：此操作不可恢复！`; break;
            }

            if (!confirm(confirmMessage)) {
                return;
            }

            try {
                showStatus(`正在执行批量${action === 'enable' ? '启用' : action === 'disable' ? '禁用' : '删除'}操作...`, 'info');

                const response = await fetch('/creds/batch-action', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ action: action, filenames: selectedFiles })
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(`批量操作完成：成功处理 ${data.success_count}/${selectedFiles.length} 个文件`, 'success');
                    selectedCredFiles.clear();
                    updateBatchControls();
                    await refreshCredsStatus();
                } else {
                    showStatus(`批量操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`批量操作网络错误: ${error.message}`, 'error');
            }
        }

        // ===========================
        // 邮箱相关
        // ===========================

        async function fetchUserEmail(filename) {
            try {
                showStatus('正在获取用户邮箱...', 'info');

                const response = await fetch(`/creds/fetch-email/${encodeURIComponent(filename)}`, {
                    method: 'POST',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok && data.user_email) {
                    showStatus(`成功获取邮箱: ${data.user_email}`, 'success');
                    await refreshCredsStatus();
                } else {
                    showStatus(data.message || '无法获取用户邮箱', 'error');
                }
            } catch (error) {
                showStatus(`获取邮箱失败: ${error.message}`, 'error');
            }
        }

        async function refreshAllEmails() {
            try {
                if (!confirm('确定要刷新所有凭证的用户邮箱吗？这可能需要一些时间。')) {
                    return;
                }

                showStatus('正在刷新所有用户邮箱...', 'info');

                const response = await fetch('/creds/refresh-all-emails', {
                    method: 'POST',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(`邮箱刷新完成：成功获取 ${data.success_count}/${data.total_count} 个邮箱地址`, 'success');
                    await refreshCredsStatus();
                } else {
                    showStatus(data.message || '邮箱刷新失败', 'error');
                }
            } catch (error) {
                showStatus(`邮箱刷新网络错误: ${error.message}`, 'error');
            }
        }

        // ===========================
        // 批量上传
        // ===========================

        function handleFileSelect(event) {
            const files = Array.from(event.target.files);
            addFiles(files);
        }

        function addFiles(files) {
            files.forEach(file => {
                if (file.type === 'application/json' || file.name.endsWith('.json') ||
                    file.type === 'application/zip' || file.name.endsWith('.zip')) {
                    if (!uploadSelectedFiles.find(f => f.name === file.name && f.size === file.size)) {
                        uploadSelectedFiles.push(file);
                    }
                } else {
                    showStatus(`文件 ${file.name} 格式不支持，只支持JSON和ZIP文件`, 'error');
                }
            });
            updateFileList();
        }

        function updateFileList() {
            const fileList = document.getElementById('fileList');
            const fileListSection = document.getElementById('fileListSection');

            if (uploadSelectedFiles.length === 0) {
                fileListSection.classList.add('hidden');
                return;
            }

            fileListSection.classList.remove('hidden');
            fileList.innerHTML = '';

            uploadSelectedFiles.forEach((file, index) => {
                const fileItem = document.createElement('div');
                fileItem.style.cssText = 'background-color: var(--surface-color); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); padding: 10px; margin: 5px 0; display: flex; justify-content: space-between; align-items: center;';
                const isZip = file.name.endsWith('.zip');
                const fileIcon = isZip ? '📦' : '📄';
                const fileType = isZip ? ' (ZIP压缩包)' : ' (JSON文件)';
                fileItem.innerHTML = `
                    <div>
                        <span style="font-family: var(--font-mono); color: var(--text-color); font-size: 14px;">${fileIcon} ${file.name}</span>
                        <span style="color: var(--text-color); font-size: 12px; margin-left: 10px;">(${formatFileSize(file.size)}${fileType})</span>
                    </div>
                    <button onclick="removeFile(${index})" style="background: var(--error-color); color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;">删除</button>
                `;
                fileList.appendChild(fileItem);
            });
        }

        function removeFile(index) {
            uploadSelectedFiles.splice(index, 1);
            updateFileList();
        }

        function clearFiles() {
            uploadSelectedFiles = [];
            updateFileList();
        }

        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        async function uploadFiles() {
            if (uploadSelectedFiles.length === 0) {
                showStatus('请选择要上传的文件', 'error');
                return;
            }

            const totalSize = uploadSelectedFiles.reduce((sum, file) => sum + file.size, 0);
            const maxSize = 200 * 1024 * 1024; // 200MB limit
            if (totalSize > maxSize) {
                showStatus(`文件总大小 ${(totalSize / 1024 / 1024).toFixed(1)}MB 超过限制 ${maxSize / 1024 / 1024}MB。请分批上传或删除部分文件。`, 'error');
                return;
            }

            for (const file of uploadSelectedFiles) {
                if (file.size > 5 * 1024 * 1024) {
                    showStatus(`文件 "${file.name}" 大小 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过单文件5MB限制`, 'error');
                    return;
                }
            }

            const progressSection = document.getElementById('uploadProgressSection');
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');

            progressSection.classList.remove('hidden');

            const formData = new FormData();
            uploadSelectedFiles.forEach(file => {
                formData.append('files', file);
            });

            const hasZipFiles = uploadSelectedFiles.some(file => file.name.endsWith('.zip'));
            if (hasZipFiles) {
                showStatus('正在上传并解压ZIP文件...', 'info');
            }

            try {
                const xhr = new XMLHttpRequest();
                xhr.timeout = 300000; // 5 minutes

                xhr.upload.onprogress = function (event) {
                    if (event.lengthComputable) {
                        const percentComplete = (event.loaded / event.total) * 100;
                        progressFill.style.width = percentComplete + '%';
                        progressText.textContent = Math.round(percentComplete) + '%';
                    }
                };

                xhr.onload = function () {
                    if (xhr.status === 200) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            showStatus(`成功上传 ${data.uploaded_count} 个文件`, 'success');
                            clearFiles();
                            progressSection.classList.add('hidden');
                        } catch (e) {
                            showStatus('上传失败: 服务器响应格式错误', 'error');
                        }
                    } else {
                        try {
                            const error = JSON.parse(xhr.responseText);
                            showStatus(`上传失败: ${error.detail || error.error || '未知错误'}`, 'error');
                        } catch (e) {
                            showStatus(`上传失败: HTTP ${xhr.status} - ${xhr.statusText || '未知错误'}`, 'error');
                        }
                    }
                };

                xhr.onerror = function () {
                    showStatus(`上传失败：连接中断。建议分批上传。`, 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.ontimeout = function () {
                    showStatus('上传失败：请求超时。请减少文件数量或检查网络连接', 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.open('POST', '/auth/upload');
                xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
                xhr.send(formData);

            } catch (error) {
                showStatus(`上传失败: ${error.message}`, 'error');
            }
        }

        function setupDragAndDrop() {
            const uploadArea = document.getElementById('uploadArea');
            if (uploadArea) {
                uploadArea.addEventListener('dragover', function (event) {
                    event.preventDefault();
                    uploadArea.style.borderColor = 'var(--primary-color)';
                    uploadArea.style.backgroundColor = 'var(--surface-color)';
                });

                uploadArea.addEventListener('dragleave', function (event) {
                    event.preventDefault();
                    uploadArea.style.borderColor = 'var(--border-color)';
                    uploadArea.style.backgroundColor = 'var(--surface-color)';
                });

                uploadArea.addEventListener('drop', function (event) {
                    event.preventDefault();
                    uploadArea.style.borderColor = 'var(--border-color)';
                    uploadArea.style.backgroundColor = 'var(--surface-color)';
                    const files = Array.from(event.dataTransfer.files);
                    addFiles(files);
                });
            }
        }

        // ===========================
        // 环境变量
        // ===========================

        async function checkEnvCredsStatus() {
            const envStatusLoading = document.getElementById('envStatusLoading');
            const envStatusContent = document.getElementById('envStatusContent');

            try {
                envStatusLoading.style.display = 'block';
                envStatusContent.classList.add('hidden');

                const response = await fetch('/auth/env-creds-status', {
                    method: 'GET',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    const envVarsList = document.getElementById('envVarsList');
                    if (Object.keys(data.available_env_vars).length > 0) {
                        envVarsList.textContent = Object.keys(data.available_env_vars).join(', ');
                    } else {
                        envVarsList.textContent = '未找到GCLI_CREDS_*环境变量';
                    }

                    const autoLoadStatus = document.getElementById('autoLoadStatus');
                    autoLoadStatus.textContent = data.auto_load_enabled ? '✅ 已启用' : '❌ 未启用';
                    autoLoadStatus.style.color = data.auto_load_enabled ? 'var(--success-color)' : 'var(--error-color)';

                    document.getElementById('envFilesCount').textContent = `${data.existing_env_files_count} 个文件`;

                    const envFilesList = document.getElementById('envFilesList');
                    if (data.existing_env_files.length > 0) {
                        envFilesList.textContent = data.existing_env_files.join(', ');
                    } else {
                        envFilesList.textContent = '无';
                    }

                    envStatusContent.classList.remove('hidden');
                    showStatus('环境变量状态检查完成', 'success');
                } else {
                    showStatus(`获取环境变量状态失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                envStatusLoading.style.display = 'none';
            }
        }

        async function loadEnvCredentials() {
            try {
                showStatus('正在从环境变量导入凭证...', 'info');

                const response = await fetch('/auth/load-env-creds', {
                    method: 'POST',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    if (data.loaded_count > 0) {
                        showStatus(`✅ 成功导入 ${data.loaded_count}/${data.total_count} 个凭证文件`, 'success');
                        setTimeout(() => checkEnvCredsStatus(), 1000);
                    } else {
                        showStatus(`⚠️ ${data.message}`, 'info');
                    }
                } else {
                    showStatus(`导入失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        async function clearEnvCredentials() {
            if (!confirm('确定要清除所有从环境变量导入的凭证文件吗？\n这将删除所有文件名以 "env-" 开头的认证文件。')) {
                return;
            }

            try {
                showStatus('正在清除环境变量凭证文件...', 'info');

                const response = await fetch('/auth/env-creds', {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(`✅ 成功删除 ${data.deleted_count} 个环境变量凭证文件`, 'success');
                    setTimeout(() => checkEnvCredsStatus(), 1000);
                } else {
                    showStatus(`清除失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // ===========================
        // 使用统计
        // ===========================

        async function refreshUsageStats() {
            const usageLoading = document.getElementById('usageLoading');
            const usageList = document.getElementById('usageList');

            try {
                usageLoading.style.display = 'block';
                usageList.innerHTML = '';

                const [statsResponse, aggregatedResponse] = await Promise.all([
                    fetch('/usage/stats', { method: 'GET', headers: getAuthHeaders() }),
                    fetch('/usage/aggregated', { method: 'GET', headers: getAuthHeaders() })
                ]);

                const statsData = await statsResponse.json();
                const aggregatedData = await aggregatedResponse.json();

                if (statsResponse.ok && aggregatedResponse.ok) {
                    usageStatsData = statsData.data;

                    document.getElementById('totalApiCalls').textContent = aggregatedData.data.total_all_model_calls || 0;
                    document.getElementById('geminiProCalls').textContent = aggregatedData.data.total_gemini_2_5_pro_calls || 0;
                    document.getElementById('totalFiles').textContent = aggregatedData.data.total_files || 0;

                    renderUsageList();
                    showStatus(`已加载 ${aggregatedData.data.total_files} 个文件的使用统计`, 'success');
                } else {
                    showStatus('加载使用统计失败', 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                usageLoading.style.display = 'none';
            }
        }

        function renderUsageList() {
            const usageList = document.getElementById('usageList');
            usageList.innerHTML = '';

            if (Object.keys(usageStatsData).length === 0) {
                usageList.innerHTML = '<p style="text-align: center; color: #666;">暂无使用统计数据</p>';
                return;
            }

            for (const [filename, stats] of Object.entries(usageStatsData)) {
                const card = createUsageCard(filename, stats);
                usageList.appendChild(card);
            }
        }

        function createUsageCard(filename, stats) {
            const div = document.createElement('div');
            div.className = 'usage-card';

            const geminiPercent = Math.min((stats.gemini_2_5_pro_calls / stats.daily_limit_gemini_2_5_pro) * 100, 100);
            const totalPercent = Math.min((stats.total_calls / stats.daily_limit_total) * 100, 100);

            function getProgressClass(percent) {
                if (percent >= 90) return 'danger';
                if (percent >= 70) return 'warning';
                return 'gemini';
            }

            function getTotalProgressClass(percent) {
                if (percent >= 90) return 'danger';
                if (percent >= 70) return 'warning';
                return 'total';
            }

            function formatTime(isoString) {
                if (!isoString) return '未知';
                try {
                    const date = new Date(isoString);
                    return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                } catch (e) {
                    return '格式错误';
                }
            }

            div.innerHTML = `
        <div class="usage-header">
            <div class="usage-filename">${filename}</div>
        </div>

        <div class="usage-progress">
            <div class="usage-progress-label">
                <span>Gemini 2.5 Pro</span>
                <span>${stats.gemini_2_5_pro_calls}/${stats.daily_limit_gemini_2_5_pro} (${geminiPercent.toFixed(1)}%)</span>
            </div>
            <div class="usage-progress-bar">
                <div class="usage-progress-fill ${getProgressClass(geminiPercent)}" style="width: ${geminiPercent}%"></div>
            </div>
        </div>

        <div class="usage-progress">
            <div class="usage-progress-label">
                <span>所有模型</span>
                <span>${stats.total_calls}/${stats.daily_limit_total} (${totalPercent.toFixed(1)}%)</span>
            </div>
            <div class="usage-progress-bar">
                <div class="usage-progress-fill ${getTotalProgressClass(totalPercent)}" style="width: ${totalPercent}%"></div>
            </div>
        </div>

        <div class="usage-info">
            <div class="usage-info-item" style="grid-column: 1 / -1;">
                <span class="usage-info-label">下次重置时间</span>
                <span class="usage-info-value">${formatTime(stats.next_reset_time)}</span>
            </div>
        </div>

        <div class="usage-actions">
            <button class="usage-btn limits" onclick="openLimitsModal('${filename}')">设置限制</button>
            <button class="usage-btn reset" onclick="resetSingleUsageStats('${filename}')">重置统计</button>
        </div>
    `;

            return div;
        }

        function openLimitsModal(filename) {
            const stats = usageStatsData[filename];
            if (!stats) {
                showStatus('找不到文件统计数据', 'error');
                return;
            }

            currentEditingFile = filename;
            document.getElementById('modalFilename').value = filename;
            document.getElementById('modalGeminiLimit').value = stats.daily_limit_gemini_2_5_pro;
            document.getElementById('modalTotalLimit').value = stats.daily_limit_total;
            document.getElementById('limitsModal').style.display = 'block';
        }

        function closeLimitsModal() {
            document.getElementById('limitsModal').style.display = 'none';
            currentEditingFile = '';
        }

        async function saveLimits() {
            const geminiLimit = parseInt(document.getElementById('modalGeminiLimit').value);
            const totalLimit = parseInt(document.getElementById('modalTotalLimit').value);

            if (isNaN(geminiLimit) || geminiLimit < 1) {
                showStatus('Gemini 2.5 Pro 限制必须是大于0的数字', 'error');
                return;
            }

            if (isNaN(totalLimit) || totalLimit < 1) {
                showStatus('总调用限制必须是大于0的数字', 'error');
                return;
            }

            try {
                const response = await fetch('/usage/update-limits', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        filename: currentEditingFile,
                        gemini_2_5_pro_limit: geminiLimit,
                        total_limit: totalLimit
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message, 'success');
                    closeLimitsModal();
                    await refreshUsageStats();
                } else {
                    showStatus(`设置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        async function resetSingleUsageStats(filename) {
            if (!confirm(`确定要重置 ${filename} 的使用统计吗？`)) {
                return;
            }

            try {
                const response = await fetch('/usage/reset', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ filename: filename })
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message, 'success');
                    await refreshUsageStats();
                } else {
                    showStatus(`重置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        async function resetAllUsageStats() {
            if (!confirm('确定要重置所有文件的使用统计吗？此操作不可恢复！')) {
                return;
            }

            try {
                const response = await fetch('/usage/reset', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({})
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message, 'success');
                    await refreshUsageStats();
                } else {
                    showStatus(`重置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // ===========================
        // 配置管理
        // ===========================

        async function loadConfig() {
            const configLoading = document.getElementById('configLoading');
            const configForm = document.getElementById('configForm');

            try {
                configLoading.style.display = 'block';
                configForm.classList.add('hidden');

                const response = await fetch('/config/get', {
                    method: 'GET',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    currentConfig = data.config;
                    envLockedFields = new Set(data.env_locked || []);
                    populateConfigForm();
                    configForm.classList.remove('hidden');
                    showStatus('配置加载成功', 'success');
                } else {
                    showStatus(`加载配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                configLoading.style.display = 'none';
            }
        }

        function populateConfigForm() {
            setConfigField('host', currentConfig.host || '0.0.0.0');
            setConfigField('port', currentConfig.port || 7861);
            setConfigField('configApiPassword', currentConfig.api_password || '');
            setConfigField('configPanelPassword', currentConfig.panel_password || '');
            setConfigField('configPassword', currentConfig.password || 'pwd');

            setConfigField('credentialsDir', currentConfig.credentials_dir || '');
            setConfigField('proxy', currentConfig.proxy || '');

            setConfigField('codeAssistEndpoint', currentConfig.code_assist_endpoint || '');
            setConfigField('oauthProxyUrl', currentConfig.oauth_proxy_url || '');
            setConfigField('googleapisProxyUrl', currentConfig.googleapis_proxy_url || '');
            setConfigField('resourceManagerApiUrl', currentConfig.resource_manager_api_url || '');
            setConfigField('serviceUsageApiUrl', currentConfig.service_usage_api_url || '');

            document.getElementById('autoBanEnabled').checked = Boolean(currentConfig.auto_ban_enabled);
            setConfigField('autoBanErrorCodes', (currentConfig.auto_ban_error_codes || []).join(','));

            setConfigField('callsPerRotation', currentConfig.calls_per_rotation || 10);

            document.getElementById('retry429Enabled').checked = Boolean(currentConfig.retry_429_enabled);
            setConfigField('retry429MaxRetries', currentConfig.retry_429_max_retries || 20);
            setConfigField('retry429Interval', currentConfig.retry_429_interval || 0.1);

            document.getElementById('compatibilityModeEnabled').checked = Boolean(currentConfig.compatibility_mode_enabled);

            setConfigField('antiTruncationMaxAttempts', currentConfig.anti_truncation_max_attempts || 3);
        }

        function setConfigField(fieldId, value) {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = value;

                const configKey = fieldId.replace(/([A-Z])/g, '_$1').toLowerCase();
                if (envLockedFields.has(configKey)) {
                    field.disabled = true;
                    field.classList.add('env-locked');
                } else {
                    field.disabled = false;
                    field.classList.remove('env-locked');
                }
            }
        }

        async function saveConfig() {
            try {
                const config = {
                    host: document.getElementById('host').value.trim(),
                    port: parseInt(document.getElementById('port').value) || 7861,
                    api_password: document.getElementById('configApiPassword').value.trim(),
                    panel_password: document.getElementById('configPanelPassword').value.trim(),
                    password: document.getElementById('configPassword').value.trim(),
                    code_assist_endpoint: document.getElementById('codeAssistEndpoint').value.trim(),
                    credentials_dir: document.getElementById('credentialsDir').value.trim(),
                    proxy: document.getElementById('proxy').value.trim(),
                    oauth_proxy_url: document.getElementById('oauthProxyUrl').value.trim(),
                    googleapis_proxy_url: document.getElementById('googleapisProxyUrl').value.trim(),
                    resource_manager_api_url: document.getElementById('resourceManagerApiUrl').value.trim(),
                    service_usage_api_url: document.getElementById('serviceUsageApiUrl').value.trim(),
                    auto_ban_enabled: document.getElementById('autoBanEnabled').checked,
                    auto_ban_error_codes: document.getElementById('autoBanErrorCodes').value
                        .split(',')
                        .map(code => parseInt(code.trim()))
                        .filter(code => !isNaN(code)),
                    calls_per_rotation: parseInt(document.getElementById('callsPerRotation').value) || 10,
                    retry_429_enabled: document.getElementById('retry429Enabled').checked,
                    retry_429_max_retries: parseInt(document.getElementById('retry429MaxRetries').value) || 20,
                    retry_429_interval: parseFloat(document.getElementById('retry429Interval').value) || 0.1,
                    compatibility_mode_enabled: document.getElementById('compatibilityModeEnabled').checked,
                    anti_truncation_max_attempts: parseInt(document.getElementById('antiTruncationMaxAttempts').value) || 3
                };

                const response = await fetch('/config/save', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ config: config })
                });

                const data = await response.json();

                if (response.ok) {
                    let message = '配置保存成功';

                    if (data.hot_updated && data.hot_updated.length > 0) {
                        message += `，以下配置已立即生效: ${data.hot_updated.join(', ')}`;
                    }

                    if (data.restart_required && data.restart_required.length > 0) {
                        message += `\n⚠️ 重启提醒: ${data.restart_notice}`;
                        showStatus(message, 'info');
                    } else {
                        showStatus(message, 'success');
                    }

                    setTimeout(() => loadConfig(), 1000);
                } else {
                    showStatus(`保存配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // 端点配置快速切换
        const mirrorUrls = {
            codeAssistEndpoint: 'https://gcli-api.sukaka.top/cloudcode-pa',
            oauthProxyUrl: 'https://gcli-api.sukaka.top/oauth2',
            googleapisProxyUrl: 'https://gcli-api.sukaka.top/googleapis',
            resourceManagerApiUrl: 'https://gcli-api.sukaka.top/cloudresourcemanager',
            serviceUsageApiUrl: 'https://gcli-api.sukaka.top/serviceusage'
        };

        const officialUrls = {
            codeAssistEndpoint: 'https://cloudcode-pa.googleapis.com',
            oauthProxyUrl: 'https://oauth2.googleapis.com',
            googleapisProxyUrl: 'https://www.googleapis.com',
            resourceManagerApiUrl: 'https://cloudresourcemanager.googleapis.com',
            serviceUsageApiUrl: 'https://serviceusage.googleapis.com'
        };

        function useMirrorUrls() {
            if (confirm('确定要将所有端点配置为镜像网址吗？')) {
                for (const [fieldId, url] of Object.entries(mirrorUrls)) {
                    const field = document.getElementById(fieldId);
                    if (field && !field.disabled) {
                        field.value = url;
                    }
                }
                showStatus('✅ 已切换到镜像网址配置，记得点击"保存配置"按钮保存设置', 'success');
            }
        }

        function restoreOfficialUrls() {
            if (confirm('确定要将所有端点配置为官方地址吗？')) {
                for (const [fieldId, url] of Object.entries(officialUrls)) {
                    const field = document.getElementById(fieldId);
                    if (field && !field.disabled) {
                        field.value = url;
                    }
                }
                showStatus('✅ 已切换到官方端点配置，记得点击"保存配置"按钮保存设置', 'success');
            }
        }

        // ===========================
        // 实时日志 (WebSocket)
        // ===========================

        function connectWebSocket() {
            if (logWebSocket && logWebSocket.readyState === WebSocket.OPEN) {
                showStatus('WebSocket已经连接', 'info');
                return;
            }

            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}/auth/logs/stream`;

                document.getElementById('connectionStatusText').textContent = '连接中...';
                document.getElementById('logConnectionStatus').className = 'status info';

                logWebSocket = new WebSocket(wsUrl);

                logWebSocket.onopen = function (event) {
                    document.getElementById('connectionStatusText').textContent = '已连接';
                    document.getElementById('logConnectionStatus').className = 'status success';
                    showStatus('日志流连接成功', 'success');
                    clearLogsDisplay();
                };

                logWebSocket.onmessage = function (event) {
                    const logLine = event.data;
                    if (logLine.trim()) {
                        allLogs.push(logLine);
                        if (allLogs.length > 1000) {
                            allLogs = allLogs.slice(-1000);
                        }
                        filterLogs();
                        if (document.getElementById('autoScroll').checked) {
                            const logContainer = document.getElementById('logContainer');
                            logContainer.scrollTop = logContainer.scrollHeight;
                        }
                    }
                };

                logWebSocket.onclose = function (event) {
                    document.getElementById('connectionStatusText').textContent = '连接断开';
                    document.getElementById('logConnectionStatus').className = 'status error';
                    showStatus('日志流连接断开', 'info');
                };

                logWebSocket.onerror = function (error) {
                    document.getElementById('connectionStatusText').textContent = '连接错误';
                    document.getElementById('logConnectionStatus').className = 'status error';
                    showStatus('日志流连接错误: ' + error, 'error');
                };

            } catch (error) {
                showStatus('创建WebSocket连接失败: ' + error.message, 'error');
                document.getElementById('connectionStatusText').textContent = '连接失败';
                document.getElementById('logConnectionStatus').className = 'status error';
            }
        }

        function disconnectWebSocket() {
            if (logWebSocket) {
                logWebSocket.close();
                logWebSocket = null;
                document.getElementById('connectionStatusText').textContent = '未连接';
                document.getElementById('logConnectionStatus').className = 'status info';
                showStatus('日志流连接已断开', 'info');
            }
        }

        function clearLogsDisplay() {
            allLogs = [];
            filteredLogs = [];
            document.getElementById('logContent').textContent = '日志已清空，等待新日志...';
        }

        async function downloadLogs() {
            try {
                const response = await fetch('/auth/logs/download', {
                    method: 'GET',
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'gcli2api_logs.txt';
                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename=(.+)/);
                        if (filenameMatch) {
                            filename = filenameMatch;
                        }
                    }

                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);

                    showStatus(`日志文件下载成功: ${filename}`, 'success');
                } else {
                    const errorText = await response.text();
                    let errorMsg = '下载失败';
                    try {
                        const errorData = JSON.parse(errorText);
                        errorMsg = errorData.detail || errorData.error || '未知错误';
                    } catch (e) {
                        errorMsg = errorText || '未知错误';
                    }
                    showStatus(`下载日志失败: ${errorMsg}`, 'error');
                }
            } catch (error) {
                showStatus(`下载日志时网络错误: ${error.message}`, 'error');
            }
        }

        async function clearLogs() {
            try {
                const response = await fetch('/auth/logs/clear', {
                    method: 'POST',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    clearLogsDisplay();
                    showStatus(data.message, 'success');
                } else {
                    showStatus(`清空日志失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                clearLogsDisplay();
                showStatus(`清空日志时网络错误: ${error.message}`, 'error');
            }
        }

        function filterLogs() {
            const filter = document.getElementById('logLevelFilter').value;
            currentLogFilter = filter;

            if (filter === 'all') {
                filteredLogs = [...allLogs];
            } else {
                filteredLogs = allLogs.filter(log => log.toUpperCase().includes(filter));
            }

            displayLogs();
        }

        function displayLogs() {
            const logContent = document.getElementById('logContent');
            if (filteredLogs.length === 0) {
                logContent.textContent = currentLogFilter === 'all' ?
                    '暂无日志...' : `暂无${currentLogFilter}级别的日志...`;
            } else {
                logContent.textContent = filteredLogs.join('\n');
            }
        }

        // ===========================
        // 页面初始化
        // ===========================

        window.onload = function () {
            const checkbox = document.getElementById('getAllProjectsCreds');
            if (checkbox) {
                checkbox.addEventListener('change', handleGetAllProjectsChange);
            }
            setupDragAndDrop();
            showStatus('请输入密码登录', 'info');
        };

        window.onclick = function (event) {
            const modal = document.getElementById('limitsModal');
            if (event.target == modal) {
                closeLimitsModal();
            }
        }