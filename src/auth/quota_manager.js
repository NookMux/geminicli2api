import fs from 'fs';
import path from 'path';
import { getModelsWithQuotas } from '../api/client.js';

const QUOTA_FILE = path.join(process.cwd(), 'data', 'quotas.json');
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
const CLEANUP_TTL = 60 * 60 * 1000; // 1小时清理
const TZ_OFFSET = 8 * 60 * 60 * 1000; // 北京时间偏移

class QuotaManager {
  constructor() {
    this.quotas = this.loadQuotas();
    this.startCleanupTask();
  }

  loadQuotas() {
    try {
      if (!fs.existsSync(QUOTA_FILE)) {
        return { meta: { lastCleanup: Date.now(), ttl: CLEANUP_TTL }, quotas: {} };
      }
      const data = fs.readFileSync(QUOTA_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' ? parsed : { meta: { lastCleanup: Date.now(), ttl: CLEANUP_TTL }, quotas: {} };
    } catch (e) {
      console.error('Failed to load quotas:', e.message);
      return { meta: { lastCleanup: Date.now(), ttl: CLEANUP_TTL }, quotas: {} };
    }
  }

  saveQuotas() {
    try {
      const dir = path.dirname(QUOTA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(QUOTA_FILE, JSON.stringify(this.quotas, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save quotas:', e.message);
    }
  }

  utcToBeijing(utcString) {
    try {
      const utcDate = new Date(utcString);
      const beijingTime = new Date(utcDate.getTime() + TZ_OFFSET);
      return beijingTime.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).replace(/\//g, '-');
    } catch (e) {
      return '未知时间';
    }
  }

  async getQuotas(refreshToken, token) {
    const now = Date.now();
    const existing = this.quotas.quotas[refreshToken];

    // 缓存检查
    if (existing && (now - existing.lastUpdated) < CACHE_TTL) {
      return this.formatResponse(existing);
    }

    try {
      // 确保token是最新的（检查过期并自动刷新）
      if (!token.access_token || this.isTokenExpired(token)) {
        token = await this.refreshTokenForQuota(token);
      }

      // 调用API获取最新额度
      const apiData = await getModelsWithQuotas(token);

      if (!apiData || Object.keys(apiData).length === 0) {
        throw new Error('Invalid API response');
      }

      // 转换数据格式
      const formatted = {
        lastUpdated: now,
        models: {}
      };

      for (const [modelName, modelInfo] of Object.entries(apiData)) {
        formatted.models[modelName] = {
          r: modelInfo.remaining,
          t: modelInfo.resetTimeRaw || modelInfo.resetTime
        };
      }

      // 更新缓存
      this.quotas.quotas[refreshToken] = formatted;
      this.saveQuotas();

      return this.formatResponse(formatted);
    } catch (e) {
      console.error('Failed to fetch quotas:', e.message);

      // 如果有缓存数据，即使过期也返回
      if (existing) {
        return this.formatResponse(existing);
      }

      throw e;
    }
  }

  isTokenExpired(token) {
    if (!token.timestamp || !token.expires_in) return true;
    const expiresAt = token.timestamp + (token.expires_in * 1000);
    return Date.now() >= expiresAt - 300000; // 提前5分钟刷新
  }

  async refreshTokenForQuota(token) {
    const axios = (await import('axios')).default;
    const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
    const CLIENT_SECRET = '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';

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
    });

    try {
      const response = await axios({
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: {
          'Host': 'oauth2.googleapis.com',
          'User-Agent': 'Go-http-client/1.1',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept-Encoding': 'gzip'
        },
        data: body.toString(),
        timeout: 30000
      });

      token.access_token = response.data.access_token;
      token.expires_in = response.data.expires_in;
      token.timestamp = Date.now();

      return token;
    } catch (error) {
      throw new Error(`Token刷新失败: ${error.response?.data?.error_description || error.message}`);
    }
  }

  formatResponse(data) {
    const result = {
      lastUpdated: data.lastUpdated,
      models: {}
    };

    for (const [modelName, modelInfo] of Object.entries(data.models)) {
      result.models[modelName] = {
        remaining: modelInfo.r || 0,
        resetTime: this.utcToBeijing(modelInfo.t),
        resetTimeRaw: modelInfo.t
      };
    }

    return result;
  }

  startCleanupTask() {
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - CLEANUP_TTL;
      let cleaned = false;

      for (const [key, data] of Object.entries(this.quotas.quotas)) {
        if (data.lastUpdated < cutoff) {
          delete this.quotas.quotas[key];
          cleaned = true;
        }
      }

      if (cleaned) {
        this.quotas.meta.lastCleanup = now;
        this.saveQuotas();
      }
    }, CLEANUP_TTL);
  }
}

export default new QuotaManager();