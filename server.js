const express = require("express");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

// PostgreSQL
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ملفات رخص السائقين
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname, "public")));

// =========================
// إنشاء قاعدة البيانات
// =========================

async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      customer_code TEXT UNIQUE,
      username TEXT,
      password TEXT,
      license_image TEXT,
      status TEXT DEFAULT 'pending',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      parcel_code TEXT NOT NULL,
      store_id INTEGER,
      customer_id INTEGER,
      driver_id INTEGER,
      admin_message TEXT,
      link TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      delivered_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      order_id INTEGER,
      parcel_code TEXT,
      store_name TEXT,
      customer_name TEXT,
      driver_name TEXT,
      delivered_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // الإداري MOH
  const adminPassword = process.env.ADMIN_PASSWORD || "123456";

  const admin = await pool.query(
    "SELECT id FROM users WHERE role='admin' AND username='MOH'"
  );

  if (!admin.rows.length) {
    await pool.query(
      `INSERT INTO users
       (role,name,username,password,status,active)
       VALUES ('admin','MOH','MOH',$1,'approved',TRUE)`,
      [adminPassword]
    );
  }

  // المدير
  const managerUsername = process.env.MANAGER_USERNAME || "MANAGER";
  const managerPassword = process.env.MANAGER_PASSWORD || "123456";

  const manager = await pool.query(
    "SELECT id FROM users WHERE role='manager' LIMIT 1"
  );

  if (!manager.rows.length) {
    await pool.query(
      `INSERT INTO users
       (role,name,username,password,status,active)
       VALUES ('manager','مدير برق',$1,$2,'approved',TRUE)`,
      [managerUsername, managerPassword]
    );
  }
}

// =========================
// أدوات
// =========================

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

const sessions = new Map();

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({ error: "يجب تسجيل الدخول" });
  }

  req.user = session;
  next();
}

function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "ليس لديك صلاحية" });
    }
    next();
  };
}

async function createCustomerCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));

    const exists = await pool.query(
      "SELECT id FROM users WHERE customer_code=$1",
      [code]
    );

    if (!exists.rows.length) return code;
  }

  throw new Error("تعذر إنشاء كود عميل");
}

// =========================
// التسجيل
// =========================

// تسجيل عميل
app.post("/api/register/customer", async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "الاسم ورقم الهاتف مطلوبان" });
    }

    const code = await createCustomerCode();

    const result = await pool.query(
      `INSERT INTO users
       (role,name,phone,customer_code,status,active)
       VALUES ('customer',$1,$2,$3,'approved',TRUE)
       RETURNING id,name,phone,customer_code,role,status`,
      [name.trim(), phone.trim(), code]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "حدث خطأ" });
  }
});

// تسجيل متجر
app.post("/api/register/store", async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "اسم المتجر ورقم الهاتف مطلوبان" });
    }

    const result = await pool.query(
      `INSERT INTO users
       (role,name,phone,status,active)
       VALUES ('store',$1,$2,'pending',TRUE)
       RETURNING id,name,phone,role,status`,
      [name.trim(), phone.trim()]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "حدث خطأ" });
  }
});

// تسجيل سائق
app.post(
  "/api/register/driver",
  upload.single("license"),
  async (req, res) => {
    try {
      const { name, phone } = req.body;

      if (!name || !phone || !req.file) {
        return res.status(400).json({
          error: "الاسم ورقم الهاتف وصورة الرخصة مطلوبة"
        });
      }

      const license =
        `data:${req.file.mimetype};base64,` +
        req.file.buffer.toString("base64");

      const result = await pool.query(
        `INSERT INTO users
         (role,name,phone,license_image,status,active)
         VALUES ('driver',$1,$2,$3,'pending',TRUE)
         RETURNING id,name,phone,role,status`,
        [name.trim(), phone.trim(), license]
      );

      res.json(result.rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "حدث خطأ" });
    }
  }
);

// =========================
// تسجيل الدخول
// =========================

app.post("/api/login", async (req, res) => {
  try {
    const { role, phone, code, username, password } = req.body;

    let result;

    if (role === "admin" || role === "manager") {
      result = await pool.query(
        `SELECT * FROM users
         WHERE role=$1 AND username=$2 AND password=$3 AND active=TRUE`,
        [role, username, password]
      );
    } else if (role === "customer") {
      result = await pool.query(
        `SELECT * FROM users
         WHERE role='customer'
         AND phone=$1
         AND customer_code=$2
         AND active=TRUE`,
        [phone, code]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM users
         WHERE role=$1 AND phone=$2 AND active=TRUE`,
        [role, phone]
      );
    }

    if (!result.rows.length) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    }

    const user = result.rows[0];

    if (
      ["store", "driver"].includes(user.role) &&
      user.status !== "approved"
    ) {
      return res.status(403).json({
        error: "حسابك في انتظار موافقة الإدارة"
      });
    }

    const token = makeToken();

    sessions.set(token, {
      id: user.id,
      role: user.role,
      name: user.name
    });

    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        phone: user.phone,
        customer_code: user.customer_code
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "حدث خطأ" });
  }
});

// =========================
// معلومات المستخدم
// =========================

app.get("/api/me", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT id,role,name,phone,customer_code,status,active,created_at
     FROM users WHERE id=$1`,
    [req.user.id]
  );

  res.json(result.rows[0]);
});

// =========================
// المتجر
// =========================

app.post(
  "/api/store/orders",
  auth,
  allow("store"),
  async (req, res) => {
    try {
      const { parcelCode, customerCode } = req.body;

      if (!parcelCode || !customerCode) {
        return res.status(400).json({
          error: "كود الطرد وكود العميل مطلوبان"
        });
      }

      const customer = await pool.query(
        `SELECT id FROM users
         WHERE role='customer'
         AND customer_code=$1
         AND active=TRUE`,
        [customerCode]
      );

      if (!customer.rows.length) {
        return res.status(404).json({ error: "كود العميل غير موجود" });
      }

      const result = await pool.query(
        `INSERT INTO orders
         (parcel_code,store_id,customer_id,status)
         VALUES ($1,$2,$3,'pending')
         RETURNING *`,
        [parcelCode.trim(), req.user.id, customer.rows[0].id]
      );

      res.json(result.rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "حدث خطأ" });
    }
  }
);

// =========================
// الإداري
// =========================

app.get(
  "/api/admin/pending-users",
  auth,
  allow("admin", "manager"),
  async (req, res) => {
    const result = await pool.query(
      `SELECT id,role,name,phone,license_image,status,created_at
       FROM users
       WHERE status='pending' AND active=TRUE
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  }
);

app.post(
  "/api/admin/users/:id/approve",
  auth,
  allow("admin", "manager"),
  async (req, res) => {
    await pool.query(
      "UPDATE users SET status='approved' WHERE id=$1",
      [req.params.id]
    );

    res.json({ success: true });
  }
);

app.get(
  "/api/admin/orders",
  auth,
  allow("admin", "manager"),
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        o.*,
        s.name AS store_name,
        c.name AS customer_name,
        c.customer_code,
        d.name AS driver_name
      FROM orders o
      LEFT JOIN users s ON s.id=o.store_id
      LEFT JOIN users c ON c.id=o.customer_id
      LEFT JOIN users d ON d.id=o.driver_id
      ORDER BY o.created_at DESC
    `);

    res.json(result.rows);
  }
);

app.get(
  "/api/admin/drivers",
  auth,
  allow("admin", "manager"),
  async (req, res) => {
    const result = await pool.query(
      `SELECT id,name,phone
       FROM users
       WHERE role='driver'
       AND status='approved'
       AND active=TRUE
       ORDER BY name`
    );

    res.json(result.rows);
  }
);

app.post(
  "/api/admin/orders/:id/assign",
  auth,
  allow("admin", "manager"),
  async (req, res) => {
    const { driverId, message, link } = req.body;

    if (!driverId) {
      return res.status(400).json({ error: "اختر السائق" });
    }

    await pool.query(
      `UPDATE orders
       SET driver_id=$1,
           admin_message=$2,
           link=$3,
           status='out_for_delivery'
       WHERE id=$4`,
      [driverId, message || "", link || "", req.params.id]
    );

    res.json({ success: true });
  }
);

// =========================
// طلبات المستخدمين
// =========================

app.get("/api/orders", auth, async (req, res) => {
  let query;
  let values;

  if (req.user.role === "customer") {
    query = `
      SELECT o.*,s.name store_name,d.name driver_name
      FROM orders o
      LEFT JOIN users s ON s.id=o.store_id
      LEFT JOIN users d ON d.id=o.driver_id
      WHERE o.customer_id=$1
      ORDER BY o.created_at DESC
    `;
    values = [req.user.id];
  } else if (req.user.role === "store") {
    query = `
      SELECT o.*,c.name customer_name,d.name driver_name
      FROM orders o
      LEFT JOIN users c ON c.id=o.customer_id
      LEFT JOIN users d ON d.id=o.driver_id
      WHERE o.store_id=$1
      ORDER BY o.created_at DESC
    `;
    values = [req.user.id];
  } else if (req.user.role === "driver") {
    query = `
      SELECT o.*,c.name customer_name,s.name store_name
      FROM orders o
      LEFT JOIN users c ON c.id=o.customer_id
      LEFT JOIN users s ON s.id=o.store_id
      WHERE o.driver_id=$1
      ORDER BY o.created_at DESC
    `;
    values = [req.user.id];
  } else {
    query = "SELECT * FROM orders ORDER BY created_at DESC";
    values = [];
  }

  const result = await pool.query(query, values);
  res.json(result.rows);
});

// =========================
// السائق يؤكد الوصول
// =========================

app.post(
  "/api/driver/orders/:id/delivered",
  auth,
  allow("driver"),
  async (req, res) => {
    try {
      const order = await pool.query(
        `SELECT
           o.*,
           s.name store_name,
           c.name customer_name,
           d.name driver_name
         FROM orders o
         LEFT JOIN users s ON s.id=o.store_id
         LEFT JOIN users c ON c.id=o.customer_id
         LEFT JOIN users d ON d.id=o.driver_id
         WHERE o.id=$1 AND o.driver_id=$2`,
        [req.params.id, req.user.id]
      );

      if (!order.rows.length) {
        return res.status(404).json({ error: "الطلب غير موجود" });
      }

      const o = order.rows[0];

      await pool.query(
        `UPDATE orders
         SET status='delivered',delivered_at=NOW()
         WHERE id=$1`,
        [o.id]
      );

      await pool.query(
        `INSERT INTO invoices
         (order_id,parcel_code,store_name,customer_name,driver_name)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          o.id,
          o.parcel_code,
          o.store_name,
          o.customer_name,
          o.driver_name
        ]
      );

      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "حدث خطأ" });
    }
  }
);

// =========================
// الأرشيف / الفواتير
// =========================

app.get("/api/invoices", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM invoices ORDER BY delivered_at DESC"
  );

  res.json(result.rows);
});

// =========================
// المدير
// =========================

app.get(
  "/api/manager/users",
  auth,
  allow("manager"),
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        id,role,name,phone,customer_code,
        username,status,active,created_at
      FROM users
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  }
);

// المدير فقط يستطيع إلغاء الحساب
app.post(
  "/api/manager/users/:id/disable",
  auth,
  allow("manager"),
  async (req, res) => {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({
        error: "لا يمكنك إلغاء حساب المدير الحالي"
      });
    }

    await pool.query(
      "UPDATE users SET active=FALSE WHERE id=$1",
      [req.params.id]
    );

    res.json({ success: true });
  }
);

// =========================

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

setupDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log("BARQ running on port", PORT);
    });
  })
  .catch(err => {
    console.error("Database setup failed:", err);
    process.exit(1);
  });
