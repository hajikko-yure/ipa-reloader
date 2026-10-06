(function () {
  'use strict';

  const STORAGE_KEY_FORM = 'ipa_reloader_pending_form';
  const STORAGE_KEY_RETRY_COUNT = 'ipa_reloader_retry_count';
  const FORM_EXPIRY_MS = 5 * 60 * 1000;

  const defaultSettings = {
    enabled: true,
    delaySeconds: 3,
    maxRetries: 10
  };

  let currentSettings = { ...defaultSettings };
  let countdownTimer = null;
  let remainingSeconds = 3;
  let totalSeconds = 3;
  let isPaused = false;
  let hasHandledTimeout = false;

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['enabled', 'delaySeconds', 'maxRetries'], (res) => {
      if (res.enabled !== undefined) currentSettings.enabled = res.enabled;
      if (res.delaySeconds !== undefined) currentSettings.delaySeconds = Number(res.delaySeconds) || 3;
      if (res.maxRetries !== undefined) currentSettings.maxRetries = Number(res.maxRetries) || 10;
    });
  }

  function captureFormSubmission(event) {
    const form = event.target;
    if (!form || form.tagName !== 'FORM') return;

    try {
      const action = form.action || window.location.href;
      const method = (form.method || 'GET').toUpperCase();

      if (method === 'POST') {
        const formData = [];
        const elements = form.elements;
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (!el.name || el.disabled) continue;

          if (el.type === 'checkbox' || el.type === 'radio') {
            if (el.checked) {
              formData.push({ name: el.name, value: el.value });
            }
          } else if (el.tagName === 'SELECT' && el.multiple) {
            for (let opt of el.options) {
              if (opt.selected) {
                formData.push({ name: el.name, value: opt.value });
              }
            }
          } else {
            formData.push({ name: el.name, value: el.value });
          }
        }

        const payload = {
          url: action,
          method: 'POST',
          fields: formData,
          timestamp: Date.now()
        };

        sessionStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(payload));
      }
    } catch (e) {
      console.warn('[IPA Reloader] フォームデータ保存失敗:', e);
    }
  }

  window.addEventListener('submit', captureFormSubmission, true);

  function detectTimeout() {
    const rawText = document.body?.innerText || document.documentElement?.innerText || '';
    const text = rawText.trim();
    const title = (document.title || '').trim();
    const lowerText = text.toLowerCase();
    const lowerTitle = title.toLowerCase();

    const isUpstreamTimeout = lowerText.includes('upstream request timeout');
    const isStreamTimeout = lowerText.includes('stream timeout');
    const is504 = lowerText.includes('504 gateway timeout') || lowerText.includes('504 gateway time-out') || lowerTitle.includes('504 gateway');
    const is502or503 = lowerText.includes('502 bad gateway') || lowerText.includes('503 service unavailable');
    const isGenericGateway = lowerText.includes('gateway timeout') || lowerText.includes('gateway time-out');

    const isSessionNotice = lowerText.includes('session timeout') || lowerText.includes('セッションタイムアウト');
    const isShortTimeoutText = !isSessionNotice && text.length < 300 && (
      lowerText.includes('request timeout') ||
      lowerText.includes('timed out') ||
      lowerText.includes('time-out')
    );

    const isCongestion = (lowerText.includes('混雑') && lowerText.includes('時間をおいて')) ||
                         lowerText.includes('アクセスが集中');

    return isUpstreamTimeout || isStreamTimeout || is504 || is502or503 || isGenericGateway || isShortTimeoutText || isCongestion;
  }

  function showNotificationBanner(isPost, targetUrl, retryCount) {
    if (document.getElementById('ipa-reloader-banner')) return;

    totalSeconds = remainingSeconds;
    const actionLabel = isPost ? 'POST自動再送信' : 'ページ再読込';

    const banner = document.createElement('div');
    banner.id = 'ipa-reloader-banner';
    banner.innerHTML = `
      <aside class="ipa-notice" role="alert">
        <div class="ipa-notice-gauge">
          <div id="ipa-progress-fill" class="ipa-gauge-bar" style="width: 100%;"></div>
        </div>
        <div class="ipa-notice-content">
          <div class="ipa-timer-cell">
            <span id="ipa-countdown" class="ipa-timer-digit">${remainingSeconds}</span>
            <span class="ipa-timer-unit">秒</span>
          </div>
          <div class="ipa-info-cell">
            <div class="ipa-info-title">混雑検知 [${actionLabel}]</div>
            <div class="ipa-info-detail">試行 ${retryCount}回目 / 待機中</div>
          </div>
          <div class="ipa-actions-cell">
            <button id="ipa-retry-now-btn" class="ipa-btn-send" type="button">直ちに再送</button>
            <button id="ipa-pause-btn" class="ipa-btn-hold" type="button">一時停止</button>
          </div>
        </div>
      </aside>
    `;

    document.documentElement.appendChild(banner);

    document.getElementById('ipa-retry-now-btn').addEventListener('click', () => {
      clearInterval(countdownTimer);
      executeRetry(isPost, targetUrl);
    });

    const pauseBtn = document.getElementById('ipa-pause-btn');
    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      const detailEl = document.querySelector('.ipa-info-detail');
      if (isPaused) {
        pauseBtn.textContent = '再開';
        clearInterval(countdownTimer);
        if (detailEl) detailEl.textContent = '自動再送信: 一時停止中';
      } else {
        pauseBtn.textContent = '一時停止';
        if (detailEl) detailEl.textContent = `試行 ${retryCount}回目 / 待機中`;
        startCountdown(isPost, targetUrl, retryCount);
      }
    });
  }

  function startCountdown(isPost, targetUrl, retryCount) {
    clearInterval(countdownTimer);
    updateProgressUI();

    countdownTimer = setInterval(() => {
      if (isPaused) return;

      remainingSeconds--;
      updateProgressUI();

      if (remainingSeconds <= 0) {
        clearInterval(countdownTimer);
        executeRetry(isPost, targetUrl);
      }
    }, 1000);
  }

  function updateProgressUI() {
    const countEl = document.getElementById('ipa-countdown');
    if (countEl) countEl.textContent = Math.max(0, remainingSeconds);

    const progressFill = document.getElementById('ipa-progress-fill');
    if (progressFill && totalSeconds > 0) {
      const pct = Math.max(0, Math.min(100, (remainingSeconds / totalSeconds) * 100));
      progressFill.style.width = `${pct}%`;
    }
  }

  function executeRetry(isPost, targetUrl) {
    const detailEl = document.querySelector('.ipa-info-detail');
    if (detailEl) detailEl.textContent = '再送信中...';

    if (isPost) {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY_FORM);
        if (saved) {
          const formInfo = JSON.parse(saved);
          const postForm = document.createElement('form');
          postForm.method = 'POST';
          postForm.action = formInfo.url || targetUrl || window.location.href;
          postForm.style.display = 'none';

          for (let f of formInfo.fields) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = f.name;
            input.value = f.value;
            postForm.appendChild(input);
          }

          document.body.appendChild(postForm);
          postForm.submit();
          return;
        }
      } catch (e) {
        console.error('[IPA Reloader] POST再送信の生成に失敗:', e);
        if (detailEl) detailEl.textContent = '再送信エラー（手動で再試行してください）';
        return;
      }
    }

    window.location.reload();
  }

  let isInspecting = false;

  function inspectAndHandlePage() {
    if (hasHandledTimeout || isInspecting) return;
    isInspecting = true;

    chrome.storage.local.get(['enabled', 'delaySeconds', 'maxRetries'], (res) => {
      isInspecting = false;
      if (hasHandledTimeout) return;

      const enabled = res.enabled !== undefined ? res.enabled : defaultSettings.enabled;
      const rawDelay = Number(res.delaySeconds);
      const delay = Number.isFinite(rawDelay) ? rawDelay : defaultSettings.delaySeconds;
      const rawMax = Number(res.maxRetries);
      const maxRetries = Number.isFinite(rawMax) ? rawMax : defaultSettings.maxRetries;

      if (!enabled) return;

      const isTimeout = detectTimeout();

      if (isTimeout) {
        hasHandledTimeout = true;
        const rawCount = parseInt(sessionStorage.getItem(STORAGE_KEY_RETRY_COUNT) || '0', 10);
        const retryCount = (Number.isNaN(rawCount) ? 0 : rawCount) + 1;
        sessionStorage.setItem(STORAGE_KEY_RETRY_COUNT, String(retryCount));

        if (maxRetries > 0 && retryCount > maxRetries) {
          const banner = document.createElement('div');
          banner.id = 'ipa-reloader-banner';
          banner.innerHTML = `
            <div class="ipa-notice">
              <div class="ipa-notice-content">
                <div class="ipa-info-cell">
                  <div class="ipa-info-title">上限回数到達 (${maxRetries}回)</div>
                  <div class="ipa-info-detail">混雑が継続しています。手動で再度お試しください。</div>
                </div>
                <div class="ipa-actions-cell">
                  <button id="ipa-force-retry" class="ipa-btn-send" type="button">再試行</button>
                </div>
              </div>
            </div>
          `;
          document.documentElement.appendChild(banner);
          document.getElementById('ipa-force-retry').addEventListener('click', () => {
            sessionStorage.setItem(STORAGE_KEY_RETRY_COUNT, '0');
            window.location.reload();
          });
          return;
        }

        let isPost = false;
        let targetUrl = window.location.href;
        try {
          const saved = sessionStorage.getItem(STORAGE_KEY_FORM);
          if (saved) {
            const formInfo = JSON.parse(saved);
            if (Date.now() - formInfo.timestamp < FORM_EXPIRY_MS) {
              isPost = true;
              targetUrl = formInfo.url;
            }
          }
        } catch (e) {}

        remainingSeconds = Math.max(1, delay);
        showNotificationBanner(isPost, targetUrl, retryCount);
        startCountdown(isPost, targetUrl, retryCount);

        try {
          chrome.runtime.sendMessage({
            action: 'timeout_detected',
            url: window.location.href,
            isPost: isPost,
            retryCount: retryCount
          });
        } catch (e) {}

      } else {
        sessionStorage.removeItem(STORAGE_KEY_RETRY_COUNT);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inspectAndHandlePage);
  } else {
    inspectAndHandlePage();
  }

  window.addEventListener('load', () => {
    if (!hasHandledTimeout && !document.getElementById('ipa-reloader-banner')) {
      inspectAndHandlePage();
    }
  });

})();
