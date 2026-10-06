let token = localStorage.getItem("barq_token") || "";
let currentUser = null;
let currentAssignOrder = null;
let managerUsersCache = [];

/* =========================
   أدوات عامة
========================= */

function $(id) {
  return document.getElementById(id);
}

function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  $(id)?.classList.add("active");
  window.scrollTo(0, 0);
}

function openRoles() {
  showPage("rolesPage");
}

function chooseRole(role) {
  const pages = {
    customer: "customerAuth",
    store: "storeAuth",
    driver: "driverAuth",
    admin: "adminAuth",
    manager: "managerAuth"
  };
  showPage(pages[role]);
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.classList.remove("hidden");

  clearTimeout(window.barqToastTimer);
  window.barqToastTimer = setTimeout(() => {
    box.classList.add("hidden");
  }, 3000);
}

async function api(url, options = {}) {
  options.headers = options.headers || {};

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    typeof options.body !== "string"
  ) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, options);

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || "حدث خطأ، حاول مرة أخرى");
  }

  return data;
}

function logout() {
  localStorage.removeItem("barq_token");
  token = "";
  currentUser = null;
  showPage("welcomePage");
  toast("تم تسجيل الخروج");
}

/* =========================
   تبديل التسجيل / الدخول
========================= */

function customerMode(mode) {
  $("customerRegisterForm").classList.toggle("hidden", mode !== "register");
  $("customerLoginForm").classList.toggle("hidden", mode !== "login");

  $("customerRegisterTab").classList.toggle("active", mode === "register");
  $("customerLoginTab").classList.toggle("active", mode === "login");
}

function storeMode(mode) {
  $("storeRegisterForm").classList.toggle("hidden", mode !== "register");
  $("storeLoginForm").classList.toggle("hidden", mode !== "login");

  $("storeRegisterTab").classList.toggle("active", mode === "register");
  $("storeLoginTab").classList.toggle("active", mode === "login");
}

function driverMode(mode) {
  $("driverRegisterForm").classList.toggle("hidden", mode !== "register");
  $("driverLoginForm").classList.toggle("hidden", mode !== "login");

  $("driverRegisterTab").classList.toggle("active", mode === "register");
  $("driverLoginTab").classList.toggle("active", mode === "login");
}

/* =========================
   التسجيل
========================= */

async function registerCustomer(event) {
  event.preventDefault();

  try {
    const data = await api("/api/register/customer", {
      method: "POST",
      body: {
        name: $("customerName").value.trim(),
        phone: $("customerPhone").value.trim()
      }
    });

    $("customerNewCode").innerHTML = `
      تم إنشاء حسابك بنجاح ⚡
      <small style="display:block">احتفظ بكود العميل، ستحتاجه للدخول واستلام الطلبيات</small>
      <strong>${escapeHTML(data.customer_code)}</strong>
    `;

    $("customerNewCode").classList.remove("hidden");

    $("customerLoginPhone").value = data.phone;
    $("customerCode").value = data.customer_code;

    toast("تم إنشاء حساب العميل");
  } catch (error) {
    toast(error.message);
  }
}

async function registerStore(event) {
  event.preventDefault();

  try {
    await api("/api/register/store", {
      method: "POST",
      body: {
        name: $("storeName").value.trim(),
        phone: $("storePhone").value.trim()
      }
    });

    event.target.reset();
    toast("تم إرسال طلب المتجر للإدارة للموافقة");
    storeMode("login");
  } catch (error) {
    toast(error.message);
  }
}

async function registerDriver(event) {
  event.preventDefault();

  const file = $("driverLicense").files[0];

  if (!file) {
    toast("اختر صورة رخصة القيادة");
    return;
  }

  const form = new FormData();
  form.append("name", $("driverName").value.trim());
  form.append("phone", $("driverPhone").value.trim());
  form.append("license", file);

  try {
    await api("/api/register/driver", {
      method: "POST",
      body: form
    });

    event.target.reset();
    toast("تم إرسال طلب السائق للإدارة للموافقة");
    driverMode("login");
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   تسجيل الدخول
========================= */

async function loginCustomer(event) {
  event.preventDefault();

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: {
        role: "customer",
        phone: $("customerLoginPhone").value.trim(),
        code: $("customerCode").value.trim()
      }
    });

    completeLogin(data);
  } catch (error) {
    toast(error.message);
  }
}

async function loginSimple(event, role) {
  event.preventDefault();

  const phone =
    role === "store"
      ? $("storeLoginPhone").value.trim()
      : $("driverLoginPhone").value.trim();

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: { role, phone }
    });

    completeLogin(data);
  } catch (error) {
    toast(error.message);
  }
}

async function loginStaff(event, role) {
  event.preventDefault();

  const username =
    role === "admin"
      ? $("adminUsername").value.trim()
      : $("managerUsername").value.trim();

  const password =
    role === "admin"
      ? $("adminPassword").value
      : $("managerPassword").value;

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: { role, username, password }
    });

    completeLogin(data);
  } catch (error) {
    toast(error.message);
  }
}

async function completeLogin(data) {
  token = data.token;
  currentUser = data.user;

  localStorage.setItem("barq_token", token);

  showPage("dashboardPage");
  await prepareDashboard();
}

/* =========================
   لوحة التحكم
========================= */

async function prepareDashboard() {
  if (!currentUser) {
    try {
      currentUser = await api("/api/me");
    } catch {
      logout();
      return;
    }
  }

  const roleNames = {
    customer: "بوابة العميل",
    store: "بوابة المتجر",
    driver: "بوابة السائق",
    admin: "لوحة الإداري",
    manager: "لوحة المدير"
  };

  $("roleTitle").textContent = roleNames[currentUser.role] || "لوحة التحكم";
  $("welcomeName").textContent = currentUser.name || "مستخدم برق";

  $("customerCodeBadge").classList.add("hidden");
  $("storeOrderBox").classList.add("hidden");
  $("approvalsPanel").classList.add("hidden");
  $("adminOrdersPanel").classList.add("hidden");
  $("managerUsersPanel").classList.add("hidden");

  if (currentUser.role === "customer" && currentUser.customer_code) {
    $("customerCodeBadge").classList.remove("hidden");
    $("myCustomerCode").textContent = currentUser.customer_code;
  }

  if (currentUser.role === "store") {
    $("storeOrderBox").classList.remove("hidden");
  }

  if (currentUser.role === "admin" || currentUser.role === "manager") {
    $("approvalsPanel").classList.remove("hidden");
    $("adminOrdersPanel").classList.remove("hidden");
  }

  if (currentUser.role === "manager") {
    $("managerUsersPanel").classList.remove("hidden");
  }

  if (currentUser.role === "driver") {
    $("ordersTitle").textContent = "الطلبيات";
    $("ordersSubtitle").textContent = "الطلبيات المرسلة إليك من الإدارة";
  } else {
    $("ordersTitle").textContent = "الطلبيات";
    $("ordersSubtitle").textContent = "متابعة حالة الطلبات";
  }

  await refreshDashboard();
}

async function refreshDashboard() {
  try {
    const jobs = [loadOrders(), loadInvoices()];

    if (currentUser.role === "admin" || currentUser.role === "manager") {
      jobs.push(loadPendingUsers());
      jobs.push(loadAdminOrders());
    }

    if (currentUser.role === "manager") {
      jobs.push(loadManagerUsers());
    }

    await Promise.all(jobs);
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   المتجر
========================= */

async function createOrder(event) {
  event.preventDefault();

  try {
    await api("/api/store/orders", {
      method: "POST",
      body: {
        parcelCode: $("parcelCode").value.trim(),
        customerCode: $("orderCustomerCode").value.trim()
      }
    });

    event.target.reset();
    toast("تم إرسال الطرد للإدارة ⚡");
    await loadOrders();
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   الطلبات
========================= */

function statusInfo(status) {
  const statuses = {
    pending: {
      text: "بانتظار الإدارة",
      css: "pending"
    },
    out_for_delivery: {
      text: "قيد التوصيل",
      css: "out_for_delivery"
    },
    delivered: {
      text: "وصلت ✓",
      css: "delivered"
    }
  };

  return statuses[status] || {
    text: status || "غير محدد",
    css: "pending"
  };
}

async function loadOrders() {
  const orders = await api("/api/orders");
  const box = $("myOrders");

  if (!orders.length) {
    box.innerHTML = `<div class="empty">لا توجد طلبيات حتى الآن ⚡</div>`;
    renderStats([]);
    return;
  }

  box.innerHTML = orders.map(order => {
    const status = statusInfo(order.status);

    let extra = "";

    if (order.store_name) {
      extra += `<span>المتجر: ${escapeHTML(order.store_name)}</span>`;
    }

    if (order.customer_name) {
      extra += `<span>العميل: ${escapeHTML(order.customer_name)}</span>`;
    }

    if (order.driver_name) {
      extra += `<span>السائق: ${escapeHTML(order.driver_name)}</span>`;
    }

    if (order.admin_message && currentUser.role === "driver") {
      extra += `<span>ملاحظة الإدارة: ${escapeHTML(order.admin_message)}</span>`;
    }

    if (order.link && currentUser.role === "driver") {
      const safeLink = escapeHTML(order.link);
      extra += `
        <span>
          <a href="${safeLink}" target="_blank" rel="noopener noreferrer"
             style="color:#ffd76a">
             فتح الرابط
          </a>
        </span>
      `;
    }

    let action = "";

    if (
      currentUser.role === "driver" &&
      order.status === "out_for_delivery"
    ) {
      action = `
        <button class="action-btn success"
                style="margin-top:14px"
                onclick="markDelivered(${Number(order.id)})">
          ✓ تم التوصيل
        </button>
      `;
    }

    return `
      <article class="order-card">
        <div class="order-code">
          ${escapeHTML(order.parcel_code)}
        </div>

        <div class="order-meta">
          ${extra}
          <span>
            التاريخ:
            ${formatDate(order.created_at)}
          </span>
        </div>

        <span class="status ${status.css}">
          ${status.text}
        </span>

        ${action}
      </article>
    `;
  }).join("");

  renderStats(orders);
}

function renderStats(orders) {
  const total = orders.length;
  const pending = orders.filter(o => o.status === "pending").length;
  const delivery = orders.filter(o => o.status === "out_for_delivery").length;
  const delivered = orders.filter(o => o.status === "delivered").length;

  $("stats").innerHTML = `
    <div class="stat">
      <small>كل الطلبيات</small>
      <strong>${total}</strong>
    </div>

    <div class="stat">
      <small>بانتظار الإدارة</small>
      <strong>${pending}</strong>
    </div>

    <div class="stat">
      <small>قيد التوصيل</small>
      <strong>${delivery}</strong>
    </div>

    <div class="stat">
      <small>تم التوصيل</small>
      <strong>${delivered}</strong>
    </div>
  `;
}

async function markDelivered(id) {
  if (!confirm("تأكيد أن الطلب وصل للعميل؟")) return;

  try {
    await api(`/api/driver/orders/${id}/delivered`, {
      method: "POST"
    });

    toast("تم تسجيل التوصيل وإنشاء فاتورة ✓");
    await refreshDashboard();
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   موافقات الإدارة
========================= */

async function loadPendingUsers() {
  const users = await api("/api/admin/pending-users");

  $("pendingCount").textContent = users.length;

  if (!users.length) {
    $("pendingUsers").innerHTML =
      `<div class="empty">لا توجد طلبات تسجيل جديدة</div>`;
    return;
  }

  $("pendingUsers").innerHTML = users.map(user => {
    const role =
      user.role === "driver" ? "سائق" :
      user.role === "store" ? "متجر" : user.role;

    const license = user.license_image
      ? `
        <button class="action-btn"
                onclick="viewLicense('${user.license_image}')">
          عرض الرخصة
        </button>
      `
      : "";

    return `
      <div class="list-item">
        <div class="list-main">
          <strong>${escapeHTML(user.name)}</strong>
          <small>${role} • ${escapeHTML(user.phone || "")}</small>
          <small>${formatDate(user.created_at)}</small>
        </div>

        <div class="actions">
          ${license}

          <button class="action-btn success"
                  onclick="approveUser(${Number(user.id)})">
            ✓ موافقة
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function viewLicense(src) {
  const win = window.open();
  if (!win) {
    toast("المتصفح منع فتح الصورة");
    return;
  }

  win.document.write(`
    <body style="margin:0;background:#111;display:grid;place-items:center;min-height:100vh">
      <img src="${src}"
           style="max-width:95%;max-height:95vh;object-fit:contain">
    </body>
  `);
}

async function approveUser(id) {
  try {
    await api(`/api/admin/users/${id}/approve`, {
      method: "POST"
    });

    toast("تم تفعيل الحساب ✓");
    await loadPendingUsers();

    if (currentUser.role === "manager") {
      await loadManagerUsers();
    }
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   إدارة الطلبات
========================= */

async function loadAdminOrders() {
  const orders = await api("/api/admin/orders");

  if (!orders.length) {
    $("adminOrders").innerHTML =
      `<div class="empty">لا توجد طلبيات واردة</div>`;
    return;
  }

  $("adminOrders").innerHTML = orders.map(order => {
    const status = statusInfo(order.status);

    const assignButton =
      order.status !== "delivered"
        ? `
          <button class="action-btn"
                  onclick="openAssign(${Number(order.id)}, '${encodeURIComponent(order.parcel_code)}')">
            ${order.driver_id ? "تغيير السائق" : "إرسال لسائق"}
          </button>
        `
        : "";

    return `
      <div class="list-item">
        <div class="list-main">
          <strong>
            طرد: ${escapeHTML(order.parcel_code)}
          </strong>

          <small>
            المتجر: ${escapeHTML(order.store_name || "—")}
          </small>

          <small>
            العميل: ${escapeHTML(order.customer_name || "—")}
            ${order.customer_code ? ` • ${escapeHTML(order.customer_code)}` : ""}
          </small>

          <small>
            السائق: ${escapeHTML(order.driver_name || "لم يتم التعيين")}
          </small>

          <span class="status ${status.css}">
            ${status.text}
          </span>
        </div>

        <div class="actions">
          ${assignButton}
        </div>
      </div>
    `;
  }).join("");
}

async function openAssign(id, encodedParcel) {
  currentAssignOrder = id;

  $("assignParcel").textContent =
    "كود الطرد: " + decodeURIComponent(encodedParcel);

  $("assignMessage").value = "";
  $("assignLink").value = "";

  try {
    const drivers = await api("/api/admin/drivers");

    if (!drivers.length) {
      toast("لا يوجد سائقون معتمدون حالياً");
      return;
    }

    $("assignDriver").innerHTML = drivers.map(driver => `
      <option value="${Number(driver.id)}">
        ${escapeHTML(driver.name)} — ${escapeHTML(driver.phone || "")}
      </option>
    `).join("");

    $("assignModal").classList.remove("hidden");
  } catch (error) {
    toast(error.message);
  }
}

function closeAssign() {
  $("assignModal").classList.add("hidden");
  currentAssignOrder = null;
}

async function confirmAssign() {
  if (!currentAssignOrder) return;

  try {
    await api(`/api/admin/orders/${currentAssignOrder}/assign`, {
      method: "POST",
      body: {
        driverId: Number($("assignDriver").value),
        message: $("assignMessage").value.trim(),
        link: $("assignLink").value.trim()
      }
    });

    closeAssign();
    toast("تم إرسال الطلب للسائق ⚡");
    await loadAdminOrders();
    await loadOrders();
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   المدير
========================= */

async function loadManagerUsers() {
  managerUsersCache = await api("/api/manager/users");
  renderManagerUsers(managerUsersCache);
}

function renderManagerUsers(users) {
  if (!users.length) {
    $("managerUsers").innerHTML =
      `<div class="empty">لا توجد حسابات</div>`;
    return;
  }

  const roleNames = {
    customer: "عميل",
    store: "متجر",
    driver: "سائق",
    admin: "إداري",
    manager: "مدير"
  };

  $("managerUsers").innerHTML = users.map(user => {
    const isManager = user.role === "manager";

    return `
      <div class="list-item">
        <div class="list-main">
          <strong>
            ${escapeHTML(user.name)}
            ${user.active === false ? " — معطل" : ""}
          </strong>

          <small>
            ${roleNames[user.role] || escapeHTML(user.role)}
            ${user.phone ? ` • ${escapeHTML(user.phone)}` : ""}
          </small>

          ${
            user.customer_code
              ? `<small>كود العميل: ${escapeHTML(user.customer_code)}</small>`
              : ""
          }
        </div>

        <div class="actions">
          ${
            !isManager && user.active !== false
              ? `
                <button class="action-btn danger"
                        onclick="disableUser(${Number(user.id)}, '${encodeURIComponent(user.name)}')">
                  تعطيل الحساب
                </button>
              `
              : ""
          }
        </div>
      </div>
    `;
  }).join("");
}

function filterManagerUsers() {
  const text = $("userSearch").value.trim().toLowerCase();

  const filtered = managerUsersCache.filter(user => {
    return [
      user.name,
      user.phone,
      user.role,
      user.customer_code,
      user.username
    ]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(text));
  });

  renderManagerUsers(filtered);
}

async function disableUser(id, encodedName) {
  const name = decodeURIComponent(encodedName);

  if (!confirm(`هل تريد تعطيل حساب ${name}؟`)) return;

  try {
    await api(`/api/manager/users/${id}/disable`, {
      method: "POST"
    });

    toast("تم تعطيل الحساب");
    await loadManagerUsers();
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   فواتير وأرشيف التوصيل
========================= */

async function loadInvoices() {
  const invoices = await api("/api/invoices");

  if (!invoices.length) {
    $("invoices").innerHTML =
      `<div class="empty">لا توجد فواتير توصيل حتى الآن</div>`;
    return;
  }

  $("invoices").innerHTML = invoices.map(invoice => `
    <div class="list-item">
      <div class="list-main">
        <strong>
          فاتورة توصيل • ${escapeHTML(invoice.parcel_code || "—")}
        </strong>

        <small>
          المتجر: ${escapeHTML(invoice.store_name || "—")}
        </small>

        <small>
          العميل: ${escapeHTML(invoice.customer_name || "—")}
        </small>

        <small>
          السائق: ${escapeHTML(invoice.driver_name || "—")}
        </small>

        <small>
          تم التسليم: ${formatDate(invoice.delivered_at)}
        </small>
      </div>

      <span class="status delivered">
        تم التسليم ✓
      </span>
    </div>
  `).join("");
}

/* =========================
   الوقت
========================= */

function formatDate(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("ar", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return value;
  }
}

/* =========================
   بدء الموقع
========================= */

async function startBarq() {
  if (!token) {
    showPage("welcomePage");
    return;
  }

  try {
    currentUser = await api("/api/me");
    showPage("dashboardPage");
    await prepareDashboard();
  } catch {
    localStorage.removeItem("barq_token");
    token = "";
    showPage("welcomePage");
  }
}

startBarq();
