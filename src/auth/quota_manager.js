import { getModelsWithQuotas } from '../api/client.js';

const TZ_OFFSET = 8 * 60 * 60 * 1000; // Beijing timezone offset

class QuotaManager {
  constructor() {}

  utcToBeijing(utcString) {
    try {
      const utcDate = new Date(utcString);
      const beijingTime = new Date(utcDate.getTime() + TZ_OFFSET);
      return beijingTime
        .toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
        .replace(/\//g, '-');
    } catch (e) {
      return 'unknown time';
    }
  }

  async getQuotas(_refreshToken, token) {
    if (!token?.refresh_token) {
      throw new Error('missing refresh_token for quota query');
    }

    try {
      let activeToken = token;

      // Ensure we always hit Google in real time with the latest access_token
      if (!activeToken?.access_token || this.isTokenExpired(activeToken)) {
        activeToken = await this.refreshTokenForQuota({ ...activeToken });
      }

      const apiData = await getModelsWithQuotas(activeToken);

      if (!apiData || Object.keys(apiData).length === 0) {
        throw new Error('Invalid API response');
      }

      const formatted = {
        lastUpdated: Date.now(),
        models: {}
      };

      for (const [modelName, modelInfo] of Object.entries(apiData)) {
        formatted.models[modelName] = {
          r: modelInfo.remaining,
          t: modelInfo.resetTimeRaw || modelInfo.resetTime
        };
      }

      return this.formatResponse(formatted);
    } catch (e) {
      console.error('Failed to fetch quotas:', e.message);
      throw e;
    }
  }

  isTokenExpired(token) {
    if (!token.timestamp || !token.expires_in) return true;
    const expiresAt = token.timestamp + token.expires_in * 1000;
    return Date.now() >= expiresAt - 300000; // refresh 5 minutes early
  }

  async refreshTokenForQuota(token) {
    const axios = (await import('axios')).default;
    const CLIENT_ID =
      '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
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
          Host: 'oauth2.googleapis.com',
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
      throw new Error(
        `Token refresh failed: ${error.response?.data?.error_description || error.message}`
      );
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
}

export default new QuotaManager();
