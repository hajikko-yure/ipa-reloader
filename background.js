const DEFAULT_SETTINGS = {
  enabled: true,
  delaySeconds: 3,
  maxRetries: 10,
  logs: []
};

const tabRetries = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['enabled', 'delaySeconds', 'maxRetries', 'logs'], (res) => {
    const toSet = {};
    if (res.enabled === undefined) toSet.enabled = DEFAULT_SETTINGS.enabled;
    if (res.delaySeconds === undefined) toSet.delaySeconds = DEFAULT_SETTINGS.delaySeconds;
    if (res.maxRetries === undefined) toSet.maxRetries = DEFAULT_SETTINGS.maxRetries;
    if (res.logs === undefined) toSet.logs = DEFAULT_SETTINGS.logs;

    if (Object.keys(toSet).length > 0) {
      chrome.storage.local.set(toSet);
    }
  });
});

function isTargetUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.ipa.go.jp') || parsed.hostname === 'ipa.go.jp';
  } catch (e) {
    return false;
  }
}

function addLogEntry(entry) {
  chrome.storage.local.get(['logs'], (res) => {
    const logs = res.logs || [];
    logs.unshift({
      id: Date.now(),
      time: new Date().toLocaleTimeString('ja-JP'),
      ...entry
    });
    if (logs.length > 30) logs.pop();
    chrome.storage.local.set({ logs });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabRetries.delete(tabId);
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    tabRetries.delete(details.tabId);
  }
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isTargetUrl(details.url)) return;
  if (details.error === 'net::ERR_ABORTED') return;

  chrome.storage.local.get(['enabled', 'delaySeconds', 'maxRetries'], (res) => {
    if (res.enabled === false) return;

    const rawMaxRetries = Number(res.maxRetries);
    const maxRetries = Number.isFinite(rawMaxRetries) ? rawMaxRetries : DEFAULT_SETTINGS.maxRetries;
    const currentRetries = tabRetries.get(details.tabId) || 0;

    if (maxRetries > 0 && currentRetries >= maxRetries) {
      tabRetries.delete(details.tabId);
      return;
    }

    tabRetries.set(details.tabId, currentRetries + 1);

    const rawDelay = Number(res.delaySeconds);
    const delay = (Number.isFinite(rawDelay) ? rawDelay : DEFAULT_SETTINGS.delaySeconds) * 1000;
    const errorText = details.error || '通信エラー';

    addLogEntry({
      url: details.url,
      type: '接続エラー',
      detail: `${errorText} (${currentRetries + 1}/${maxRetries > 0 ? maxRetries : '∞'})`,
      method: 'GET'
    });

    setTimeout(() => {
      chrome.tabs.get(details.tabId, (tab) => {
        if (!chrome.runtime.lastError && tab && isTargetUrl(tab.url)) {
          chrome.tabs.reload(details.tabId);
        }
      });
    }, delay);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'timeout_detected') {
    addLogEntry({
      url: message.url,
      type: '504検知',
      detail: `試行${message.retryCount}回目`,
      method: message.isPost ? 'POST' : 'GET'
    });
    sendResponse({ status: 'ok' });
  }
});
