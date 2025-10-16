        // 基础变量
        let authToken = '';
        let currentProjectId = '';
        let authInProgress = false;
        let uploadSelectedFiles = []; // 上传页面用的文件列表

        // 文件管理相关变量
        let credsData = {};
        let filteredCredsData = {};
        let currentPage = 1;
        let pageSize = 20;
        let currentFilter = 'all';
        let currentErrorCodeFilter = 'all';
        let selectedCredFiles = new Set(); // 选中的凭证文件名集合
        let availableErrorCodes = new Set(); // 所有可用的错误码
        let statsData = {
            total: 0,
            normal: 0,
            disabled: 0
        };

        // 使用统计相关变量
        let usageStatsData = {};
        let currentEditingFile = '';

        // 配置管理相关变量
        let currentConfig = {};
        let envLockedFields = new Set();

        // 实时日志相关变量
        let logWebSocket = null;
        let logStreamActive = false;
        let allLogMessages = [];
        let filteredLogMessages = [];
        let currentLogFilter = 'all';

        // 基础函数
        function showStatus(message, type = 'info') {
            const statusSection = document.getElementById('statusSection');
            if (statusSection) {
                statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
            }
        }

        // 登录相关函数
        async function login() {
            const password = document.getElementById('loginPassword').value;

            if (!password) {
                showStatus('请输入密码', 'error');
                return;
            }

            try {
                const response = await fetch('/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ password: password })
                });

                const data = await response.json();

                if (response.ok) {
                    authToken = data.token;
                    document.getElementById('loginSection').classList.add('hidden');
                    document.getElementById('mainSection').classList.remove('hidden');
                    showStatus('登录成功', 'success');
                } else {
                    showStatus(`登录失败: ${data.detail || data.error || '未知错误'}`, 'error');
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

        // 标签页切换
        function switchTab(tabName) {
            // 移除所有活动标签
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            // 激活选中标签
            event.target.classList.add('active');
            document.getElementById(tabName + 'Tab').classList.add('active');

            // 如果切换到环境变量页面，自动检查状态
            if (tabName === 'envload') {
                checkEnvCredsStatus();
            }
            // 如果切换到文件管理页面，自动加载数据
            if (tabName === 'manage') {
                refreshCredsStatus();
            }
            // 如果切换到使用统计页面，自动加载统计
            if (tabName === 'usage') {
                refreshUsageStats();
            }
            // 如果切换到配置管理页面，自动加载配置
            if (tabName === 'config') {
                loadConfig();
            }
            // 如果切换到日志页面，自动连接WebSocket
            if (tabName === 'logs') {
                startLogStream();
            }
            // 如果离开日志页面，断开WebSocket连接
            if (event.target.textContent !== '实时日志' && logStreamActive) {
                stopLogStream();
            }
        }

        // 获取认证头
        function getAuthHeaders() {
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            };
        }

        // OAuth相关函数
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
                    showStatus('正在等待OAuth回调，这可能需要一些时间...', 'info');
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
                        // 处理多项目认证结果
                        const results = data.multiple_credentials;
                        let resultText = `批量并发认证完成！成功为 ${results.success.length} 个项目生成凭证：\n\n`;

                        // 显示成功的项目
                        results.success.forEach((item, index) => {
                            resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                            resultText += `   文件: ${item.file_path}\n\n`;
                        });

                        // 显示失败的项目（如果有）
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
                        // 处理单项目认证结果
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
                    // 检查是否需要项目选择
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
                    }
                    // 检查是否需要手动输入项目ID
                    else if (data.requires_manual_project_id) {
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
                            showStatus('提示：请确保已完成浏览器中的OAuth认证，并看到了"OAuth authentication successful"页面', 'info');
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

        // Project ID 折叠切换函数
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

        // 回调URL输入区域折叠切换函数 (移动端)
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

        // 处理回调URL的函数 (移动端)
        async function processCallbackUrl() {
            const callbackUrlInput = document.getElementById('callbackUrlInput');
            const callbackUrl = callbackUrlInput.value.trim();
            const getAllProjects = document.getElementById('getAllProjectsCreds').checked;

            if (!callbackUrl) {
                showStatus('请输入回调URL', 'error');
                return;
            }

            // 简单验证URL格式
            if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
                showStatus('请输入有效的URL（以http://或https://开头）', 'error');
                return;
            }

            // 检查是否包含必要参数
            if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
                showStatus('❌ 无效的回调URL！请确保已完成OAuth授权并复制完整URL', 'error');
                return;
            }

            if (getAllProjects) {
                showStatus('正在从回调URL并发批量获取所有项目凭证...', 'info');
            } else {
                showStatus('正在从回调URL获取凭证...', 'info');
            }

            try {
                // 获取当前项目ID设置（如果有的话）
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
                    // 处理多项目认证结果
                    const results = result.multiple_credentials;
                    let resultText = `批量并发认证完成！成功为 ${results.success.length} 个项目生成凭证：\n\n`;

                    // 显示成功的项目
                    results.success.forEach((item, index) => {
                        resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                        resultText += `   文件: ${item.file_path}\n\n`;
                    });

                    // 显示失败的项目（如果有）
                    if (results.failed.length > 0) {
                        resultText += `\n失败的项目 (${results.failed.length} 个):\n`;
                        results.failed.forEach((item, index) => {
                            resultText += `${index + 1}. 项目: ${item.project_name} (${item.project_id})\n`;
                            resultText += `   错误: ${item.error}\n\n`;
                        });
                    }

                    // 显示结果
                    document.getElementById('credentialsContent').textContent = resultText;
                    document.getElementById('credentialsSection').classList.remove('hidden');
                    showStatus(`✅ 批量并发认证完成！成功生成 ${results.success.length} 个项目的凭证文件${results.failed.length > 0 ? `，${results.failed.length} 个项目失败` : ''}`, 'success');

                } else if (result.credentials) {
                    // 处理单项目认证结果
                    showStatus(result.message || '从回调URL获取凭证成功！', 'success');

                    // 显示凭证内容
                    document.getElementById('credentialsContent').innerHTML = JSON.stringify(result.credentials, null, 2);
                    document.getElementById('credentialsSection').classList.remove('hidden');

                } else if (result.requires_manual_project_id) {
                    showStatus('需要手动指定项目ID，请在高级选项中填入Google Cloud项目ID后重试', 'error');
                } else if (result.requires_project_selection) {
                    let projectOptions = '\n可用项目：\n';
                    result.available_projects.forEach(project => {
                        projectOptions += `• ${project.name} (ID: ${project.projectId})\n`;
                    });
                    showStatus('检测到多个项目，请在高级选项中指定项目ID：' + projectOptions, 'error');
                } else {
                    showStatus(result.error || '从回调URL获取凭证失败', 'error');
                }

                // 清空输入框
                callbackUrlInput.value = '';

                // 刷新凭证列表（如果有）
                setTimeout(() => {
                    if (typeof loadCredentialsStatus === 'function') {
                        loadCredentialsStatus();
                    }
                }, 1000);
            } catch (error) {
                console.error('从回调URL获取凭证时出错:', error);
                showStatus(`从回调URL获取凭证失败: ${error.message}`, 'error');
            }
        }

        // 文件上传相关函数
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
                fileItem.style.cssText = 'background-color: #f8f9fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 10px; margin: 5px 0; display: flex; justify-content: space-between; align-items: center;';
                const isZip = file.name.endsWith('.zip');
                const fileIcon = isZip ? '📦' : '📄';
                const fileType = isZip ? ' (ZIP压缩包)' : ' (JSON文件)';
                fileItem.innerHTML = `
                    <div>
                        <span style="font-family: monospace; color: #333; font-size: 14px;">${fileIcon} ${file.name}</span>
                        <span style="color: #666; font-size: 12px; margin-left: 10px;">(${formatFileSize(file.size)}${fileType})</span>
                    </div>
                    <button onclick="removeFile(${index})" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;">删除</button>
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
            if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
            return Math.round(bytes / (1024 * 1024)) + ' MB';
        }

        async function uploadFiles() {
            if (uploadSelectedFiles.length === 0) {
                showStatus('请选择要上传的文件', 'error');
                return;
            }

            // 检查文件大小
            const totalSize = uploadSelectedFiles.reduce((sum, file) => sum + file.size, 0);
            const maxSize = 200 * 1024 * 1024; // 200MB limit
            if (totalSize > maxSize) {
                showStatus(`文件总大小 ${(totalSize / 1024 / 1024).toFixed(1)}MB 超过限制 ${maxSize / 1024 / 1024}MB。请分批上传或删除部分文件。`, 'error');
                return;
            }

            // 检查单个文件大小
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

            // 检查是否有ZIP文件，给用户提示
            const hasZipFiles = uploadSelectedFiles.some(file => file.name.endsWith('.zip'));
            if (hasZipFiles) {
                showStatus('正在上传并解压ZIP文件...', 'info');
            }

            try {
                const xhr = new XMLHttpRequest();

                // 设置超时时间 (5分钟)
                xhr.timeout = 300000;

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
                    console.error('Upload XHR error:', {
                        readyState: xhr.readyState,
                        status: xhr.status,
                        statusText: xhr.statusText,
                        responseText: xhr.responseText,
                        fileCount: uploadSelectedFiles.length,
                        totalSize: (totalSize / 1024 / 1024).toFixed(1) + 'MB'
                    });
                    showStatus(`上传失败：连接中断 - 可能原因：文件过多(${uploadSelectedFiles.length}个)或网络不稳定。建议分批上传。`, 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.ontimeout = function () {
                    showStatus('上传失败：请求超时 - 文件处理时间过长，请减少文件数量或检查网络连接', 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.open('POST', '/auth/upload');
                xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
                xhr.send(formData);

            } catch (error) {
                showStatus(`上传失败: ${error.message}`, 'error');
            }
        }

        // 拖拽功能
        function setupDragAndDrop() {
            const uploadArea = document.getElementById('uploadArea');

            if (uploadArea) {
                uploadArea.addEventListener('dragover', function (event) {
                    event.preventDefault();
                    uploadArea.style.borderColor = '#4285f4';
                    uploadArea.style.backgroundColor = '#f0f8ff';
                });

                uploadArea.addEventListener('dragleave', function (event) {
                    event.preventDefault();
                    uploadArea.style.borderColor = '#ddd';
                    uploadArea.style.backgroundColor = '#fafafa';
                });

                uploadArea.addEventListener('drop', function (event) {
                    event.preventDefault();
                    uploadArea.style.borderColor = '#ddd';
                    uploadArea.style.backgroundColor = '#fafafa';

                    const files = Array.from(event.dataTransfer.files);
                    addFiles(files);
                });
            }
        }

        // 环境变量凭证管理相关函数
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
                    // 更新环境变量列表
                    const envVarsList = document.getElementById('envVarsList');
                    if (Object.keys(data.available_env_vars).length > 0) {
                        envVarsList.textContent = Object.keys(data.available_env_vars).join(', ');
                    } else {
                        envVarsList.textContent = '未找到GCLI_CREDS_*环境变量';
                    }

                    // 更新自动加载状态
                    const autoLoadStatus = document.getElementById('autoLoadStatus');
                    autoLoadStatus.textContent = data.auto_load_enabled ? '✅ 已启用' : '❌ 未启用';
                    autoLoadStatus.style.color = data.auto_load_enabled ? '#28a745' : '#dc3545';

                    // 更新已导入文件统计
                    const envFilesCount = document.getElementById('envFilesCount');
                    envFilesCount.textContent = `${data.existing_env_files_count} 个文件`;

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
                console.error('checkEnvCredsStatus error:', error);
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
                        // 刷新状态
                        setTimeout(() => checkEnvCredsStatus(), 1000);
                    } else {
                        showStatus(`⚠️ ${data.message}`, 'info');
                    }
                } else {
                    showStatus(`导入失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('loadEnvCredentials error:', error);
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
                    // 刷新状态
                    setTimeout(() => checkEnvCredsStatus(), 1000);
                } else {
                    showStatus(`清除失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('clearEnvCredentials error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // 凭证文件管理相关函数
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

                    // 计算统计数据
                    calculateStats();

                    // 更新统计显示
                    updateStatsDisplay();

                    // 应用筛选并显示第一页
                    currentPage = 1;
                    applyFilters();

                    showStatus(`已加载 ${Object.keys(credsData).length} 个凭证文件`, 'success');
                } else {
                    showStatus(`加载失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('refreshCredsStatus error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                credsLoading.style.display = 'none';
            }
        }

        // 计算统计数据
        function calculateStats() {
            statsData = {
                total: 0,
                normal: 0,
                disabled: 0
            };

            // 清空并重新收集错误码
            availableErrorCodes.clear();

            for (const [fullPath, credInfo] of Object.entries(credsData)) {
                statsData.total++;

                if (credInfo.status.disabled) {
                    statsData.disabled++;
                } else {
                    statsData.normal++;
                }

                // 收集错误码信息
                if (credInfo.status.error_codes && credInfo.status.error_codes.length > 0) {
                    credInfo.status.error_codes.forEach(code => {
                        availableErrorCodes.add(code);
                    });
                }
            }

            // 更新错误码快速筛选按钮
            updateErrorCodeBadges();
        }

        // 更新统计显示
        function updateStatsDisplay() {
            document.getElementById('statTotal').textContent = statsData.total;
            document.getElementById('statNormal').textContent = statsData.normal;
            document.getElementById('statDisabled').textContent = statsData.disabled;
        }

        // 更新错误码筛选快速按钮
        function updateErrorCodeBadges() {
            const errorCodeBadges = document.getElementById('errorCodeBadges');
            errorCodeBadges.innerHTML = '';

            if (availableErrorCodes.size === 0) {
                errorCodeBadges.innerHTML = '<span style="color: #28a745; font-size: 12px;">所有文件都无错误</span>';
                return;
            }

            const sortedCodes = Array.from(availableErrorCodes).sort((a, b) => a - b);
            sortedCodes.forEach(code => {
                const badge = document.createElement('button');
                badge.className = 'error-code-badge';
                badge.textContent = code;
                badge.onclick = () => filterByErrorCode(code);
                errorCodeBadges.appendChild(badge);
            });
        }

        // 按错误码快速筛选
        function filterByErrorCode(code) {
            document.getElementById('errorCodeFilter').value = code.toString();
            applyFilters();
        }

        // 应用筛选
        function applyFilters() {
            const statusFilter = document.getElementById('statusFilter').value;
            const errorCodeFilter = document.getElementById('errorCodeFilter').value;
            currentFilter = statusFilter;
            currentErrorCodeFilter = errorCodeFilter;
            filteredCredsData = {};

            for (const [fullPath, credInfo] of Object.entries(credsData)) {
                let shouldInclude = false;

                // 状态筛选
                switch (statusFilter) {
                    case 'all':
                        shouldInclude = true;
                        break;
                    case 'normal':
                        shouldInclude = !credInfo.status.disabled;
                        break;
                    case 'disabled':
                        shouldInclude = credInfo.status.disabled;
                        break;
                }

                // 如果状态筛选已经排除，跳过错误码筛选
                if (!shouldInclude) {
                    continue;
                }

                // 错误码筛选
                const errorCodes = credInfo.status.error_codes || [];
                switch (errorCodeFilter) {
                    case 'all':
                        // 保持当前状态
                        break;
                    case 'no-errors':
                        shouldInclude = errorCodes.length === 0;
                        break;
                    case 'has-errors':
                        shouldInclude = errorCodes.length > 0;
                        break;
                    default:
                        // 具体错误码筛选
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

            // 清空选择状态
            selectedCredFiles.clear();
            updateBatchControls();

            currentPage = 1;
            renderCredsList();
            updatePagination();
        }

        // 获取当前页数据
        function getCurrentPageData() {
            const filteredEntries = Object.entries(filteredCredsData);
            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            return filteredEntries.slice(startIndex, endIndex);
        }

        // 获取总页数
        function getTotalPages() {
            return Math.ceil(Object.keys(filteredCredsData).length / pageSize);
        }

        // 渲染凭证列表
        function renderCredsList() {
            const credsList = document.getElementById('credsList');
            credsList.innerHTML = '';

            const currentPageData = getCurrentPageData();

            if (currentPageData.length === 0) {
                const message = Object.keys(credsData).length === 0 ?
                    '暂无凭证文件' : '当前筛选条件下暂无数据';
                credsList.innerHTML = `<p style="text-align: center; color: #666; padding: 20px;">${message}</p>`;
                document.getElementById('paginationContainer').style.display = 'none';
                return;
            }

            for (const [fullPath, credInfo] of currentPageData) {
                const card = createCredCard(fullPath, credInfo);
                credsList.appendChild(card);
            }

            document.getElementById('paginationContainer').style.display = getTotalPages() > 1 ? 'block' : 'none';

            // 更新批量控件状态
            updateBatchControls();
        }

        // 更新分页信息
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

        // 切换页面
        function changePage(direction) {
            const totalPages = getTotalPages();
            const newPage = currentPage + direction;

            if (newPage >= 1 && newPage <= totalPages) {
                currentPage = newPage;
                renderCredsList();
                updatePagination();
            }
        }

        // 改变每页显示数量
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

            // 设置卡片样式
            div.className = 'card';
            if (status.disabled) {
                div.style.opacity = '0.7';
                div.style.backgroundColor = '#f5f5f5';
            }

            // 创建状态标签
            let statusBadges = '';
            if (status.disabled) {
                statusBadges += '<span style="background-color: #6c757d; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px; margin-right: 5px;">已禁用</span>';
            } else {
                statusBadges += '<span style="background-color: #28a745; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px; margin-right: 5px;">已启用</span>';
            }

            if (status.error_codes && status.error_codes.length > 0) {
                statusBadges += `<span style="background-color: #dc3545; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px; margin-right: 5px;">错误码: ${status.error_codes.join(', ')}</span>`;
            } else {
                statusBadges += '<span style="background-color: #28a745; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px;">无错误</span>';
            }

            // 为HTML ID生成安全的标识符
            const pathId = btoa(encodeURIComponent(fullPath)).replace(/[+/=]/g, '_');

            // 构建邮箱显示
            let emailInfo = '';
            if (credInfo.user_email) {
                emailInfo = `<div style="font-size: 12px; color: #666; margin-top: 2px;">${credInfo.user_email}</div>`;
            }

            div.innerHTML = `
                <div class="card-header">
                    <div class="file-selection-area">
                        <input type="checkbox" class="file-checkbox" data-filename="${filename}" onchange="toggleFileSelection('${filename}')" style="margin-top: 2px; transform: scale(1.2);">
                        <div style="flex: 1;">
                            <div class="card-title">${filename}</div>
                            ${emailInfo}
                        </div>
                    </div>
                    <div style="font-size: 12px; margin-top: 5px;">${statusBadges}</div>
                </div>
                <div class="card-actions">
                    ${status.disabled ?
                    `<button class="btn-small" onclick="credAction('${filename}', 'enable')" style="background-color: #28a745;">启用</button>` :
                    `<button class="btn-small" onclick="credAction('${filename}', 'disable')" style="background-color: #6c757d;">禁用</button>`
                }
                    <button class="btn-small" onclick="toggleCredDetails('${pathId}')" style="background-color: #17a2b8;">查看</button>
                    <button class="btn-small" onclick="downloadCred('${filename}')" style="background-color: #007bff;">下载</button>
                    <button class="btn-small" onclick="fetchUserEmail('${filename}')" style="background-color: #17a2b8;">邮箱</button>
                    <button class="btn-small" onclick="deleteCred('${filename}')" style="background-color: #dc3545;">删除</button>
                </div>
                <div id="details-${pathId}" style="display: none; margin-top: 10px; background-color: #f0f8ff; border: 1px solid #b0d4ff; border-radius: 6px; padding: 10px; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto;"></div>
            `;

            // 设置文件内容
            const contentDiv = div.querySelector(`#details-${pathId}`);
            if (credInfo.content) {
                contentDiv.textContent = JSON.stringify(credInfo.content, null, 2);
            } else {
                contentDiv.textContent = credInfo.error || '无法读取文件内容';
            }

            return div;
        }

        async function credAction(filename, action) {
            try {
                const requestBody = {
                    filename: filename,
                    action: action
                };

                const response = await fetch('/creds/action', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message, 'success');
                    await refreshCredsStatus(); // 刷新状态
                } else {
                    showStatus(`操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('credAction error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        function toggleCredDetails(pathId) {
            const detailsId = 'details-' + pathId;
            const details = document.getElementById(detailsId);
            if (details) {
                details.style.display = details.style.display === 'none' ? 'block' : 'none';
            }
        }

        async function downloadCred(filename) {
            try {
                const response = await fetch(`/creds/download/${filename}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    }
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
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    }
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

        // 批量操作相关函数
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
                // 全选当前页面的文件
                fileCheckboxes.forEach(checkbox => {
                    const filename = checkbox.getAttribute('data-filename');
                    selectedCredFiles.add(filename);
                    checkbox.checked = true;
                });
            } else {
                // 取消全选
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

            // 启用/禁用批量操作按钮
            const hasSelection = selectedCount > 0;
            batchEnableBtn.disabled = !hasSelection;
            batchDisableBtn.disabled = !hasSelection;
            batchDeleteBtn.disabled = !hasSelection;

            // 更新全选复选框状态
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

            // 更新页面上的复选框状态
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
                case 'enable':
                    confirmMessage = `确定要启用选中的 ${selectedFiles.length} 个文件吗？`;
                    break;
                case 'disable':
                    confirmMessage = `确定要禁用选中的 ${selectedFiles.length} 个文件吗？`;
                    break;
                case 'delete':
                    confirmMessage = `确定要删除选中的 ${selectedFiles.length} 个文件吗？\n注意：此操作不可恢复！`;
                    break;
            }

            if (!confirm(confirmMessage)) {
                return;
            }

            try {
                showStatus(`正在执行批量${action === 'enable' ? '启用' : action === 'disable' ? '禁用' : '删除'}操作...`, 'info');

                const requestBody = {
                    action: action,
                    filenames: selectedFiles
                };

                const response = await fetch('/creds/batch-action', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(`批量操作完成：成功处理 ${data.success_count}/${selectedFiles.length} 个文件`, 'success');

                    // 清空选择
                    selectedCredFiles.clear();
                    updateBatchControls();

                    // 刷新列表
                    await refreshCredsStatus();
                } else {
                    showStatus(`批量操作失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('batchAction error:', error);
                showStatus(`批量操作网络错误: ${error.message}`, 'error');
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
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(`邮箱刷新完成：成功获取 ${data.success_count}/${data.total_count} 个邮箱地址`, 'success');
                    // 刷新凭证状态以更新显示
                    await refreshCredsStatus();
                } else {
                    showStatus(data.message || '邮箱刷新失败', 'error');
                }
            } catch (error) {
                console.error('refreshAllEmails error:', error);
                showStatus(`邮箱刷新网络错误: ${error.message}`, 'error');
            }
        }

        // 邮箱相关函数
        async function fetchUserEmail(filename) {
            try {
                showStatus('正在获取用户邮箱...', 'info');

                const response = await fetch(`/creds/fetch-email/${encodeURIComponent(filename)}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (response.ok && data.user_email) {
                    showStatus(`成功获取邮箱: ${data.user_email}`, 'success');
                    // 刷新凭证状态以更新显示
                    await refreshCredsStatus();
                } else {
                    showStatus(data.message || '无法获取用户邮箱', 'error');
                }
            } catch (error) {
                console.error('fetchUserEmail error:', error);
                showStatus(`获取邮箱失败: ${error.message}`, 'error');
            }
        }

        // =====================================================================
        // 使用统计相关函数
        // =====================================================================

        // 刷新使用统计
        async function refreshUsageStats() {
            const usageLoading = document.getElementById('usageLoading');
            const usageList = document.getElementById('usageList');

            try {
                usageLoading.style.display = 'block';
                usageList.innerHTML = '';

                // 获取所有文件的使用统计
                const [statsResponse, aggregatedResponse] = await Promise.all([
                    fetch('/usage/stats', {
                        method: 'GET',
                        headers: getAuthHeaders()
                    }),
                    fetch('/usage/aggregated', {
                        method: 'GET',
                        headers: getAuthHeaders()
                    })
                ]);

                const statsData = await statsResponse.json();
                const aggregatedData = await aggregatedResponse.json();

                if (statsResponse.ok && aggregatedResponse.ok) {
                    usageStatsData = statsData.data;

                    // 更新概览统计
                    document.getElementById('totalApiCalls').textContent = aggregatedData.data.total_all_model_calls || 0;
                    document.getElementById('geminiProCalls').textContent = aggregatedData.data.total_gemini_2_5_pro_calls || 0;
                    document.getElementById('totalFiles').textContent = aggregatedData.data.total_files || 0;

                    // 渲染使用统计列表
                    renderUsageList();

                    showStatus(`已加载 ${aggregatedData.data.total_files} 个文件的使用统计`, 'success');
                } else {
                    showStatus('加载使用统计失败', 'error');
                }
            } catch (error) {
                console.error('refreshUsageStats error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                usageLoading.style.display = 'none';
            }
        }

        // 渲染使用统计列表
        function renderUsageList() {
            const usageList = document.getElementById('usageList');
            usageList.innerHTML = '';

            if (Object.keys(usageStatsData).length === 0) {
                usageList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">暂无使用统计数据</p>';
                return;
            }

            for (const [filename, stats] of Object.entries(usageStatsData)) {
                const card = createUsageCard(filename, stats);
                usageList.appendChild(card);
            }
        }

        // 创建使用统计卡片
        function createUsageCard(filename, stats) {
            const div = document.createElement('div');
            div.className = 'card';
            div.style.marginBottom = '15px';

            // 计算使用百分比
            const geminiPercent = Math.min((stats.gemini_2_5_pro_calls / stats.daily_limit_gemini_2_5_pro) * 100, 100);
            const totalPercent = Math.min((stats.total_calls / stats.daily_limit_total) * 100, 100);

            // 确定进度条颜色
            function getProgressClass(percent) {
                if (percent >= 90) return '#dc3545';
                if (percent >= 70) return '#ffc107';
                return '#ff6b35';
            }

            function getTotalProgressClass(percent) {
                if (percent >= 90) return '#dc3545';
                if (percent >= 70) return '#ffc107';
                return '#007bff';
            }

            // 格式化时间
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
                <div class="card-header">
                    <div class="card-title" style="margin-bottom: 10px;">${filename}</div>
                </div>
                
                <div style="margin: 10px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 12px;">
                        <span>Gemini 2.5 Pro</span>
                        <span>${stats.gemini_2_5_pro_calls}/${stats.daily_limit_gemini_2_5_pro} (${geminiPercent.toFixed(1)}%)</span>
                    </div>
                    <div class="progress-bar" style="height: 8px;">
                        <div style="width: ${geminiPercent}%; height: 100%; background-color: ${getProgressClass(geminiPercent)}; transition: width 0.3s ease;"></div>
                    </div>
                </div>
                
                <div style="margin: 10px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 12px;">
                        <span>所有模型</span>
                        <span>${stats.total_calls}/${stats.daily_limit_total} (${totalPercent.toFixed(1)}%)</span>
                    </div>
                    <div class="progress-bar" style="height: 8px;">
                        <div style="width: ${totalPercent}%; height: 100%; background-color: ${getTotalProgressClass(totalPercent)}; transition: width 0.3s ease;"></div>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; font-size: 11px;">
                    <div style="background-color: #f8f9fa; padding: 6px; border-radius: 4px; border: 1px solid #dee2e6;">
                        <div style="font-weight: bold; color: #666; margin-bottom: 2px;">下次重置时间</div>
                        <div style="color: #333;">${formatTime(stats.next_reset_time)}</div>
                    </div>
                </div>
                
                <div class="card-actions">
                    <button class="btn-small" onclick="openLimitsModal('${filename}')" style="background-color: #17a2b8;">设置限制</button>
                    <button class="btn-small" onclick="resetSingleUsageStats('${filename}')" style="background-color: #6c757d;">重置统计</button>
                </div>
            `;

            return div;
        }

        // 打开限制设置弹窗
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

        // 关闭限制设置弹窗
        function closeLimitsModal() {
            document.getElementById('limitsModal').style.display = 'none';
            currentEditingFile = '';
        }

        // 保存限制设置
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
                    // 刷新统计数据
                    await refreshUsageStats();
                } else {
                    showStatus(`设置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('saveLimits error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // 重置单个文件的使用统计
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
                console.error('resetSingleUsageStats error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // 重置所有使用统计
        async function resetAllUsageStats() {
            if (!confirm('确定要重置所有文件的使用统计吗？此操作不可恢复！')) {
                return;
            }

            try {
                const response = await fetch('/usage/reset', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({})  // 不提供filename表示重置所有
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message, 'success');
                    await refreshUsageStats();
                } else {
                    showStatus(`重置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('resetAllUsageStats error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // 关闭弹窗当点击弹窗外部时
        window.onclick = function (event) {
            const modal = document.getElementById('limitsModal');
            if (event.target == modal) {
                closeLimitsModal();
            }
        }

        // =====================================================================
        // 配置管理相关函数  
        // =====================================================================

        // 加载配置
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
                    populateConfigForm(currentConfig);
                    configForm.classList.remove('hidden');
                    showStatus('配置加载成功', 'success');
                } else {
                    showStatus(`加载配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('loadConfig error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            } finally {
                configLoading.style.display = 'none';
            }
        }

        // 填充配置表单
        function populateConfigForm(config) {
            // 服务器配置
            setFieldValue('host', config.host);
            setFieldValue('port', config.port);
            setFieldValue('configApiPassword', config.api_password);
            setFieldValue('configPanelPassword', config.panel_password);
            setFieldValue('configPassword', config.password);

            // 基础配置
            setFieldValue('credentialsDir', config.credentials_dir);
            setFieldValue('proxy', config.proxy);

            // 端点配置
            setFieldValue('codeAssistEndpoint', config.code_assist_endpoint);
            setFieldValue('oauthProxyUrl', config.oauth_proxy_url);
            setFieldValue('googleapisProxyUrl', config.googleapis_proxy_url);
            setFieldValue('resourceManagerApiUrl', config.resource_manager_api_url);
            setFieldValue('serviceUsageApiUrl', config.service_usage_api_url);

            // 自动封禁配置
            setCheckboxValue('autoBanEnabled', config.auto_ban_enabled);
            setFieldValue('autoBanErrorCodes', Array.isArray(config.auto_ban_error_codes) ? config.auto_ban_error_codes.join(',') : config.auto_ban_error_codes);

            // 性能配置
            setFieldValue('callsPerRotation', config.calls_per_rotation);

            // 429重试配置
            setCheckboxValue('retry429Enabled', config.retry_429_enabled);
            setFieldValue('retry429MaxRetries', config.retry_429_max_retries);
            setFieldValue('retry429Interval', config.retry_429_interval);


            // 兼容性配置
            setCheckboxValue('compatibilityModeEnabled', config.compatibility_mode_enabled);

            // 抗截断配置
            setFieldValue('antiTruncationMaxAttempts', config.anti_truncation_max_attempts);

            // 标记环境变量锁定的字段
            markEnvLockedFields();
        }

        // 设置字段值的辅助函数
        function setFieldValue(fieldId, value) {
            const field = document.getElementById(fieldId);
            if (field && value !== undefined && value !== null) {
                field.value = value;
            }
        }

        // 设置复选框值的辅助函数
        function setCheckboxValue(fieldId, value) {
            const field = document.getElementById(fieldId);
            if (field) {
                field.checked = Boolean(value);
            }
        }

        // 标记环境变量锁定的字段
        function markEnvLockedFields() {
            const fieldMapping = {
                'host': 'host',
                'port': 'port',
                'configApiPassword': 'api_password',
                'configPanelPassword': 'panel_password',
                'configPassword': 'password',
                'codeAssistEndpoint': 'code_assist_endpoint',
                'credentialsDir': 'credentials_dir',
                'proxy': 'proxy',
                'autoBanEnabled': 'auto_ban_enabled',
                'autoBanErrorCodes': 'auto_ban_error_codes',
                'callsPerRotation': 'calls_per_rotation',
                'retry429Enabled': 'retry_429_enabled',
                'retry429MaxRetries': 'retry_429_max_retries',
                'retry429Interval': 'retry_429_interval',
                'antiTruncationMaxAttempts': 'anti_truncation_max_attempts'
            };

            for (const [fieldId, configKey] of Object.entries(fieldMapping)) {
                const field = document.getElementById(fieldId);
                if (field && envLockedFields.has(configKey)) {
                    field.style.backgroundColor = '#f0f0f0';
                    field.style.border = '2px solid #ffc107';
                    field.title = '此字段由环境变量控制，无法通过界面修改';
                    field.readOnly = true;
                }
            }
        }

        // 从表单收集配置数据
        function collectConfigFromForm() {
            const config = {
                host: document.getElementById('host').value || null,
                port: parseInt(document.getElementById('port').value) || null,
                api_password: document.getElementById('configApiPassword').value || null,
                panel_password: document.getElementById('configPanelPassword').value || null,
                password: document.getElementById('configPassword').value || null,

                credentials_dir: document.getElementById('credentialsDir').value || null,
                proxy: document.getElementById('proxy').value || null,

                // 端点配置
                code_assist_endpoint: document.getElementById('codeAssistEndpoint').value || null,
                oauth_proxy_url: document.getElementById('oauthProxyUrl').value || null,
                googleapis_proxy_url: document.getElementById('googleapisProxyUrl').value || null,
                resource_manager_api_url: document.getElementById('resourceManagerApiUrl').value || null,
                service_usage_api_url: document.getElementById('serviceUsageApiUrl').value || null,

                auto_ban_enabled: document.getElementById('autoBanEnabled').checked,
                auto_ban_error_codes: document.getElementById('autoBanErrorCodes').value || null,

                calls_per_rotation: parseInt(document.getElementById('callsPerRotation').value) || null,

                retry_429_enabled: document.getElementById('retry429Enabled').checked,
                retry_429_max_retries: parseInt(document.getElementById('retry429MaxRetries').value) || null,
                retry_429_interval: parseFloat(document.getElementById('retry429Interval').value) || null,


                compatibility_mode_enabled: document.getElementById('compatibilityModeEnabled').checked,
                anti_truncation_max_attempts: parseInt(document.getElementById('antiTruncationMaxAttempts').value) || null
            };

            // 处理自动封禁错误码（转换为数组）
            if (config.auto_ban_error_codes) {
                try {
                    config.auto_ban_error_codes = config.auto_ban_error_codes
                        .split(',')
                        .map(code => parseInt(code.trim()))
                        .filter(code => !isNaN(code));
                } catch (e) {
                    config.auto_ban_error_codes = null;
                }
            }

            // 过滤掉null值和环境变量锁定的字段
            const fieldMapping = {
                'host': 'host',
                'port': 'port',
                'api_password': 'configApiPassword',
                'panel_password': 'configPanelPassword',
                'password': 'configPassword',
                'code_assist_endpoint': 'codeAssistEndpoint',
                'credentials_dir': 'credentialsDir',
                'proxy': 'proxy',
                'auto_ban_enabled': 'autoBanEnabled',
                'auto_ban_error_codes': 'autoBanErrorCodes',
                'calls_per_rotation': 'callsPerRotation',
                'retry_429_enabled': 'retry429Enabled',
                'retry_429_max_retries': 'retry429MaxRetries',
                'retry_429_interval': 'retry429Interval',
                'anti_truncation_max_attempts': 'antiTruncationMaxAttempts'
            };

            const filteredConfig = {};
            for (const [key, value] of Object.entries(config)) {
                if (!envLockedFields.has(key) && value !== null) {
                    filteredConfig[key] = value;
                }
            }

            return filteredConfig;
        }

        // 保存配置
        async function saveConfig() {
            const config = collectConfigFromForm();

            try {
                showStatus('正在保存配置...', 'info');

                const response = await fetch('/config/save', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ config: config })
                });

                const data = await response.json();

                if (response.ok) {
                    let message = '配置保存成功';

                    // 处理热更新状态信息
                    if (data.hot_updated && data.hot_updated.length > 0) {
                        message += `，以下配置已立即生效: ${data.hot_updated.join(', ')}`;
                    }

                    // 处理重启提醒
                    if (data.restart_required && data.restart_required.length > 0) {
                        showStatus(message, 'success');
                        setTimeout(() => {
                            showStatus(`⚠️ 重启提醒: ${data.restart_notice}`, 'info');
                        }, 2000);
                    } else {
                        showStatus(message, 'success');
                    }
                } else {
                    showStatus(`保存配置失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('saveConfig error:', error);
                showStatus(`网络错误: ${error.message}`, 'error');
            }
        }

        // =====================================================================
        // 实时日志相关函数
        // =====================================================================

        // 切换日志流状态
        function toggleLogStream() {
            if (logStreamActive) {
                stopLogStream();
            } else {
                startLogStream();
            }
        }

        // 启动日志流
        function startLogStream() {
            if (logWebSocket && logWebSocket.readyState === WebSocket.OPEN) {
                showStatus('日志流已经连接', 'info');
                return;
            }

            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}/auth/logs/stream`;

                document.getElementById('logStatus').textContent = '连接中...';
                document.getElementById('logToggleBtn').textContent = '连接中...';
                document.getElementById('logToggleBtn').disabled = true;

                logWebSocket = new WebSocket(wsUrl);

                logWebSocket.onopen = function (event) {
                    logStreamActive = true;
                    document.getElementById('logToggleBtn').textContent = '停止日志流';
                    document.getElementById('logToggleBtn').style.backgroundColor = '#dc3545';
                    document.getElementById('logToggleBtn').disabled = false;
                    document.getElementById('logStatus').textContent = '已连接';
                    showStatus('日志流已启动', 'success');
                    clearLogsDisplay(); // 清空旧日志显示
                };

                logWebSocket.onmessage = function (event) {
                    const logLine = event.data;
                    if (logLine.trim()) {
                        allLogMessages.push(logLine);

                        // 限制日志数量，保留最后1000条
                        if (allLogMessages.length > 1000) {
                            allLogMessages = allLogMessages.slice(-1000);
                        }

                        // 更新计数并应用筛选
                        document.getElementById('logCount').textContent = allLogMessages.length;
                        applyLogFilter();
                    }
                };

                logWebSocket.onclose = function (event) {
                    logStreamActive = false;
                    document.getElementById('logToggleBtn').textContent = '启动日志流';
                    document.getElementById('logToggleBtn').style.backgroundColor = '#28a745';
                    document.getElementById('logToggleBtn').disabled = false;
                    document.getElementById('logStatus').textContent = '已断开';

                    if (event.code !== 1000) { // 不是正常关闭
                        showStatus('日志流连接断开', 'error');
                    }
                };

                logWebSocket.onerror = function (error) {
                    console.error('WebSocket错误:', error);
                    document.getElementById('logToggleBtn').disabled = false;
                    showStatus('日志流连接错误', 'error');
                };

            } catch (error) {
                console.error('启动日志流失败:', error);
                document.getElementById('logToggleBtn').disabled = false;
                showStatus(`启动日志流失败: ${error.message}`, 'error');
            }
        }

        // 停止日志流
        function stopLogStream() {
            if (logWebSocket) {
                logWebSocket.close(1000, '用户手动关闭');
                logWebSocket = null;
            }

            logStreamActive = false;
            document.getElementById('logToggleBtn').textContent = '启动日志流';
            document.getElementById('logToggleBtn').style.backgroundColor = '#28a745';
            document.getElementById('logStatus').textContent = '已停止';
            showStatus('日志流已停止', 'info');
        }

        // 清空日志显示（仅前端）
        function clearLogsDisplay() {
            allLogMessages = [];
            filteredLogMessages = [];
            document.getElementById('logCount').textContent = '0';
            document.getElementById('filteredLogCount').textContent = '0';
            document.getElementById('logMessages').textContent = '日志已清空，等待新日志...';
        }

        // 应用日志筛选
        function applyLogFilter() {
            const levelFilter = document.getElementById('logLevelFilter').value;
            const searchText = document.getElementById('logSearchText').value.toLowerCase();
            currentLogFilter = levelFilter;

            if (levelFilter === 'all' && !searchText) {
                filteredLogMessages = [...allLogMessages];
            } else {
                filteredLogMessages = allLogMessages.filter(logLine => {
                    const logLower = logLine.toLowerCase();

                    // 级别筛选
                    if (levelFilter !== 'all') {
                        const levelPattern = `[${levelFilter.toUpperCase()}]`;
                        if (!logLower.includes(levelPattern.toLowerCase())) {
                            return false;
                        }
                    }

                    // 关键词搜索
                    if (searchText && !logLower.includes(searchText)) {
                        return false;
                    }

                    return true;
                });
            }

            // 更新筛选后的计数
            document.getElementById('filteredLogCount').textContent = filteredLogMessages.length;

            // 重新渲染日志
            displayLogs();
        }

        // 显示日志
        function displayLogs() {
            const logMessagesDiv = document.getElementById('logMessages');
            const logContainer = document.getElementById('logContainer');
            const autoScroll = document.getElementById('logAutoScroll').checked;

            if (filteredLogMessages.length === 0) {
                logMessagesDiv.textContent = allLogMessages.length === 0 ?
                    '点击"启动日志流"开始查看实时日志...' :
                    currentLogFilter === 'all' ? '暂无日志...' : `暂无${currentLogFilter.toUpperCase()}级别的日志...`;
            } else {
                logMessagesDiv.textContent = filteredLogMessages.join('\n');
            }

            // 自动滚动到底部
            if (autoScroll && filteredLogMessages.length > 0) {
                logContainer.scrollTop = logContainer.scrollHeight;
            }
        }


        // 清空日志
        async function clearLogs() {
            if (!confirm('确定要清空所有日志吗？')) {
                return;
            }

            try {
                // 调用后端API清空日志文件
                const response = await fetch('/auth/logs/clear', {
                    method: 'POST',
                    headers: getAuthHeaders()
                });

                const data = await response.json();

                if (response.ok) {
                    // 清空前端显示的日志
                    clearLogsDisplay();
                    showStatus(data.message, 'success');
                } else {
                    showStatus(`清空日志失败: ${data.detail || data.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('clearLogs error:', error);
                // 即使后端清空失败，也清空前端显示
                clearLogsDisplay();
                showStatus(`清空日志时网络错误: ${error.message}`, 'error');
            }
        }

        // 下载日志
        async function downloadLogs() {
            try {
                // 调用后端API下载日志文件
                const response = await fetch('/auth/logs/download', {
                    method: 'GET',
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    // 获取文件名
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'gcli2api_logs.txt';
                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename=(.+)/);
                        if (filenameMatch) {
                            filename = filenameMatch;
                        }
                    }

                    // 创建下载链接
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

                    showStatus('日志文件下载成功', 'success');
                } else {
                    const data = await response.json();
                    showStatus(`下载日志失败: ${data.detail || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('downloadLogs error:', error);
                showStatus(`下载日志时网络错误: ${error.message}`, 'error');
            }
        }

        // 页面关闭时清理WebSocket连接
        window.addEventListener('beforeunload', function () {
            if (logWebSocket) {
                logWebSocket.close();
            }
        });

        // 处理勾选框状态变化（移动端）
        function handleGetAllProjectsChange() {
            const checkbox = document.getElementById('getAllProjectsCreds');
            const note = document.getElementById('allProjectsNote');
            const projectIdSection = document.getElementById('projectIdSection');
            const projectIdToggle = document.querySelector('[onclick="toggleProjectIdSection()"]');

            if (checkbox.checked) {
                // 显示批量认证提示
                note.style.display = 'block';
                // 禁用项目ID输入（批量模式下不需要指定单个项目）
                if (projectIdSection.style.display !== 'none') {
                    toggleProjectIdSection();
                }
                if (projectIdToggle) {
                    projectIdToggle.style.opacity = '0.5';
                    projectIdToggle.style.pointerEvents = 'none';
                    projectIdToggle.title = '批量认证模式下无需指定单个项目ID';
                }
            } else {
                // 隐藏批量认证提示
                note.style.display = 'none';
                // 重新启用项目ID输入
                if (projectIdToggle) {
                    projectIdToggle.style.opacity = '1';
                    projectIdToggle.style.pointerEvents = 'auto';
                    projectIdToggle.title = '';
                }
            }
        }

        // 页面加载时显示登录提示并设置拖拽功能
        window.onload = function () {
            showStatus('请输入密码登录', 'info');
            setupDragAndDrop();

            // 添加勾选框事件监听器
            const checkbox = document.getElementById('getAllProjectsCreds');
            if (checkbox) {
                checkbox.addEventListener('change', handleGetAllProjectsChange);
            }
        };

        // 页面离开时清理选择状态
        window.addEventListener('beforeunload', function () {
            if (logWebSocket) {
                logWebSocket.close();
            }
            // 清理选择状态
            selectedCredFiles.clear();
        });

        // =====================================================================
        // 端点配置快速切换函数 - 移动版
        // =====================================================================

        // 镜像网址配置
        const mirrorUrls = {
            codeAssistEndpoint: 'https://gcli-api.sukaka.top/cloudcode-pa',
            oauthProxyUrl: 'https://gcli-api.sukaka.top/oauth2',
            googleapisProxyUrl: 'https://gcli-api.sukaka.top/googleapis',
            resourceManagerApiUrl: 'https://gcli-api.sukaka.top/cloudresourcemanager',
            serviceUsageApiUrl: 'https://gcli-api.sukaka.top/serviceusage'
        };

        // 官方端点配置
        const officialUrls = {
            codeAssistEndpoint: 'https://cloudcode-pa.googleapis.com',
            oauthProxyUrl: 'https://oauth2.googleapis.com',
            googleapisProxyUrl: 'https://www.googleapis.com',
            resourceManagerApiUrl: 'https://cloudresourcemanager.googleapis.com',
            serviceUsageApiUrl: 'https://serviceusage.googleapis.com'
        };

        // 使用镜像网址
        function useMirrorUrls() {
            if (confirm('确定要将所有端点配置为镜像网址吗？\n\n镜像网址：\n• Code Assist: gcli-api.sukaka.top/cloudcode-pa\n• OAuth: gcli-api.sukaka.top/oauth2\n• Google APIs: gcli-api.sukaka.top/googleapis\n• Resource Manager: gcli-api.sukaka.top/cloudresourcemanager\n• Service Usage: gcli-api.sukaka.top/serviceusage')) {

                // 设置所有端点为镜像网址
                for (const [fieldId, url] of Object.entries(mirrorUrls)) {
                    const field = document.getElementById(fieldId);
                    if (field && !field.disabled) {
                        field.value = url;
                    }
                }

                showStatus('✅ 已切换到镜像网址，记得保存配置', 'success');
            }
        }

        // 还原官方端点
        function restoreOfficialUrls() {
            if (confirm('确定要将所有端点配置为官方地址吗？\n\n官方端点：\n• Code Assist: cloudcodeassist-pa.googleapis.com\n• OAuth: oauth2.googleapis.com\n• Google APIs: www.googleapis.com\n• Resource Manager: cloudresourcemanager.googleapis.com\n• Service Usage: serviceusage.googleapis.com')) {

                // 设置所有端点为官方地址
                for (const [fieldId, url] of Object.entries(officialUrls)) {
                    const field = document.getElementById(fieldId);
                    if (field && !field.disabled) {
                        field.value = url;
                    }
                }

                showStatus('✅ 已切换到官方端点，记得保存配置', 'success');
            }
        }