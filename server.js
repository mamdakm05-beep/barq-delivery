require("dotenv").config();
const express=require("express"),path=require("path"),crypto=require("crypto");
const Database=require("better-sqlite3"),helmet=require("helmet"),rateLimit=require("express-rate-limit"),cookieParser=require("cookie-parser");
const app=express(),PORT=process.env.PORT||3000,db=new Database(process.env.DB_PATH||path.join(__dirname,"barq.db"));
app.set('trust proxy', 1);
db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,code TEXT UNIQUE NOT NULL,address TEXT,lat REAL,lng REAL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json());app.use(cookieParser());app.use(rateLimit({windowMs:15*60*1000,max:300}));app.use(express.static("public"));
const sessions=new Map(),norm=p=>String(p||"").replace(/[^\d+]/g,"").replace(/^00/,"+");
function auth(req,res,next){let x=sessions.get(req.cookies.barq_admin);if(!x||x<Date.now())return res.status(401).json({error:"غير مصرح"});next()}
function makeCode(){let c;do{c="BRQ-"+crypto.randomInt(100000,1000000)}while(db.prepare("SELECT 1 FROM customers WHERE code=?").get(c));return c}
app.get("/api/config",(q,s)=>s.json({googleMapsApiKey:process.env.GOOGLE_MAPS_API_KEY||""}));
app.post("/api/customers",(q,s)=>{let{name,phone,address,lat,lng}=q.body;name=String(name||"").trim();phone=norm(phone);lat=Number(lat);lng=Number(lng);if(name.length<2||phone.length<7||!Number.isFinite(lat)||!Number.isFinite(lng))return s.status(400).json({error:"تأكد من الاسم ورقم الهاتف والموقع"});let id=crypto.randomUUID(),code=makeCode(),now=new Date().toISOString();db.prepare("INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?)").run(id,name,phone,code,String(address||""),lat,lng,now,now);s.json({id,name,phone,code,address,lat,lng})});
app.post("/api/admin/login",(q,s)=>{if(norm(q.body.phone)!==norm(process.env.ADMIN_PHONE)||String(q.body.password||"")!==String(process.env.ADMIN_PASSWORD||""))return s.status(401).json({error:"بيانات الدخول غير صحيحة"});let t=crypto.randomBytes(32).toString("hex");sessions.set(t,Date.now()+28800000);s.cookie("barq_admin",t,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:28800000});s.json({ok:true})});
app.get("/api/admin/customers",auth,(q,s)=>{let z="%"+String(q.query.q||"")+"%";s.json(db.prepare("SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR code LIKE ? OR address LIKE ? ORDER BY created_at DESC").all(z,z,z,z))});
app.put("/api/admin/customers/:id",auth,(q,s)=>{let o=db.prepare("SELECT * FROM customers WHERE id=?").get(q.params.id);if(!o)return s.sendStatus(404);db.prepare("UPDATE customers SET name=?,phone=?,address=?,lat=?,lng=?,updated_at=? WHERE id=?").run(q.body.name??o.name,norm(q.body.phone??o.phone),q.body.address??o.address,Number(q.body.lat??o.lat),Number(q.body.lng??o.lng),new Date().toISOString(),q.params.id);s.json({ok:true})});
app.delete("/api/admin/customers/:id",auth,(q,s)=>{db.prepare("DELETE FROM customers WHERE id=?").run(q.params.id);s.json({ok:true})});
app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public","index.html")));app.listen(PORT,()=>console.log("Barq on "+PORT));
