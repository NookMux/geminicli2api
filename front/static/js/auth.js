// ===========================
// 认证相关功能
// ===========================

let currentProjectId = '';
let authInProgress = false;
let authToken = '';

// ===========================
// 登录相关函数
// ===========================

/**
 * 用户登录
 */
async function login() {
    const password = $('#loginPassword').val();
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
            window.authToken = authToken;
            $('#loginSection').addClass('hidden');
            $('#mainSection').removeClass('hidden');
            showStatus('登录成功', 'success');
        } else {
            showStatus(`登录失败: ${data.detail || data.error || '密码错误'}`, 'error');
        }
    } catch (error) {
        showStatus(`网络错误: ${error.message}`, 'error');
    }
}

/**
 * 处理登录密码框的回车事件
 */
function handleLoginEnter(event) {
    handlePasswordEnter(event, login);
}

// ===========================
// OAuth 认证流程
// ===========================

/**
 * 开始OAuth认证流程
 */
async function startAuth() {
    const projectId = $('#projectId').val().trim();
    const getAllProjects = $('#getAllProjectsCreds').prop('checked');
    currentProjectId = projectId || null;

    const $btn = $('#getAuthBtn');
    $btn.prop('disabled', true).text('正在获取认证链接...');

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
            $('#authUrl').attr('href', data.auth_url).text(data.auth_url);
            $('#authUrlSection').removeClass('hidden');

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
        $btn.prop('disabled', false).text('获取认证链接');
    }
}

// ===========================
// 回调URL处理
// ===========================

/**
 * 处理回调URL
 */
async function processCallbackUrl() {
    const callbackUrl = $('#callbackUrlInput').val().trim();
    const getAllProjects = $('#getAllProjectsCreds').prop('checked');

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
        const projectId = $('#projectId').val().trim() || null;

        const response = await fetch('/auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                callback_url: callbackUrl,
                project_id: projectId,
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

            $('#credentialsContent').text(resultText);
            $('#credentialsSection').removeClass('hidden');
            showStatus(`✅ 批量并发认证完成！成功生成 ${results.success.length} 个项目的凭证文件${results.failed.length > 0 ? `，${results.failed.length} 个项目失败` : ''}`, 'success');

        } else if (result.credentials) {
            showStatus(result.message || '从回调URL获取凭证成功！', 'success');
            $('#credentialsContent').html(
                '<pre>' + JSON.stringify(result.credentials, null, 2) + '</pre>'
            );
            $('#credentialsSection').removeClass('hidden');

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

        $('#callbackUrlInput').val('');
    } catch (error) {
        console.error('从回调URL获取凭证时出错:', error);
        showStatus(`从回调URL获取凭证失败: ${error.message}`, 'error');
    }
}

/**
 * 初始化认证标签页
 */
function initAuthTab() {
    console.log('认证标签页已加载');
}