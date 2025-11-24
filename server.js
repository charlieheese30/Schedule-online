const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'teamshifter.db');
const JWT_SECRET = process.env.SCHEDULE_JWT_SECRET || 'change_this_secret';

const app = express();
app.use(cors());
app.use(express.json());
// Serve static front-end files from project root (so app and API share origin)
app.use(express.static(path.join(__dirname)));

// For any other path not starting with /api, serve index.html (SPA fallback)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Ensure data directory and initialize SQLite DB
function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_FILE);
  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      email TEXT,
      company TEXT,
      FOREIGN KEY(company) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      employee TEXT NOT NULL,
      role TEXT,
      start TEXT,
      end TEXT,
      color TEXT,
      company TEXT,
      FOREIGN KEY(company) REFERENCES companies(id)
    );
  `);

  // Ensure default admin
  const row = db.prepare('SELECT username FROM users WHERE username = ?').get('admin');
  if (!row) {
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT INTO users (username, password, role, email, company) VALUES (?, ?, ?, ?, ?)')
      .run('admin', hash, 'manager', '', null);
    console.log('TeamShifter: created default admin user: admin / admin');
  }

  // If legacy JSON files exist and DB tables are empty, import them to SQLite
  try {
    const compCount = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
    if (compCount === 0) {
      const compsFile = path.join(DATA_DIR, 'companies.json');
      if (fs.existsSync(compsFile)) {
        const raw = fs.readFileSync(compsFile, 'utf8');
        const comps = JSON.parse(raw || '[]');
        const insertC = db.prepare('INSERT OR IGNORE INTO companies (id, name, created) VALUES (?, ?, ?)');
        for (const c of comps) insertC.run(c.id, c.name, c.created || new Date().toISOString());
        console.log('Imported companies.json into SQLite');
      }
    }

    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    if (userCount <= 1) { // only default admin maybe
      const usersFile = path.join(DATA_DIR, 'users.json');
      if (fs.existsSync(usersFile)) {
        const raw = fs.readFileSync(usersFile, 'utf8');
        const users = JSON.parse(raw || '[]');
        const insertU = db.prepare('INSERT OR IGNORE INTO users (username, password, role, email, company) VALUES (?, ?, ?, ?, ?)');
        for (const u of users) insertU.run(u.username, u.password, u.role || 'employee', u.email || '', u.company || null);
        console.log('Imported users.json into SQLite');
      }
    }

    const shiftCount = db.prepare('SELECT COUNT(*) as c FROM shifts').get().c;
    if (shiftCount === 0) {
      const shiftsFile = path.join(DATA_DIR, 'shifts.json');
      if (fs.existsSync(shiftsFile)) {
        const raw = fs.readFileSync(shiftsFile, 'utf8');
        const shifts = JSON.parse(raw || '[]');
        const insertS = db.prepare('INSERT OR IGNORE INTO shifts (id, date, employee, role, start, end, color, company) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const s of shifts) insertS.run(s.id, s.date, s.employee, s.role || '', s.start || '', s.end || '', s.color || '', s.company || null);
        console.log('Imported shifts.json into SQLite');
      }
    }
  } catch (e) {
    console.warn('Error importing legacy JSON data:', e && e.message);
  }

  return db;
}

const db = initDb();

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const token = auth.slice(7);
  try {
    const data = jwt.verify(token, JWT_SECRET);
    // expected payload: { username, role, company }
    req.user = data; next();
  } catch (err) { return res.status(401).json({ error: 'Invalid token' }); }
}

function managerOnly(req, res, next) {
  if (!req.user || req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  next();
}

// Basic health
app.get('/api/ping', (req, res) => res.json({ ok: true }));

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  const u = db.prepare('SELECT username, password, role, company FROM users WHERE username = ?').get(username);
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, u.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: u.username, role: u.role, company: u.company || null }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: u.username, role: u.role, company: u.company || null });
});

// Users (manager only except registration if no users exist)
app.get('/api/users', authMiddleware, managerOnly, (req, res) => {
  if (req.user && req.user.company) {
    const rows = db.prepare('SELECT username, role, email, company FROM users WHERE company = ?').all(req.user.company);
    return res.json(rows);
  }
  const rows = db.prepare('SELECT username, role, email, company FROM users').all();
  res.json(rows);
});

app.post('/api/users', authMiddleware, managerOnly, (req, res) => {
  const { username, password, role = 'employee', email = '' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const company = req.user && req.user.company ? req.user.company : null;
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT OR REPLACE INTO users (username, password, role, email, company) VALUES (?, ?, ?, ?, ?)')
    .run(username, hash, role, email, company);
  res.json({ ok: true });
});

app.delete('/api/users/:username', authMiddleware, managerOnly, (req, res) => {
  const username = req.params.username;
  if (username === 'admin') return res.status(400).json({ error: 'Cannot delete default admin' });
  db.prepare('DELETE FROM users WHERE username = ?').run(username);
  res.json({ ok: true });
});

// Shifts
app.get('/api/shifts', (req, res) => {
  const qCompany = req.query.company;
  if (qCompany) {
    const rows = db.prepare('SELECT * FROM shifts WHERE company = ?').all(qCompany);
    return res.json(rows);
  }
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const token = auth.slice(7);
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload && payload.company) {
        const rows = db.prepare('SELECT * FROM shifts WHERE company = ?').all(payload.company);
        return res.json(rows);
      }
    } catch (e) {}
  }
  const rows = db.prepare('SELECT * FROM shifts').all();
  res.json(rows);
});

app.post('/api/shifts', authMiddleware, managerOnly, (req, res) => {
  const shift = req.body || {};
  if (!shift || !shift.date || !shift.employee) return res.status(400).json({ error: 'Missing shift fields' });
  const company = req.user && req.user.company ? req.user.company : null;
  shift.company = company;
  if (!shift.id) shift.id = 's_' + Date.now().toString(36);
  db.prepare(`INSERT OR REPLACE INTO shifts (id, date, employee, role, start, end, color, company) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(shift.id, shift.date, shift.employee, shift.role || '', shift.start || '', shift.end || '', shift.color || '', shift.company);
  res.json({ ok: true });
});

// Register a new company + owner in one step
app.post('/api/companies/register', (req, res) => {
  try{
    const { companyName, ownerUsername, ownerPassword, ownerEmail } = req.body || {};
    if (!companyName || !ownerUsername || !ownerPassword) return res.status(400).json({ error: 'Missing fields' });
    // Check company name uniqueness (case-insensitive)
    const existingCompany = db.prepare('SELECT id FROM companies WHERE LOWER(name) = LOWER(?)').get(companyName);
    if (existingCompany) return res.status(400).json({ error: 'Company already exists' });
    // Check username uniqueness
    const existingUser = db.prepare('SELECT username FROM users WHERE LOWER(username) = LOWER(?)').get(ownerUsername);
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });
    const companyId = 'c_' + Date.now().toString(36);
    db.prepare('INSERT INTO companies (id, name, created) VALUES (?, ?, ?)').run(companyId, companyName, new Date().toISOString());
    const hash = bcrypt.hashSync(ownerPassword, 10);
    db.prepare('INSERT INTO users (username, password, role, email, company) VALUES (?, ?, ?, ?, ?)')
      .run(ownerUsername, hash, 'owner', ownerEmail||'', companyId);
    const token = jwt.sign({ username: ownerUsername, role: 'owner', company: companyId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: ownerUsername, role: 'owner', company: companyId });
  }catch(err){
    console.error('Error in company registration:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.delete('/api/shifts/:id', authMiddleware, managerOnly, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log('TeamShifter server listening on http://0.0.0.0:' + port + ' (accessible on your LAN/public IP)'));
