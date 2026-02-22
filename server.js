import express from "express";
import cors from "cors";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true }));
app.use(express.json({ limit: "200kb" }));

const PORT = process.env.PORT || 8080;

// ---- Config (Railway MySQL) ----
const DB_HOST = process.env.DB_HOST;
const DB_PORT = Number(process.env.DB_PORT || "3306");
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;

// ---- Admin credentials (set these in Railway env) ----
const ADMIN_USER = process.env.ADMIN_USER || "itnisz363699";
const ADMIN_PASS = process.env.ADMIN_PASS || "Pacoluis23";
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SUPER_SECRET";

// LiteBans tables (customizable)
const T_BANS = process.env.T_BANS || "litebans_bans";
const T_MUTES = process.env.T_MUTES || "litebans_mutes";
const T_KICKS = process.env.T_KICKS || "litebans_kicks";

// Column lists (LiteBans can vary; adjust if needed)
const COL_BANS = process.env.COL_BANS || "id,name,reason,banned_by_name,time,until,active";
const COL_MUTES = process.env.COL_MUTES || "id,name,reason,muted_by_name,time,until,active";
const COL_KICKS = process.env.COL_KICKS || "id,name,reason,kicked_by_name,time";

let pool;

function assertDbEnv() {
  const missing = ["DB_HOST","DB_NAME","DB_USER","DB_PASS"].filter(k => !process.env[k]);
  if (missing.length) console.warn("[WARN] Missing DB env vars:", missing.join(", "));
}
assertDbEnv();

async function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASS,
    waitForConnections: true,
    connectionLimit: 8,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
  return pool;
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).send("Missing token");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).send("Invalid token");
  }
}
function limitOffset(req) {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
  const q = (req.query.q || "").toString().trim();
  return { limit, offset, q };
}
function toCols(s){
  return s.split(",").map(x => x.trim()).filter(Boolean).join(",");
}

app.get("/health", async (_req, res) => {
  try {
    const p = await getPool();
    await p.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "db" });
  }
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).send("Bad credentials");
  }
  const token = signToken({ role: "staff", username });
  res.json({ token });
});

app.get("/auth/me", auth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.get("/stats", auth, async (_req, res) => {
  try{
    const p = await getPool();
    const [[b]] = await p.query(`SELECT COUNT(*) AS c FROM \`${T_BANS}\``);
    const [[m]] = await p.query(`SELECT COUNT(*) AS c FROM \`${T_MUTES}\``);
    const [[k]] = await p.query(`SELECT COUNT(*) AS c FROM \`${T_KICKS}\``);
    res.json({ bans: b?.c ?? 0, mutes: m?.c ?? 0, kicks: k?.c ?? 0 });
  }catch{
    res.status(500).send("Failed to query stats. Check table names in env.");
  }
});

async function listRows(table, cols, byCol) {
  const p = await getPool();
  return async (req, res) => {
    const { limit, offset, q } = limitOffset(req);
    const columns = toCols(cols);
    const where = q ? `WHERE \`${byCol}\` LIKE ?` : "";
    const params = q ? [`%${q}%`, limit, offset] : [limit, offset];
    try {
      const [rows] = await p.query(
        `SELECT ${columns} FROM \`${table}\` ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        params
      );
      res.json({ rows });
    } catch {
      res.status(500).send("Query failed. Adjust COL_* env to match your LiteBans schema.");
    }
  };
}

app.get("/bans", auth, await listRows(T_BANS, COL_BANS, "name"));
app.get("/mutes", auth, await listRows(T_MUTES, COL_MUTES, "name"));
app.get("/kicks", auth, await listRows(T_KICKS, COL_KICKS, "name"));

app.listen(PORT, () => console.log(`[hyrise-api] listening on :${PORT}`));
