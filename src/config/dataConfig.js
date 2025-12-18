import fs from 'fs';
import path from 'path';
import log from '../utils/logger.js';

const DATA_DIR = './data';
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// 默认配置结构（用于兜底，当 config.json 和 .env 都没有时使用）
const DEFAULT_DATA_CONFIG = {
  // 服务器配置
  PORT: 8045,
  HOST: '0.0.0.0',

  // API 配置
  API_URL: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  API_MODELS_URL: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  API_NO_STREAM_URL: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
  API_HOST: 'daily-cloudcode-pa.sandbox.googleapis.com',
  API_USER_AGENT: 'antigravity/1.11.3 windows/amd64',

  // 默认参数
  DEFAULT_TEMPERATURE: 1,
  DEFAULT_TOP_P: 0.85,
  DEFAULT_TOP_K: 50,
  DEFAULT_MAX_TOKENS: 8096,

  // 安全配置
  MAX_REQUEST_SIZE: '50mb',

  // 其他配置
  USE_NATIVE_AXIOS: false,
  TIMEOUT: 1800000,
  MAX_IMAGES: 10,
  IMAGE_BASE_URL: '',
  CREDENTIAL_MAX_USAGE_PER_HOUR: 20,
  RETRY_STATUS_CODES: '429,500',
  RETRY_MAX_ATTEMPTS: 3,
  SYSTEM_INSTRUCTION: '',
  PROXY: ''
};

// 环境变量优先级配置（这些只能在 Docker 环境变量中设置，不走 config.json）
const DOCKER_ONLY_KEYS = [
  'PANEL_USER',
  'PANEL_PASSWORD',
  'API_KEY'
];

/**
 * 判断值是否为"有效值"（非空、非 undefined、非 null）
 */
function isValidValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    log.info('✓ 已创建 data 目录');
  }
}

/**
 * 读取 config.json 的原始内容（不合并默认值）
 */
function loadRawDataConfig() {
  try {
    ensureDataDir();
    if (!fs.existsSync(CONFIG_FILE)) {
      // 首次启动，创建空的 config.json
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2), 'utf8');
      log.info('✓ 已创建空的 data/config.json 文件');
      return {};
    }
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    log.error('读取 data/config.json 失败:', error.message);
    return {};
  }
}

/**
 * 读取 config.json 并合并默认值（向后兼容）
 */
function loadDataConfig() {
  const rawConfig = loadRawDataConfig();
  return { ...DEFAULT_DATA_CONFIG, ...rawConfig };
}

function saveDataConfig(config) {
  try {
    ensureDataDir();
    const currentConfig = loadRawDataConfig();
    const mergedConfig = { ...currentConfig, ...config };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2), 'utf8');
    log.info('✓ 已将配置保存到 data/config.json');
    return mergedConfig;
  } catch (error) {
    log.error('保存 data/config.json 失败:', error.message);
    throw error;
  }
}

/**
 * 生效配置加载逻辑：
 *
 * 对于 DOCKER_ONLY_KEYS（PANEL_USER, PANEL_PASSWORD, API_KEY）：
 *   - 仅从环境变量读取，不走 config.json
 *
 * 对于其他普通配置项：
 *   1. config.json 有有效值 → 直接用 config
 *   2. config.json 没有，.env 环境变量有 → 同步写入 config.json，用 config
 *   3. 都没有 → 用默认值
 *
 * 这样 .env 就是"初始化种子"，只在 config.json 没有对应值时生效一次
 */
function getEffectiveConfig() {
  const rawConfig = loadRawDataConfig();
  const effectiveConfig = {};
  const syncToConfig = {};

  // 处理普通配置项
  Object.keys(DEFAULT_DATA_CONFIG).forEach(key => {
    if (DOCKER_ONLY_KEYS.includes(key)) {
      return; // 跳过，后面单独处理
    }

    const configValue = rawConfig[key];
    const envValue = process.env[key];
    const defaultValue = DEFAULT_DATA_CONFIG[key];

    if (isValidValue(configValue)) {
      // config.json 有有效值，直接用
      effectiveConfig[key] = configValue;
    } else if (isValidValue(envValue)) {
      // config.json 没有，env 有，同步到 config 并使用
      effectiveConfig[key] = envValue;
      syncToConfig[key] = envValue;
    } else {
      // 都没有，用默认值
      effectiveConfig[key] = defaultValue;
    }
  });

  // 如果有需要从 env 同步到 config.json 的项，执行同步
  if (Object.keys(syncToConfig).length > 0) {
    try {
      const updatedConfig = { ...rawConfig, ...syncToConfig };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(updatedConfig, null, 2), 'utf8');
      log.info(`✓ 已从 .env 同步配置到 config.json: ${Object.keys(syncToConfig).join(', ')}`);
    } catch (error) {
      log.error('同步配置到 config.json 失败:', error.message);
    }
  }

  // 处理 DOCKER_ONLY_KEYS（只从环境变量读取）
  DOCKER_ONLY_KEYS.forEach(key => {
    if (process.env[key] !== undefined) {
      effectiveConfig[key] = process.env[key];
    }
    // 不设置默认值，启动阶段会强制校验这些必填项
  });

  return effectiveConfig;
}

function isDockerOnlyKey(key) {
  return DOCKER_ONLY_KEYS.includes(key);
}

function getDockerOnlyKeys() {
  return DOCKER_ONLY_KEYS;
}

export {
  loadDataConfig,
  saveDataConfig,
  getEffectiveConfig,
  isDockerOnlyKey,
  getDockerOnlyKeys,
  DEFAULT_DATA_CONFIG
};
