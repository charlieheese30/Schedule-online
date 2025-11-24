const express = require('express');
const fs = require('fs').promises;
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
// Serve static front-end files from project root (so app and API share origin)
app.use(express.static(path.join(__dirname)));

// For any other path not starting with /api, serve index.html (SPA fallback)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
    const hash = await bcrypt.hash('admin', 10);
    users.push({ username: 'admin', password: hash, role: 'manager', email: '' });
    await writeJson(USERS_FILE, users);
    console.log('TeamShifter: created default admin user: admin / admin');
  }
  // ensure companies file exists
  const comps = await readJson(COMPANIES_FILE, []);
  if (!Array.isArray(comps)) await writeJson(COMPANIES_FILE, []);
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
  const ok = await bcrypt.compare(password, u.password);
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
  const users = await readJson(USERS_FILE, []);
  const existing = users.find(u => u.username === username);
  const hash = await bcrypt.hash(password, 10);
  const company = req.user && req.user.company ? req.user.company : null;
  if (existing) {
    existing.password = hash; existing.role = role; existing.email = email; existing.company = company;
  } else {
    users.push({ username, password: hash, role, email, company });
  }
  await writeJson(USERS_FILE, users);
  res.json({ ok: true });
});

app.delete('/api/users/:username', authMiddleware, managerOnly, async (req, res) => {
  const username = req.params.username;
  let users = await readJson(USERS_FILE, []);
  if (username === 'admin') return res.status(400).json({ error: 'Cannot delete default admin' });
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
    try{
      const token = auth.slice(7);
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload && payload.company) return res.json(shifts.filter(s => s.company === payload.company));
    }catch(e){}
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
  const existing = shifts.find(s => s.id === shift.id);
  if (existing) {
    Object.assign(existing, shift);
  } else {
    shifts.push(shift);
  }
  await writeJson(SHIFTS_FILE, shifts);
  res.json({ ok: true });
});

// Register a new company + owner in one step
app.post('/api/companies/register', async (req, res) => {
  try{
    const { companyName, ownerUsername, ownerPassword, ownerEmail } = req.body || {};
    if (!companyName || !ownerUsername || !ownerPassword) return res.status(400).json({ error: 'Missing fields' });
    const companies = await readJson(COMPANIES_FILE, []);
    const users = await readJson(USERS_FILE, []);
    if (companies.find(c => c.name.toLowerCase() === companyName.toLowerCase())) return res.status(400).json({ error: 'Company already exists' });
    if (users.find(u => u.username.toLowerCase() === ownerUsername.toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
    const companyId = 'c_' + Date.now().toString(36);
    companies.push({ id: companyId, name: companyName, created: new Date().toISOString() });
    const hash = await bcrypt.hash(ownerPassword, 10);
    users.push({ username: ownerUsername, password: hash, role: 'owner', email: ownerEmail||'', company: companyId });
    await writeJson(COMPANIES_FILE, companies);
    await writeJson(USERS_FILE, users);
    const token = jwt.sign({ username: ownerUsername, role: 'owner', company: companyId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: ownerUsername, role: 'owner', company: companyId });
  }catch(err){
    console.error('Error in company registration:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.delete('/api/shifts/:id', authMiddleware, managerOnly, async (req, res) => {
  const id = req.params.id;
  let shifts = await readJson(SHIFTS_FILE, []);
  shifts = shifts.filter(s => s.id !== id);
  await writeJson(SHIFTS_FILE, shifts);
  res.json({ ok: true });
});

(async function start(){
  await ensureDefaultAdmin();
  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => console.log('TeamShifter server listening on http://0.0.0.0:' + port + ' (accessible on your LAN/public IP)'));
})();
