const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxs8jxgB8mCwscNzp68-BgF3nyV4YR5UDT_7WHgfFIn9qkqIqyF6aipqBggKaaryAyJww/exec';
const STORAGE_KEY = 'fleet_my_request_ids_v1';

const tabBtns = document.querySelectorAll('.nav-pill');
const tabPanels = document.querySelectorAll('.tab-panel');
const form = document.getElementById('car-request-form');
const submitBtn = document.getElementById('submit-btn');
const submitResult = document.getElementById('submit-result');
const requestsList = document.getElementById('requests-list');
const savedCountEl = document.getElementById('saved-count');
const searchInput = document.getElementById('search-id');
const searchBtn = document.getElementById('search-btn');
const refreshMyBtn = document.getElementById('refresh-my-btn');

document.getElementById('trip_date').valueAsDate = new Date();

function getSavedIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRequestId(id) {
  if (!id) return;
  const current = getSavedIds();
  if (!current.includes(id)) {
    current.unshift(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current.slice(0, 30)));
  }
  updateBadgeCount();
}

function updateBadgeCount() {
  savedCountEl.textContent = getSavedIds().length;
}

function switchTab(targetId) {
  tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === targetId));
  tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === targetId));
  if (targetId === 'track-tab') {
    loadMyRequests();
  }
}

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري الإرسال...';
  submitResult.classList.add('hidden');

  const formData = new FormData(form);
  const payload = {
    action: 'createRequest',
    employee_name: formData.get('employee_name'),
    department: formData.get('department'),
    phone: formData.get('phone'),
    priority: formData.get('priority'),
    destination: formData.get('destination'),
    trip_date: formData.get('trip_date'),
    trip_time: formData.get('trip_time'),
    purpose: formData.get('purpose')
  };

  try {
    const res = await fetch(WEB_APP_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.status === 'success') {
      const reqId = json.data.request_id;
      saveRequestId(reqId);
      form.reset();
      document.getElementById('trip_date').valueAsDate = new Date();

      submitResult.className = 'notice-banner';
      submitResult.innerHTML = `
        <div><strong>تم تسجيل طلبك بنجاح</strong></div>
        <div style="margin-top:6px;">
          رقم الطلب: <strong>${escapeHtml(reqId)}</strong>
          <button type="button" class="btn-copy" onclick="copyCode('${escapeHtml(reqId)}', this)">نسخ الكود</button>
        </div>
        <div style="margin-top:6px; font-size:0.86rem; color:#475569;">
          تم حفظ الرقم تلقائياً لمتابعة حالة الطلب ومعرفة بيانات السائق من تبويب "متابعة طلباتي".
        </div>
      `;
    } else {
      throw new Error(json.message || 'حدث خطأ أثناء إرسال الطلب');
    }
  } catch (err) {
    submitResult.className = 'notice-banner error';
    submitResult.textContent = err.message || 'تعذر الاتصال بالخادم';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'إرسال الطلب';
  }
});

async function loadMyRequests(specificId = '') {
  requestsList.innerHTML = '<p class="placeholder-text">جاري تحميل طلباتك...</p>';

  const ids = getSavedIds();
  if (!specificId && ids.length === 0) {
    requestsList.innerHTML = '<p class="placeholder-text">لا توجد طلبات محفوظة على هذا الجهاز بعد. يمكنك البحث برقم طلب محدد بالأعلى.</p>';
    return;
  }

  try {
    const url = new URL(WEB_APP_URL);
    url.searchParams.set('action', 'getEmployeeData');
    if (specificId) {
      url.searchParams.set('requestId', specificId);
    } else {
      url.searchParams.set('ids', ids.join(','));
    }

    const res = await fetch(url.toString());
    const json = await res.json();

    if (json.status !== 'success') {
      throw new Error(json.message || 'تعذر جلب البيانات');
    }

    renderRequests(json.data || []);
  } catch (err) {
    requestsList.innerHTML = `<p class="placeholder-text">${escapeHtml(err.message)}</p>`;
  }
}

function renderRequests(list) {
  if (!list.length) {
    requestsList.innerHTML = '<p class="placeholder-text">لم يتم العثور على طلبات مطابقة.</p>';
    return;
  }

  const statusLabels = {
    Pending: 'قيد المراجعة',
    Approved: 'تمت الموافقة',
    Rejected: 'مرفوض'
  };

  requestsList.innerHTML = list.map(req => {
    const statusText = statusLabels[req.status] || req.status;
    const urgentBadge = req.priority === 'Urgent' ? '<span class="urgent-pill">مستعجل</span>' : '';

    let outcomeHtml = '';
    if (req.status === 'Approved') {
      const telLink = req.driver_phone
        ? `<a href="tel:${escapeAttr(req.driver_phone)}">${escapeHtml(req.driver_phone)}</a>`
        : 'غير متوفر';
      outcomeHtml = `
        <div class="outcome-box outcome-approved">
          <div><strong>بيانات السائق المعين:</strong></div>
          <div style="margin-top:4px;">الاسم: <strong>${escapeHtml(req.driver_name || 'سيتم التحديد')}</strong></div>
          <div>رقم الموبايل: <strong>${telLink}</strong></div>
          ${req.manager_note ? `<div style="margin-top:4px;">ملاحظات: ${escapeHtml(req.manager_note)}</div>` : ''}
        </div>
      `;
    } else if (req.status === 'Rejected') {
      outcomeHtml = `
        <div class="outcome-box outcome-rejected">
          <strong>سبب الرفض:</strong> ${escapeHtml(req.manager_note || 'لم يتم تحديد سبب')}
        </div>
      `;
    }

    return `
      <article class="request-item">
        <div class="item-head">
          <div class="item-id-group">
            <span class="req-code">${escapeHtml(req.request_id)}</span>
            ${urgentBadge}
          </div>
          <span class="state-pill state-${escapeAttr(req.status)}">${escapeHtml(statusText)}</span>
        </div>
        <div class="item-details">
          <div>الوجهة: <strong>${escapeHtml(req.destination)}</strong></div>
          <div>الميعاد: <strong>${escapeHtml(req.trip_date)} - ${escapeHtml(req.trip_time)}</strong></div>
          <div>الموظف: <strong>${escapeHtml(req.employee_name)}</strong></div>
          <div>القسم: <strong>${escapeHtml(req.department)}</strong></div>
        </div>
        ${outcomeHtml}
      </article>
    `;
  }).join('');
}

searchBtn.addEventListener('click', () => {
  loadMyRequests(searchInput.value.trim());
});

refreshMyBtn.addEventListener('click', () => {
  searchInput.value = '';
  loadMyRequests();
});

function copyCode(code, btnEl) {
  navigator.clipboard?.writeText(code);
  if (btnEl) {
    const oldText = btnEl.textContent;
    btnEl.textContent = 'تم النسخ';
    setTimeout(() => { btnEl.textContent = oldText; }, 1400);
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

updateBadgeCount();
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