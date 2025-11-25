const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SHIFTS_FILE = path.join(DATA_DIR, 'shifts.json');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const JWT_SECRET = process.env.SCHEDULE_JWT_SECRET || 'change_this_secret';

const app = express();
app.use(cors());
app.use(express.json());

// Serve a public home page at root, and the SPA at /app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html'));
});
// Serve the main single-page app under /app
app.get(/^\/app(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static front-end files from project root (so app and API share origin)
// This MUST come after explicit routes so /app and /api are not intercepted
app.use(express.static(path.join(__dirname)));

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function ensureDefaultAdmin() {
  const users = await readJson(USERS_FILE, []);
  if (!users.find(u => u.role === 'manager' || u.role === 'owner')) {
    const hash = bcrypt.hashSync('admin', 10);
    users.push({ username: 'admin', password: hash, role: 'manager', email: '' });
    await writeJson(USERS_FILE, users);
    console.log('TeamShifter: created default admin user: admin / admin');
  }
  // ensure companies file exists
  const comps = await readJson(COMPANIES_FILE, []);
  if (!Array.isArray(comps)) await writeJson(COMPANIES_FILE, []);
}

// Input validation helpers
function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < 2 || username.length > 50) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return false;
  return true;
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 4) return false; // min 4 chars
  return true;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return true; // optional
  if (email.length > 100) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  return true;
}

function validateCompanyName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 2 || name.length > 100) return false;
  return true;
}

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
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  const users = await readJson(USERS_FILE, []);
  const u = users.find(x => x.username === username);
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, u.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: u.username, role: u.role, company: u.company || null }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: u.username, role: u.role, company: u.company || null });
});

// Users (manager only except registration if no users exist)
app.get('/api/users', authMiddleware, managerOnly, async (req, res) => {
  const users = await readJson(USERS_FILE, []);
  // if requester has a company, only return users for that company
  if (req.user && req.user.company) {
    const filtered = users.filter(u => u.company === req.user.company);
    return res.json(filtered.map(u => ({ username: u.username, role: u.role, email: u.email, company: u.company })));
  }
  res.json(users.map(u => ({ username: u.username, role: u.role, email: u.email, company: u.company })));
});

app.post('/api/users', authMiddleware, managerOnly, async (req, res) => {
  const { username, password, role = 'employee', email = '' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!validateUsername(username)) return res.status(400).json({ error: 'Username must be 2-50 alphanumeric characters (letters, numbers, -, _)' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
  if (!['employee', 'manager'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  
  const users = await readJson(USERS_FILE, []);
  const company = req.user && req.user.company ? req.user.company : null;
  
  // Check if username already exists (case-insensitive)
  const existing = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existing && !company) return res.status(400).json({ error: 'Username already exists' });
  if (existing && existing.company !== company) return res.status(400).json({ error: 'Username already exists in another company' });
  
  const hash = bcrypt.hashSync(password, 10);
  if (existing) {
    existing.password = hash;
    existing.role = role;
    existing.email = email;
    existing.company = company;
  } else {
    users.push({ username, password: hash, role, email, company });
  }
  await writeJson(USERS_FILE, users);
  res.json({ ok: true });
});

app.delete('/api/users/:username', authMiddleware, managerOnly, async (req, res) => {
  const username = req.params.username;
  if (username === 'admin') return res.status(400).json({ error: 'Cannot delete default admin' });
  let users = await readJson(USERS_FILE, []);
  users = users.filter(u => u.username !== username);
  await writeJson(USERS_FILE, users);
  res.json({ ok: true });
});


// Shifts
app.get('/api/shifts', async (req, res) => {
  const shifts = await readJson(SHIFTS_FILE, []);
  const qCompany = req.query.company;
  if (qCompany) return res.json(shifts.filter(s => s.company === qCompany));
  // if authenticated and has company, return only that company's shifts
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const token = auth.slice(7);
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload && payload.company) return res.json(shifts.filter(s => s.company === payload.company));
    } catch (e) {}
  }
  // otherwise return all (fallback)
  res.json(shifts);
});

app.post('/api/shifts', authMiddleware, managerOnly, async (req, res) => {
  const shift = req.body || {};
  if (!shift || !shift.date || !shift.employee) return res.status(400).json({ error: 'Missing shift fields' });
  let shifts = await readJson(SHIFTS_FILE, []);
  // ensure shift is scoped to user's company
  const company = req.user && req.user.company ? req.user.company : null;
  shift.company = company;
  if (!shift.id) shift.id = 's_' + Date.now().toString(36);
  const existing = shifts.find(s => s.id === shift.id);
  if (existing) {
    Object.assign(existing, shift);
  } else {
    shifts.push(shift);
  }
  await writeJson(SHIFTS_FILE, shifts);
  res.json({ ok: true });
});

app.delete('/api/shifts/:id', authMiddleware, managerOnly, async (req, res) => {
  const id = req.params.id;
  let shifts = await readJson(SHIFTS_FILE, []);
  shifts = shifts.filter(s => s.id !== id);
  await writeJson(SHIFTS_FILE, shifts);
  res.json({ ok: true });
});

// Register a new company + owner in one step
app.post('/api/companies/register', async (req, res) => {
  try {
    const { companyName, ownerUsername, ownerPassword, ownerEmail } = req.body || {};
    if (!companyName || !ownerUsername || !ownerPassword) return res.status(400).json({ error: 'Missing fields' });
    
    // Validate inputs
    if (!validateCompanyName(companyName)) return res.status(400).json({ error: 'Company name must be 2-100 characters' });
    if (!validateUsername(ownerUsername)) return res.status(400).json({ error: 'Username must be 2-50 alphanumeric characters (letters, numbers, -, _)' });
    if (!validatePassword(ownerPassword)) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    if (!validateEmail(ownerEmail)) return res.status(400).json({ error: 'Invalid email format' });
    
    const companies = await readJson(COMPANIES_FILE, []);
    const users = await readJson(USERS_FILE, []);
    
    if (companies.find(c => c.name.toLowerCase() === companyName.toLowerCase())) return res.status(400).json({ error: 'Company already exists' });
    if (users.find(u => u.username.toLowerCase() === ownerUsername.toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
    
    const companyId = 'c_' + Date.now().toString(36);
    companies.push({ id: companyId, name: companyName, created: new Date().toISOString() });
    const hash = bcrypt.hashSync(ownerPassword, 10);
    users.push({ username: ownerUsername, password: hash, role: 'owner', email: ownerEmail || '', company: companyId });
    
    await writeJson(COMPANIES_FILE, companies);
    await writeJson(USERS_FILE, users);
    const token = jwt.sign({ username: ownerUsername, role: 'owner', company: companyId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: ownerUsername, role: 'owner', company: companyId });
  } catch (err) {
    console.error('Error in company registration:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Start server
async function start() {
  await ensureDefaultAdmin();
  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => console.log('TeamShifter server listening on http://0.0.0.0:' + port + ' (accessible on your LAN/public IP)'));
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

