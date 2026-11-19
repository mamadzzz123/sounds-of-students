const ADMIN_PASSWORD = "salamfarmande123";

const API_BASE = "/api/letters";
const MAX_FILES = 5;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;

let selectedFiles = [];
let currentStudentName = "";
let selectedLetterId = null;
let activeObjectUrls = [];
let toastTimer;

const pages = document.querySelectorAll(".page");
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toast-message");
const fileList = document.getElementById("file-list");

/* جابه‌جایی میان صفحه‌ها */
function showView(viewName) {
  pages.forEach((page) => page.classList.remove("active"));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => {
    const destination = button.dataset.go;
    if (destination === "admin") renderLetters();
    showView(destination);
  });
});

/* پیام کوتاه وضعیت */
function showToast(message) {
  toastMessage.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3600);
}

/* ارتباط با سرور: پیام‌ها در فایل JSON روی دستگاه میزبان ذخیره می‌شوند. */
async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    // اگر سرور پاسخ JSON نداد، پیام عمومی نمایش داده می‌شود.
  }

  if (!response.ok) {
    throw new Error(payload?.error || `خطای سرور (${response.status})`);
  }
  return payload;
}

async function addLetter(letter) {
  return apiRequest(API_BASE, {
    method: "POST",
    body: JSON.stringify(letter)
  });
}

async function getAllLetters() {
  const payload = await apiRequest(API_BASE);
  return Array.isArray(payload) ? payload : [];
}

async function getLetter(id) {
  return apiRequest(`${API_BASE}/${encodeURIComponent(id)}`);
}

async function deleteLetter(id) {
  return apiRequest(`${API_BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* فرم نام دانش‌آموز */
document.getElementById("identity-form").addEventListener("submit", (event) => {
  event.preventDefault();
  currentStudentName = document.getElementById("student-name").value.trim();
  showView("compose");
});

/* ابزار فایل‌های پیوست */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
}

function renderSelectedFiles() {
  if (selectedFiles.length === 0) {
    fileList.innerHTML = "";
    return;
  }

  fileList.innerHTML = selectedFiles.map((file, index) => `
    <div class="file-item">
      <div class="file-item-name" title="${escapeHtml(file.name)}">
        ${escapeHtml(file.name)}
        <span class="file-item-size">${formatFileSize(file.size)}</span>
      </div>
      <button class="remove-file" type="button" data-remove-file="${index}"
        aria-label="حذف ${escapeHtml(file.name)}" title="حذف فایل">×</button>
    </div>
  `).join("");
}

document.getElementById("letter-files").addEventListener("change", (event) => {
  const incomingFiles = Array.from(event.target.files || []);
  let currentTotal = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  for (const file of incomingFiles) {
    if (selectedFiles.length >= MAX_FILES) {
      showToast(`حداکثر می‌توانی ${MAX_FILES} فایل انتخاب کنی.`);
      break;
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast(`حجم «${file.name}» بیشتر از ۸ مگابایت است.`);
      continue;
    }
    if (currentTotal + file.size > MAX_TOTAL_SIZE) {
      showToast("حجم مجموع فایل‌ها نمی‌تواند بیشتر از ۲۰ مگابایت باشد.");
      continue;
    }
    selectedFiles.push(file);
    currentTotal += file.size;
  }

  event.target.value = "";
  renderSelectedFiles();
});

fileList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-file]");
  if (!button) return;
  selectedFiles.splice(Number(button.dataset.removeFile), 1);
  renderSelectedFiles();
});

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fileToAttachment(file) {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    dataBase64: arrayBufferToBase64(buffer)
  };
}

/* ارسال پیام به سرور */
document.getElementById("letter-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const messageInput = document.getElementById("letter-message");
  const subjectInput = document.getElementById("letter-subject");
  const submitButton = document.getElementById("submit-letter");
  const message = messageInput.value.trim();

  if (!message) {
    messageInput.focus();
    showToast("لطفاً متن نامه را بنویس.");
    return;
  }

  submitButton.disabled = true;
  submitButton.dataset.originalText = submitButton.innerHTML;
  submitButton.innerHTML = "در حال ارسال...";

  try {
    const attachments = await Promise.all(selectedFiles.map(fileToAttachment));
    const letter = {
      id: createId(),
      sender: currentStudentName || "ناشناس",
      subject: subjectInput.value.trim() || "بدون عنوان",
      message,
      createdAt: new Date().toISOString(),
      attachments
    };

    await addLetter(letter);
    event.target.reset();
    selectedFiles = [];
    renderSelectedFiles();
    currentStudentName = "";
    showView("home");
    showToast("پیام شما ارسال و روی سرور ذخیره شد.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "ارسال پیام انجام نشد. اتصال به سرور را بررسی کنید.");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = submitButton.dataset.originalText || "اتمام و ارسال نامه";
    delete submitButton.dataset.originalText;
  }
});

/* ورود مدیریت */
document.getElementById("admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const passwordInput = document.getElementById("admin-password");
  const errorMessage = document.getElementById("login-error");

  if (passwordInput.value === ADMIN_PASSWORD) {
    errorMessage.textContent = "";
    passwordInput.value = "";
    try {
      await renderLetters();
      showView("admin");
    } catch (error) {
      console.error(error);
      errorMessage.textContent = "دریافت پیام‌ها با خطا روبه‌رو شد. سرور روشن است؟";
    }
  } else {
    errorMessage.textContent = "رمز عبور واردشده صحیح نیست.";
    passwordInput.select();
  }
});

/* فهرست پیام‌های موجود روی سرور */
async function renderLetters() {
  const list = document.getElementById("admin-list");
  const count = document.getElementById("letter-count");
  list.innerHTML = '<div class="loading-state">در حال دریافت پیام‌ها...</div>';

  try {
    const letters = await getAllLetters();
    letters.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    count.textContent = `${toPersianNumber(letters.length)} پیام`;

    if (letters.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">✉</span>هنوز نامه‌ای دریافت نشده است.</div>';
      return;
    }

    list.innerHTML = letters.map((letter) => {
      const attachmentCount = (letter.attachments || []).length;
      return `
        <article class="letter-row">
          <button class="letter-open" type="button" data-open-letter="${escapeHtml(letter.id)}">
            <span class="letter-row-title">${escapeHtml(letter.subject || "بدون عنوان")}</span>
            <span class="letter-row-meta">
              <span>فرستنده: ${escapeHtml(letter.sender || "ناشناس")}</span>
              <span>${escapeHtml(formatDate(letter.createdAt))}</span>
              ${attachmentCount ? `<span class="attachment-badge">📎 ${toPersianNumber(attachmentCount)} پیوست</span>` : ""}
            </span>
          </button>
          <button class="open-arrow" type="button" data-open-letter="${escapeHtml(letter.id)}" aria-label="مشاهده نامه">←</button>
        </article>
      `;
    }).join("");
  } catch (error) {
    console.error(error);
    list.innerHTML = '<div class="empty-state">دریافت نامه‌ها ممکن نشد. بررسی کنید سرور روی دستگاه میزبان روشن باشد.</div>';
    throw error;
  }
}

document.getElementById("admin-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-open-letter]");
  if (!button) return;
  await openLetterDetail(button.dataset.openLetter);
});

async function openLetterDetail(id) {
  try {
    const letter = await getLetter(id);
    if (!letter) {
      showToast("این نامه پیدا نشد.");
      await renderLetters();
      showView("admin");
      return;
    }
    selectedLetterId = letter.id;
    renderLetterDetail(letter);
    showView("admin-detail");
  } catch (error) {
    console.error(error);
    showToast(error.message || "باز کردن نامه با خطا روبه‌رو شد.");
  }
}

/* تبدیل پیوست ذخیره‌شده به Blob قابل مشاهده/دانلود در مرورگر */
function base64ToBlob(base64, mimeType) {
  const binary = atob(base64 || "");
  const chunkSize = 1024 * 1024;
  const chunks = [];
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: mimeType || "application/octet-stream" });
}

function revokeAttachmentUrls() {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls = [];
}

function renderLetterDetail(letter) {
  revokeAttachmentUrls();
  const detail = document.getElementById("letter-detail");
  const attachments = letter.attachments || [];

  const attachmentsMarkup = attachments.length ? `
    <h3 class="attachments-heading">فایل‌های پیوست</h3>
    <div class="detail-attachments">
      ${attachments.map((attachment) => {
        const blob = base64ToBlob(attachment.dataBase64, attachment.type);
        const url = URL.createObjectURL(blob);
        activeObjectUrls.push(url);
        const isImage = (attachment.type || "").startsWith("image/");
        return `
          <div class="attachment-card">
            ${isImage ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(attachment.name)}"></a>` : ""}
            <a class="attachment-link" href="${url}" download="${escapeHtml(attachment.name)}">
              ⬇ ${escapeHtml(attachment.name)}<br>
              <span class="file-item-size">${formatFileSize(attachment.size || 0)}</span>
            </a>
          </div>
        `;
      }).join("")}
    </div>
  ` : '<p class="form-footnote">برای این نامه فایلی پیوست نشده است.</p>';

  detail.innerHTML = `
    <article class="detail-card">
      <div class="detail-top"><div>
        <h1 class="detail-title">${escapeHtml(letter.subject || "بدون عنوان")}</h1>
        <div class="detail-meta">
          <span>فرستنده: ${escapeHtml(letter.sender || "ناشناس")}</span>
          <span>${escapeHtml(formatDate(letter.createdAt))}</span>
        </div>
      </div></div>
      <div class="detail-message">${escapeHtml(letter.message || "")}</div>
      ${attachmentsMarkup}
      <div class="detail-actions"><button class="delete-button" id="delete-letter" type="button">حذف این نامه</button></div>
    </article>
  `;

  document.getElementById("delete-letter").addEventListener("click", async () => {
    if (!window.confirm("از حذف این نامه و فایل‌های پیوست آن مطمئن هستید؟")) return;
    try {
      await deleteLetter(selectedLetterId);
      revokeAttachmentUrls();
      selectedLetterId = null;
      await renderLetters();
      showView("admin");
      showToast("نامه حذف شد.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "حذف نامه انجام نشد.");
    }
  });
}

/* ابزارهای کمکی */
function formatDate(dateValue) {
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dateValue));
  } catch {
    return new Date(dateValue).toLocaleString("fa-IR");
  }
}

function toPersianNumber(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const characters = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return characters[character];
  });
}
