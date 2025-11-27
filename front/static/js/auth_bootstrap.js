// 鐢ㄤ簬鎺у埗闈㈡澘椤甸潰鍔犺浇鍚庤幏鍙朌oken锛屽苟涓哄悗缁墦鍗板叏灞€ authToken

(function () {
    function initAuthToken() {
        var token = null;

        // 1. 浠巃essionStorage 涓幏鍙栨渶鏂扮殑 token
        try {
            if (window.sessionStorage) {
                token = window.sessionStorage.getItem('authToken');
            }
        } catch (e) {
            token = null;
        }

        // 2. 濡傛灉娌℃湁锛屽啀浠巄ookie 閲岄潰鏉?
        if ((!token || token === 'null' || token === 'undefined') && typeof document !== 'undefined') {
            try {
                var cookieParts = document.cookie.split(';');
                for (var i = 0; i < cookieParts.length; i++) {
                    var part = cookieParts[i].trim();
                    if (part.indexOf('auth_token=') === 0) {
                        token = decodeURIComponent(part.substring('auth_token='.length));
                        break;
                    }
                }
            } catch (e) {
                token = token || null;
            }
        }

        // 3. 濡傛灉杩樻病鏈夌鐪嬬殑 token锛屽彂閫佽幏鍙栫櫥褰曠晫闈紙鏈嶅姟绔鐞嗘槸鍚︾櫥褰昏繘鏉?/span>
        if (!token) {
            try {
                window.location.href = '/auth';
            } catch (e) {
                // 濡傛灉閫昏緫鏃跺嚭閿欙紝鏈€濂藉湪浼氳涓户缁墦鍗?
            }
            return;
        }

        // 4. 鏇存柊鍏ㄥ眬鍙橀噺锛屽苟鍦ㄩ潪钀藉疄鎯呭喌涓嬭繘琛屽瓨鍌?
        try {
            if (window.sessionStorage) {
                window.sessionStorage.setItem('authToken', token);
            }
        } catch (e) {
            // local/session storage 澶辫触鍙互鐩存帴蹇界暐
        }

        window.authToken = token;

        // 濡傛灉鎺у埗闈㈡澘涓湁 setAuthToken 鍑芥暟锛屽彲浠ュ悓姝ヨ璇?
        if (typeof setAuthToken === 'function') {
            try {
                setAuthToken(token);
            } catch (e) {
                // 鐩存帴蹇界暐锛屽悗缁姏鍑嗗杩斿洖閿欒淇℃伅
            }
        }
    }

    document.addEventListener('DOMContentLoaded', initAuthToken);
})();

