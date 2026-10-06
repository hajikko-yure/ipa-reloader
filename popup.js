document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const statusBadge = document.getElementById('status-badge');
  const delayRange = document.getElementById('delay-range');
  const delayVal = document.getElementById('delay-val');
  const maxRetries = document.getElementById('max-retries');
  const logsContainer = document.getElementById('logs-container');
  const clearLogsBtn = document.getElementById('clear-logs-btn');

  chrome.storage.local.get(['enabled', 'delaySeconds', 'maxRetries', 'logs'], (res) => {
    const enabled = res.enabled !== undefined ? res.enabled : true;
    toggleEnabled.checked = enabled;
    updateStatusBadge(enabled);

    const delay = res.delaySeconds !== undefined ? Number(res.delaySeconds) : 3;
    delayRange.value = delay;
    delayVal.textContent = `${delay}秒`;

    if (res.maxRetries !== undefined) {
      maxRetries.value = String(res.maxRetries);
    }

    renderLogs(res.logs || []);
  });

  function updateStatusBadge(enabled) {
    if (enabled) {
      statusBadge.textContent = '自動再送: 有効';
      statusBadge.className = 'state-value active';
    } else {
      statusBadge.textContent = '自動再送: 停止中';
      statusBadge.className = 'state-value inactive';
    }
  }

  toggleEnabled.addEventListener('change', () => {
    const isChecked = toggleEnabled.checked;
    chrome.storage.local.set({ enabled: isChecked });
    updateStatusBadge(isChecked);
  });

  delayRange.addEventListener('input', () => {
    const val = Number(delayRange.value);
    delayVal.textContent = `${val}秒`;
    chrome.storage.local.set({ delaySeconds: val });
  });

  maxRetries.addEventListener('change', () => {
    chrome.storage.local.set({ maxRetries: Number(maxRetries.value) });
  });

  function renderLogs(logs) {
    if (!logs || logs.length === 0) {
      logsContainer.innerHTML = '<div class="log-empty">待機中（検知なし）</div>';
      return;
    }

    logsContainer.innerHTML = '';
    logs.forEach((log) => {
      const row = document.createElement('div');
      row.className = 'log-row';

      const left = document.createElement('span');
      left.textContent = `${log.time || ''} [${log.method || 'GET'}]`;

      const right = document.createElement('span');
      right.textContent = log.detail || log.type || '';

      row.appendChild(left);
      row.appendChild(right);
      logsContainer.appendChild(row);
    });
  }

  clearLogsBtn.addEventListener('click', () => {
    chrome.storage.local.set({ logs: [] }, () => {
      renderLogs([]);
    });
  });
});
