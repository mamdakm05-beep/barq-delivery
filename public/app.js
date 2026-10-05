let map, marker, geo, sel, key = "";
const $ = x => document.getElementById(x);

function show(x) {
  ["join", "loc", "done", "panel"].forEach(i => {
    const el = $(i);
    if (el) el.classList.add("hide");
  });
  const el = $(x);
  if (el) el.classList.remove("hide");
}

function next() {
  const name = $("name");
  const phone = $("phone");

  if (!name || !phone) {
    alert("حدث خطأ في الصفحة");
    return;
  }

  if (!name.value.trim() || !phone.value.trim()) {
    alert("اكتب الاسم ورقم الهاتف");
    return;
  }

  show("loc");

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);
}

function init() {
  if (typeof L === "undefined") {
    console.error("Leaflet لم يتم تحميله");
    return;
  }

  map = L.map("map").setView([27, 17], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  map.on("click", e => {
    sel = {
      lat: e.latlng.lat,
      lng: e.latlng.lng
    };

    if (marker) {
      marker.setLatLng(e.latlng);
    } else {
      marker = L.marker(e.latlng).addTo(map);
    }
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => {
        const pos = [p.coords.latitude, p.coords.longitude];
        map.setView(pos, 15);

        sel = {
          lat: p.coords.latitude,
          lng: p.coords.longitude
        };

        marker = L.marker(pos).addTo(map);
      },
      () => console.log("لم يتم السماح بالموقع")
    );
  }
}

async function save() {
  if (!sel) {
    alert("حدد موقعك على الخريطة أولاً");
    return;
  }

  const r = await fetch("/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: $("name").value.trim(),
      phone: $("phone").value.trim(),
      ...sel
    })
  });

  if (!r.ok) {
    alert("حدث خطأ، حاول مرة أخرى");
    return;
  }

  show("done");
}

function admin() {
  $("modal")?.classList.remove("hide");
}

async function login() {
  const r = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: $("ap")?.value,
      password: $("pw")?.value
    })
  });

  if (!r.ok) {
    const err = $("err");
    if (err) err.textContent = "بيانات الدخول غير صحيحة";
    return;
  }

  $("modal")?.classList.add("hide");
  show("panel");
  await load();
}

async function load() {
  const r = await fetch("/api/admin/customers");
  if (!r.ok) return;

  const a = await r.json();
  const box = $("customers");
  if (!box) return;

  box.innerHTML = a.map(c => `
    <div class="customer">
      <b>${e(c.name)}</b>
      <span>${e(c.phone)}</span>
    </div>
  `).join("");
}

function e(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.next = next;
window.save = save;
window.admin = admin;
window.login = login;

window.addEventListener("load", init);
