const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxs8jxgB8mCwscNzp68-BgF3nyV4YR5UDT_7WHgfFIn9qkqIqyF6aipqBggKaaryAyJww/exec';
const PIN_STORAGE_KEY = 'fleet_admin_pin_v1';
const SOUND_STORAGE_KEY = 'fleet_admin_sound_v1';
const REFRESH_INTERVAL_MS = 45000;

let adminPin = '';
let allRequests = [];
let activeDrivers = [];
let currentFilter = 'Pending';
let knownPendingIds = new Set();
let isFirstLoad = true;
let soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
let pollTimer = null;
let activeModalRequest = null;
let activeDecisionType = 'Approved';

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const adminToolbar = document.getElementById('admin-toolbar');
const loginForm = document.getElementById('login-form');
const pinInput = document.getElementById('admin-pin');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');

const soundToggleBtn = document.getElementById('sound-toggle-btn');
const manualRefreshBtn = document.getElementById('manual-refresh-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const logoutBtn = document.getElementById('logout-btn');
const lastSyncTimeEl = document.getElementById('last-sync-time');

const listEl = document.getElementById('admin-requests-list');
const searchEl = document.getElementById('admin-search');
const filterPills = document.querySelectorAll('.filter-pill');

const modal = document.getElementById('decision-modal');
const modalTitle = document.getElementById('modal-title');
const modalSummary = document.getElementById('modal-summary');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const decisionForm = document.getElementById('decision-form');
const approveFields = document.getElementById('approve-fields');
const rejectFields = document.getElementById('reject-fields');
const driverSelect = document.getElementById('driver-select');
const approveNote = document.getElementById('approve-note');
const rejectNote = document.getElementById('reject-note');
const modalSubmitBtn = document.getElementById('modal-submit-btn');

updateSoundButton();

// دخول تلقائي لو الرمز محفوظ في الجلسة
const savedPin = sessionStorage.getItem(PIN_STORAGE_KEY);
if (savedPin) {
  adminPin = savedPin;
  enterDashboard();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'جاري التحقق...';

  const pinVal = pinInput.value.trim();
  const ok = await fetchAdminData(pinVal, { showErrorsInLogin: true });

  loginBtn.disabled = false;
  loginBtn.textContent = 'دخول للوحة';

  if (ok) {
    adminPin = pinVal;
    sessionStorage.setItem(PIN_STORAGE_KEY, pinVal);
    enterDashboard();
  }
});

function enterDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  adminToolbar.classList.remove('hidden');
  fetchAdminData(adminPin, { silent: false });
  startAutoRefresh();
}

function startAutoRefresh() {
  stopAutoRefresh();
  pollTimer = setInterval(() => {
    fetchAdminData(adminPin, { silent: true });
  }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

logoutBtn.addEventListener('click', () => {
  stopAutoRefresh();
  sessionStorage.removeItem(PIN_STORAGE_KEY);
  adminPin = '';
  isFirstLoad = true;
  knownPendingIds.clear();
  dashboardView.classList.add('hidden');
  adminToolbar.classList.add('hidden');
  loginView.classList.remove('hidden');
  pinInput.value = '';
});

soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? 'on' : 'off');
  updateSoundButton();
});

function updateSoundButton() {
  soundToggleBtn.textContent = soundEnabled ? 'الصوت: مفعل' : 'الصوت: مكتوم';
}

manualRefreshBtn.addEventListener('click', () => {
  fetchAdminData(adminPin, { silent: false });
});

filterPills.forEach(pill => {
  pill.addEventListener('click', () => {
    currentFilter = pill.dataset.filter;
    filterPills.forEach(p => p.classList.toggle('active', p === pill));
    renderAdminList();
  });
});

searchEl.addEventListener('input', renderAdminList);

async function fetchAdminData(pin, opts = {}) {
  const { silent = false, showErrorsInLogin = false } = opts;
  if (!silent && !dashboardView.classList.contains('hidden')) {
    listEl.innerHTML = '<p class="placeholder-text">جاري تحديث البيانات...</p>';
  }

  try {
    const url = new URL(WEB_APP_URL);
    url.searchParams.set('action', 'getAdminData');
    url.searchParams.set('pin', pin);

    const res = await fetch(url.toString());
    const json = await res.json();

    if (json.status === 'unauthorized') {
      if (showErrorsInLogin) {
        loginError.textContent = json.message || 'رمز المرور غير صحيح';
        loginError.classList.remove('hidden');
      } else {
        logoutBtn.click();
      }
      return false;
    }

    if (json.status !== 'success') {
      throw new Error(json.message || 'تعذر تحميل البيانات');
    }

    const incomingRequests = json.data.requests || [];
    activeDrivers = json.data.drivers || [];

    checkNewPendingRequests(incomingRequests);
    allRequests = incomingRequests;

    renderStats(json.data.summary);
    renderAdminList();

    const now = new Date();
    lastSyncTimeEl.textContent = 'آخر تحديث: ' + now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return true;
  } catch (err) {
    if (showErrorsInLogin) {
      loginError.textContent = err.message || 'تعذر الاتصال بالخادم';
      loginError.classList.remove('hidden');
    } else if (!silent) {
      listEl.innerHTML = `<p class="placeholder-text">${escapeHtml(err.message)}</p>`;
    }
    return false;
  }
}

function checkNewPendingRequests(requests) {
  const currentPending = new Set(requests.filter(r => r.status === 'Pending').map(r => r.request_id));
  if (!isFirstLoad) {
    let hasNew = false;
    currentPending.forEach(id => {
      if (!knownPendingIds.has(id)) hasNew = true;
    });
    if (hasNew && soundEnabled) {
      playSoftChime();
    }
  }
  knownPendingIds = currentPending;
  isFirstLoad = false;
}

function playSoftChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  } catch {
    // تجاهل أي قيود صوتية من المتصفح
  }
}

function renderStats(summary = {}) {
  document.getElementById('stat-pending').textContent = summary.pending ?? 0;
  document.getElementById('stat-approved').textContent = summary.approved ?? 0;
  document.getElementById('stat-rejected').textContent = summary.rejected ?? 0;

  const topDriver = summary.topDriver || { name: '—', count: 0 };
  document.getElementById('stat-top-driver').textContent = topDriver.name;
  document.getElementById('stat-top-driver-count').textContent = topDriver.count ? `${topDriver.count} مشوار` : '';

  const topDept = summary.topDepartment || { name: '—', count: 0 };
  document.getElementById('stat-top-dept').textContent = topDept.name;
  document.getElementById('stat-top-dept-count').textContent = topDept.count ? `${topDept.count} طلب` : '';
}

function renderAdminList() {
  const q = searchEl.value.trim().toLowerCase();

  const filtered = allRequests.filter(r => {
    const matchStatus = currentFilter === 'ALL' || r.status === currentFilter;
    const matchSearch = !q || [
      r.request_id,
      r.employee_name,
      r.department,
      r.destination,
      r.driver_name
    ].some(val => String(val || '').toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });

  if (!filtered.length) {
    listEl.innerHTML = '<p class="placeholder-text">لا توجد طلبات مطابقة للفلتر الحالي.</p>';
    return;
  }

  const statusLabels = {
    Pending: 'قيد المراجعة',
    Approved: 'تمت الموافقة',
    Rejected: 'مرفوض'
  };

  listEl.innerHTML = filtered.map(req => {
    const statusText = statusLabels[req.status] || req.status;
    const urgentBadge = req.priority === 'Urgent' ? '<span class="urgent-pill">مستعجل</span>' : '';

    let decisionInfoHtml = '';
    if (req.status === 'Approved') {
      decisionInfoHtml = `
        <div class="outcome-box outcome-approved" style="margin-bottom: 12px;">
          السائق: <strong>${escapeHtml(req.driver_name || '—')}</strong>
          ${req.driver_phone ? `(${escapeHtml(req.driver_phone)})` : ''}
          ${req.manager_note ? `— ملاحظات: ${escapeHtml(req.manager_note)}` : ''}
        </div>
      `;
    } else if (req.status === 'Rejected') {
      decisionInfoHtml = `
        <div class="outcome-box outcome-rejected" style="margin-bottom: 12px;">
          سبب الرفض: <strong>${escapeHtml(req.manager_note || '—')}</strong>
        </div>
      `;
    }

    const pendingButtons = req.status === 'Pending' ? `
      <div class="action-group">
        <button type="button" class="btn-approve" onclick="openDecisionModal('${escapeAttr(req.request_id)}', 'Approved')">موافقة وتعيين سائق</button>
        <button type="button" class="btn-reject" onclick="openDecisionModal('${escapeAttr(req.request_id)}', 'Rejected')">رفض</button>
      </div>
    ` : '';

    const whatsappButtons = req.status === 'Approved' ? buildWhatsAppButtons(req) : '';

    return `
      <article class="request-item">
        <div class="item-head">
          <div class="item-id-group">
            <span class="req-code">${escapeHtml(req.request_id)}</span>
            ${urgentBadge}
          </div>
          <span class="state-pill state-${escapeAttr(req.status)}">${escapeHtml(statusText)}</span>
        </div>

        <div class="admin-card-grid">
          <div>الموظف: <strong>${escapeHtml(req.employee_name)}</strong> (${escapeHtml(req.department)})</div>
          <div>موبايل الموظف: <strong>${escapeHtml(req.phone)}</strong></div>
          <div>الميعاد: <strong>${escapeHtml(req.trip_date)} - ${escapeHtml(req.trip_time)}</strong></div>
          <div>الوجهة: <strong>${escapeHtml(req.destination)}</strong></div>
          <div style="grid-column: 1 / -1;">الغرض / ملاحظات: <strong>${escapeHtml(req.purpose || '—')}</strong></div>
        </div>

        ${decisionInfoHtml}

        <div class="card-actions">
          <span style="font-size: 0.78rem; color: var(--muted);">تقديم: ${escapeHtml(req.created_at)}</span>
          <div class="action-group">
            ${pendingButtons}
            ${whatsappButtons}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function buildWhatsAppButtons(req) {
  const empPhone = normalizeEgyptPhone(req.phone);
  const drvPhone = normalizeEgyptPhone(req.driver_phone);

  const empMsg = [
    `مرحباً ${req.employee_name}، تمت الموافقة على طلب السيارة (${req.request_id}).`,
    `الوجهة: ${req.destination}`,
    `الميعاد: ${req.trip_date} الساعة ${req.trip_time}`,
    `السائق: ${req.driver_name || ''}`,
    `رقم السائق: ${req.driver_phone || ''}`,
    req.manager_note ? `ملاحظات: ${req.manager_note}` : ''
  ].filter(Boolean).join('\n');

  const drvMsg = [
    `كابتن ${req.driver_name || ''}، يوجد مشوار معتمد (${req.request_id}):`,
    `الموظف: ${req.employee_name} (${req.department})`,
    `موبايل الموظف: ${req.phone}`,
    `الوجهة: ${req.destination}`,
    `الميعاد: ${req.trip_date} الساعة ${req.trip_time}`,
    req.purpose ? `ملاحظات المشوار: ${req.purpose}` : ''
  ].filter(Boolean).join('\n');

  const empUrl = `https://wa.me/${empPhone}?text=${encodeURIComponent(empMsg)}`;
  const drvUrl = `https://wa.me/${drvPhone}?text=${encodeURIComponent(drvMsg)}`;

  const empBtn = empPhone
    ? `<a class="btn-wa" href="${escapeAttr(empUrl)}" target="_blank" rel="noopener">واتساب الموظف</a>`
    : '';
  const drvBtn = drvPhone
    ? `<a class="btn-wa" href="${escapeAttr(drvUrl)}" target="_blank" rel="noopener">واتساب السائق</a>`
    : '';

  return empBtn + drvBtn;
}

function normalizeEgyptPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return '2' + digits;
  return '20' + digits;
}

function openDecisionModal(requestId, type) {
  const req = allRequests.find(r => r.request_id === requestId);
  if (!req) return;

  activeModalRequest = req;
  activeDecisionType = type;

  modalSummary.textContent = `${req.request_id} — ${req.employee_name} إلى (${req.destination}) يوم ${req.trip_date} الساعة ${req.trip_time}`;
  approveNote.value = '';
  rejectNote.value = '';

  if (type === 'Approved') {
    modalTitle.textContent = 'موافقة وتعيين سائق';
    approveFields.classList.remove('hidden');
    rejectFields.classList.add('hidden');
    modalSubmitBtn.textContent = 'تأكيد الموافقة';

    driverSelect.innerHTML = activeDrivers.length
      ? activeDrivers.map(d => {
          const label = `${d.driver_name}${d.car_details ? ` — ${d.car_details}` : ''} (${d.driver_phone})`;
          return `<option value="${escapeAttr(d.driver_name)}" data-phone="${escapeAttr(d.driver_phone)}">${escapeHtml(label)}</option>`;
        }).join('')
      : '<option value="">لا يوجد سائقون متاحون في شيت Drivers</option>';
  } else {
    modalTitle.textContent = 'رفض الطلب';
    approveFields.classList.add('hidden');
    rejectFields.classList.remove('hidden');
    modalSubmitBtn.textContent = 'تأكيد الرفض';
  }

  modal.classList.remove('hidden');
}

function closeDecisionModal() {
  modal.classList.add('hidden');
  activeModalRequest = null;
}

modalCloseBtn.addEventListener('click', closeDecisionModal);
modalCancelBtn.addEventListener('click', closeDecisionModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeDecisionModal();
});

decisionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeModalRequest) return;

  const payload = {
    action: 'updateRequest',
    pin: adminPin,
    request_id: activeModalRequest.request_id,
    status: activeDecisionType
  };

  if (activeDecisionType === 'Approved') {
    const selectedOpt = driverSelect.options[driverSelect.selectedIndex];
    const driverName = driverSelect.value;
    if (!driverName) {
      alert('من فضلك اختر سائقاً متاحاً');
      return;
    }
    payload.driver_name = driverName;
    payload.driver_phone = selectedOpt ? (selectedOpt.dataset.phone || '') : '';
    payload.manager_note = approveNote.value.trim();
  } else {
    const reason = rejectNote.value.trim();
    if (!reason) {
      alert('من فضلك اكتب سبب الرفض');
      return;
    }
    payload.manager_note = reason;
  }

  modalSubmitBtn.disabled = true;
  modalSubmitBtn.textContent = 'جاري الحفظ...';

  try {
    const res = await fetch(WEB_APP_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.status !== 'success') {
      throw new Error(json.message || 'تعذر حفظ القرار');
    }

    closeDecisionModal();
    await fetchAdminData(adminPin, { silent: false });
  } catch (err) {
    alert(err.message || 'حدث خطأ أثناء التحديث');
  } finally {
    modalSubmitBtn.disabled = false;
    modalSubmitBtn.textContent = activeDecisionType === 'Approved' ? 'تأكيد الموافقة' : 'تأكيد الرفض';
  }
});

exportCsvBtn.addEventListener('click', () => {
  if (!allRequests.length) return;
  const headers = [
    'request_id', 'created_at', 'employee_name', 'department', 'phone',
    'destination', 'trip_date', 'trip_time', 'priority', 'purpose',
    'status', 'driver_name', 'driver_phone', 'manager_note', 'action_at'
  ];

  const csvRows = [
    headers.join(','),
    ...allRequests.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
  ];

  const bom = '\uFEFF';
  const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `car_requests_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
});

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}
/* منع كليك يمين واختصارات F12 وأدوات المطور */
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

document.addEventListener('keydown', (e) => {
  const key = (e.key || '').toLowerCase();
  const isF12 = e.key === 'F12' || e.keyCode === 123;
  const isDevToolsShortcut =
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    ['i', 'j', 'c', 'k'].includes(key);
  const isViewSource = (e.ctrlKey || e.metaKey) && key === 'u';
  const isCopyShortcut =
    (e.ctrlKey || e.metaKey) &&
    key === 'c' &&
    !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '');

  if (isF12 || isDevToolsShortcut || isViewSource || isCopyShortcut) {
    e.preventDefault();
  }
});