(function () {
  const THEME_KEY = 'ag-panel-theme';
  let currentTheme = 'light';
  let initialized = false;
  let autoThemeTimer = null;
  const toggleButtons = new Set();

  function isNightTime() {
    const hour = new Date().getHours();
    return hour >= 18 || hour < 6;
  }

  function applyTheme(theme, { persist = true } = {}) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    toggleButtons.forEach(updateToggleLabel);
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (e) {
        // ignore storage errors
      }
    }
    return currentTheme;
  }

  function applyAutoTheme() {
    return applyTheme(isNightTime() ? 'dark' : 'light', { persist: false });
  }

  function initTheme() {
    if (initialized) return currentTheme;
    initialized = true;

    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) {
        return applyTheme(saved, { persist: false });
      }
    } catch (e) {
      // ignore storage errors
    }

    autoThemeTimer = setInterval(applyAutoTheme, 10 * 60 * 1000);
    return applyAutoTheme();
  }

  function updateToggleLabel(button) {
    if (!button) return;
    const theme = currentTheme;
    button.textContent = theme === 'dark' ? '☀️ 切换为亮色' : '🌙 切换为暗色';
  }

  function toggleTheme(button) {
    const next = currentTheme === 'dark' ? 'light' : 'dark';
    if (autoThemeTimer) {
      clearInterval(autoThemeTimer);
      autoThemeTimer = null;
    }
    applyTheme(next);
    updateToggleLabel(button);
    return next;
  }

  function bindThemeToggle(button) {
    if (!button) return;
    initTheme();
    toggleButtons.add(button);
    updateToggleLabel(button);

    button.addEventListener('click', () => {
      toggleTheme(button);
    });
  }

  window.AgTheme = {
    initTheme,
    applyTheme,
    toggleTheme,
    bindThemeToggle,
    getTheme: () => currentTheme,
    THEME_KEY
  };

  document.addEventListener('DOMContentLoaded', initTheme, { once: true });
})();
