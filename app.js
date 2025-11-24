(function(){
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const LS_KEY = 'schedule_shifts_v1';
  const USERS_KEY = 'schedule_users_v1';
  const SESSION_KEY = 'schedule_session_v1';
  const API_TOKEN_KEY = 'schedule_api_token';
  // Use localhost:3000 as the API base by default to avoid mixed-origin issues
  // when opening the HTML file directly. If you serve the app from another origin,
  // set API_BASE accordingly.
  const API_BASE = 'http://localhost:3000';
  const COMPANIES_KEY = 'schedule_companies_v1';

  // Elements
  const scheduleEl = document.getElementById('schedule');
  const weekLabel = document.getElementById('weekLabel');
  const prevWeekBtn = document.getElementById('prevWeek');
  const nextWeekBtn = document.getElementById('nextWeek');
  const addShiftBtn = document.getElementById('addShiftBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  const modal = document.getElementById('shiftModal');
  const shiftForm = document.getElementById('shiftForm');
  const modalTitle = document.getElementById('modalTitle');
  const deleteBtn = document.getElementById('deleteBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const loginCancel = document.getElementById('loginCancel');
  const currentUserSpan = document.getElementById('currentUser');
  const rosterModal = document.getElementById('rosterModal');
  const rosterList = document.getElementById('rosterList');
  const rosterForm = document.getElementById('rosterForm');
  const rosterClose = document.getElementById('rosterClose');
  const createCompanyBtn = document.getElementById('createCompanyBtn');
  const companyModal = document.getElementById('companyModal');
  const companyForm = document.getElementById('companyForm');
  const companyCancel = document.getElementById('companyCancel');

  const inputId = document.getElementById('shiftId');
  const inputEmployee = document.getElementById('employee');
  const inputEmployeeSelect = document.getElementById('employeeSelect');
  const inputRole = document.getElementById('role');
  const inputDay = document.getElementById('day');
  const inputStart = document.getElementById('start');
  const inputEnd = document.getElementById('end');
  const inputColor = document.getElementById('color');

  let shifts = [];
  let users = [];
  let companies = [];
  let session = null; // {username,role}
  let currentWeekStart = startOfWeek(new Date());

  // init
  populateDaySelect();
  loadShifts();
  loadUsers();
  loadCompanies();
  loadSession();
  render();
  attach();

  function attach(){
    prevWeekBtn.addEventListener('click', ()=>{ currentWeekStart = addDays(currentWeekStart,-7); render(); });
    nextWeekBtn.addEventListener('click', ()=>{ currentWeekStart = addDays(currentWeekStart,7); render(); });
    addShiftBtn.addEventListener('click', ()=>{ if(isManager()) openModal(); else alert('Only managers can add shifts'); });
    exportBtn.addEventListener('click', exportCSV);
    importBtn.addEventListener('click', ()=>importFile.click());
    importFile.addEventListener('change', handleImportFile);
    loginBtn.addEventListener('click', ()=>openLogin());
    loginForm.addEventListener('submit', onLogin);
    loginCancel.addEventListener('click', ()=>closeLogin());
    logoutBtn.addEventListener('click', onLogout);
    createCompanyBtn && createCompanyBtn.addEventListener('click', ()=>openCompanyModal());
    companyForm && companyForm.addEventListener('submit', onCreateCompany);
    companyCancel && companyCancel.addEventListener('click', ()=>closeCompanyModal());
    // roster
    rosterClose.addEventListener('click', ()=>closeRoster());
    rosterForm.addEventListener('submit', onRosterSubmit);

    shiftForm.addEventListener('submit', onSave);
    cancelBtn.addEventListener('click', closeModal);
    deleteBtn.addEventListener('click', onDelete);
    modal.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });
  }

  function populateDaySelect(){
    inputDay.innerHTML = '';
    for(let i=0;i<7;i++){
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = DAYS[i];
      inputDay.appendChild(opt);
    }
    populateEmployeeSelect();
  }

  function populateEmployeeSelect(){
    if(!inputEmployeeSelect) return;
    inputEmployeeSelect.innerHTML='';
    const empt = document.createElement('option'); empt.value=''; empt.textContent='(select employee)'; inputEmployeeSelect.appendChild(empt);
    users.filter(u=>u.role==='employee').forEach(u=>{
      const opt = document.createElement('option'); opt.value = u.username; opt.textContent = u.username; inputEmployeeSelect.appendChild(opt);
    });
  }

  function render(){
    updateAuthUI();
    const week = getWeekDates(currentWeekStart);
    weekLabel.textContent = `${formatDateShort(week[0])} — ${formatDateShort(week[6])}`;
    scheduleEl.innerHTML = '';
    for(let i=0;i<7;i++){
      const d = week[i];
      const col = document.createElement('div'); col.className = 'day-column';
      const header = document.createElement('div'); header.className='day-header';
      const title = document.createElement('div'); title.textContent = DAYS[i];
      const date = document.createElement('div'); date.className='day-date'; date.textContent = formatDatePretty(d);
      header.appendChild(title); header.appendChild(date);
      const list = document.createElement('div'); list.className='shift-list';

      const dayISO = toISODate(d);
      const todays = shifts.filter(s=>s.date===dayISO).sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));
      if(todays.length===0){
        const empty = document.createElement('div'); empty.style.opacity='.6'; empty.style.fontSize='.9rem'; empty.textContent='No shifts'; list.appendChild(empty);
      } else {
        todays.forEach(s=>{
          const card = document.createElement('div'); card.className='shift-card';
          card.style.background = s.color || '#2f8bf7';
          card.dataset.id = s.id;
          card.innerHTML = `<div class="shift-time">${s.start} — ${s.end}</div><div class="shift-employee">${escapeHtml(s.employee)}</div><div class="shift-role">${escapeHtml(s.role||'')}</div>`;
          card.addEventListener('click', ()=>{
            if(isManager()) openModal(s.id); else viewShiftReadOnly(s.id);
          });
          list.appendChild(card);
        });
      }

      col.appendChild(header);
      col.appendChild(list);
      scheduleEl.appendChild(col);
    }
  }

  function openModal(shiftId){
    // manager-only
    if(!isManager()) return;
    if(shiftId){
      const s = shifts.find(x=>x.id===shiftId);
      if(!s) return;
      modalTitle.textContent = 'Edit Shift'; deleteBtn.classList.remove('hidden');
      inputId.value = s.id; inputEmployee.value = s.employee; inputEmployeeSelect.value = s.employee || '';
      inputRole.value = s.role||''; inputStart.value = s.start; inputEnd.value = s.end; inputColor.value = s.color||'#2f8bf7';
      // set day select relative to current week
      const week = getWeekDates(currentWeekStart);
      const idx = week.findIndex(d=>toISODate(d)===s.date);
      inputDay.value = idx>=0?idx:0;
    } else {
      modalTitle.textContent = 'Add Shift'; deleteBtn.classList.add('hidden'); inputId.value=''; inputEmployee.value=''; inputRole.value=''; inputStart.value='09:00'; inputEnd.value='17:00'; inputColor.value='#2f8bf7';
      // default day = today if in this week else Monday
      const todayISO = toISODate(new Date());
      const week = getWeekDates(currentWeekStart);
      const idx = week.findIndex(d=>toISODate(d)===todayISO);
      inputDay.value = idx>=0?idx:0;
    }
    // show employee select for managers
    toggleEmployeeInputs(true);
    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
  }

  function viewShiftReadOnly(shiftId){
    const s = shifts.find(x=>x.id===shiftId); if(!s) return;
    modalTitle.textContent = 'View Shift'; deleteBtn.classList.add('hidden');
    inputId.value = s.id; inputEmployee.value = s.employee; inputEmployeeSelect.value = s.employee||'';
    inputRole.value = s.role||''; inputStart.value = s.start; inputEnd.value = s.end; inputColor.value = s.color||'#2f8bf7';
    toggleEmployeeInputs(false);
    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
  }

  function toggleEmployeeInputs(editable){
    const textLabel = document.getElementById('employeeTextLabel');
    const selectLabel = document.getElementById('employeeSelectLabel');
    if(editable){ textLabel.classList.add('hidden'); selectLabel.classList.remove('hidden'); }
    else { textLabel.classList.remove('hidden'); selectLabel.classList.add('hidden'); }
  }

  function closeModal(){ modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }

  function onSave(e){
    e.preventDefault();
    const id = inputId.value || idGen();
    // prefer select when manager
    const employee = (isManager() && inputEmployeeSelect && inputEmployeeSelect.value) ? inputEmployeeSelect.value : inputEmployee.value.trim();
    const role = inputRole.value.trim();
    const start = inputStart.value;
    const end = inputEnd.value;
    const color = inputColor.value;
    const dayIndex = Number(inputDay.value);
    const week = getWeekDates(currentWeekStart);
    const date = toISODate(week[dayIndex]);
    if(!employee || !start || !end) return alert('Please fill required fields');
    const shift = {id, employee, role, start, end, color, date};
    if (session && session.role==='manager') {
      // persist via API
      const token = localStorage.getItem(API_TOKEN_KEY);
      fetch(API_BASE + '/api/shifts', {
        method: 'POST', headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(shift)
      }).then(r=>{
        if(!r.ok) return r.json().then(x=>{ throw new Error(x.error||'Save failed'); });
        return r.json();
      }).then(()=>{ loadShifts().then(()=>{ render(); closeModal(); }); }).catch(err=>alert('Save failed: '+err.message));
    } else {
      const exists = shifts.find(s=>s.id===id);
      if(exists) Object.assign(exists, shift); else shifts.push(shift);
      saveShifts(); render(); closeModal();
    }
  }

  function onDelete(){
    const id = inputId.value; if(!id) return; if(!confirm('Delete this shift?')) return;
    if (session && session.role==='manager'){
      const token = localStorage.getItem(API_TOKEN_KEY);
      fetch(API_BASE + '/api/shifts/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } })
        .then(r=>{ if(!r.ok) return r.json().then(x=>{ throw new Error(x.error||'Delete failed'); }); return r.json(); })
        .then(()=>{ return loadShifts(); })
        .then(()=>{ render(); closeModal(); })
        .catch(err=>alert('Delete failed: '+err.message));
    } else {
      shifts = shifts.filter(s=>s.id!==id); saveShifts(); render(); closeModal();
    }
  }

  function idGen(){ return 's_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8); }

  function saveShifts(){ localStorage.setItem(LS_KEY, JSON.stringify(shifts)); }
  function loadShifts(){ try{ const raw = localStorage.getItem(LS_KEY); shifts = raw?JSON.parse(raw):[]; }catch(e){shifts=[];} }

  function exportCSV(){
    if(!isManager()) return alert('Only managers can export shifts');
    if(shifts.length===0) return alert('No shifts to export');
    const rows = [['id','employee','role','date','start','end','color']];
    shifts.forEach(s=>rows.push([s.id, escapeCsv(s.employee), escapeCsv(s.role||''), s.date, s.start, s.end, s.color||'']));
    const csv = rows.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `schedule_${weekLabel.textContent.replace(/\s+/g,'_')}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function handleImportFile(e){
    if(!isManager()) return alert('Only managers can import shifts');
    const f = e.target.files && e.target.files[0]; if(!f) return; const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const text = reader.result; const parsed = parseCSV(text);
        const header = parsed[0]||[]; const lines = parsed.slice(1);
        const idx = {}; header.forEach((h,i)=> idx[h.trim().toLowerCase()] = i);
        // if server available, push to API one by one
        const token = localStorage.getItem(API_TOKEN_KEY);
        const useApi = !!token;
        const promises = lines.map(cols=>{
          const id = cols[idx['id']] || idGen();
          const employee = cols[idx['employee']] || '';
          const role = cols[idx['role']] || '';
          const date = cols[idx['date']] || cols[idx['day']] || '';
          const start = cols[idx['start']] || '';
          const end = cols[idx['end']] || '';
          const color = cols[idx['color']] || '#2f8bf7';
          if(!employee || !date) return Promise.resolve();
          const shift = { id, employee, role, date, start, end, color };
          if(useApi) return fetch(API_BASE + '/api/shifts', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token }, body:JSON.stringify(shift)});
          shifts.push(shift); return Promise.resolve();
        });
        Promise.all(promises).then(()=>{ return loadShifts(); }).then(()=>{ render(); alert('Import complete'); }).catch(()=>{ alert('Failed to import CSV'); });
      }catch(err){ alert('Failed to import CSV'); }
    };
    reader.readAsText(f);
    importFile.value='';
  }

  // load shifts from server if available, else localStorage
  async function loadShifts(){
    // try API
    try{
      const res = await fetch(API_BASE + '/api/shifts');
      if(res.ok){ const data = await res.json(); shifts = data||[]; return; }
    }catch(e){}
    // fallback
    try{ const raw = localStorage.getItem(LS_KEY); shifts = raw?JSON.parse(raw):[];}catch(e){ shifts=[]; }
  }

  // --- Users / auth ---
  function loadUsers(){ try{ const raw = localStorage.getItem(USERS_KEY); users = raw?JSON.parse(raw):[]; }catch(e){ users=[]; }
    ensureDefaultManager();
  }
  function saveUsers(){ localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
  function ensureDefaultManager(){ if(users.find(u=>u.role==='manager')) return; // ok
    users.push({username:'admin',password:'admin',role:'manager',email:''}); saveUsers(); }
  function loadSession(){ try{ session = JSON.parse(localStorage.getItem(SESSION_KEY)); }catch(e){ session=null; } }
  function saveSession(){ localStorage.setItem(SESSION_KEY, JSON.stringify(session||{})); }
  function clearSession(){ localStorage.removeItem(SESSION_KEY); session=null; }
  function isManager(){ return session && (session.role==='manager' || session.role==='owner'); }

  function openLogin(){ loginModal.classList.remove('hidden'); }
  function closeLogin(){ loginModal.classList.add('hidden'); }
  async function onLogin(e){ e.preventDefault(); const u = document.getElementById('loginUser').value.trim(); const p = document.getElementById('loginPass').value; // try API first
    try{
      const res = await fetch(API_BASE + '/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username: u, password: p }) });
      if(!res.ok){ const err = await res.json().catch(()=>({error:'Login failed'})); return alert(err.error||'Login failed'); }
      const data = await res.json(); localStorage.setItem(API_TOKEN_KEY, data.token); session = { username: data.username, role: data.role }; saveSession(); closeLogin(); await loadUsersFromApi(); await loadShifts(); render();
    }catch(err){
      // fallback to local users
      const found = users.find(x=>x.username===u && x.password===p);
      if(!found){ alert('Invalid credentials'); return; }
      session = {username:found.username, role:found.role}; saveSession(); closeLogin(); render();
    }
  }


  function openCompanyModal(){ companyModal && companyModal.classList.remove('hidden'); }
  function closeCompanyModal(){ companyModal && companyModal.classList.add('hidden'); }
  async function onCreateCompany(e){
    e.preventDefault();
    const companyName = document.getElementById('companyName').value.trim();
    const ownerUsername = document.getElementById('companyOwner').value.trim();
    const ownerPass = document.getElementById('companyOwnerPass').value;
    const ownerEmail = document.getElementById('companyOwnerEmail').value.trim();
    if(!companyName||!ownerUsername||!ownerPass) return alert('Missing fields');
    try{
      const res = await fetch(API_BASE + '/api/companies/register', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ companyName, ownerUsername, ownerPassword: ownerPass, ownerEmail }) });
      if(!res.ok){
        const err = await res.json().catch(()=>({error:'Failed'}));
        console.error('Company create failed', res.status, err);
        // Attempt local fallback when server returns an error
        console.warn('Falling back to local company creation');
        createLocalCompany(companyName, ownerUsername, ownerPass, ownerEmail);
        alert('Company created locally (server returned error). You are logged in as owner.');
        return;
      }
      const data = await res.json();
      localStorage.setItem(API_TOKEN_KEY, data.token);
      session = { username: data.username, role: data.role, company: data.company };
      saveSession();
      closeCompanyModal();
      await loadUsersFromApi();
      await loadShifts();
      render();
      alert('Company created and logged in');
    }catch(err){
      console.error('Create company exception', err);
      // network/server unreachable -> fallback to local company creation
      createLocalCompany(companyName, ownerUsername, ownerPass, ownerEmail);
      alert('Company created locally (server unreachable). You are logged in as owner.');
    }
  }

  function loadCompanies(){
    try{ const raw = localStorage.getItem(COMPANIES_KEY); companies = raw?JSON.parse(raw):[]; }catch(e){ companies = []; }
  }
  function saveCompanies(){ try{ localStorage.setItem(COMPANIES_KEY, JSON.stringify(companies||[])); }catch(e){}
  }
  // local fallback arrays
  function createLocalCompany(name, ownerUsername, ownerPass, ownerEmail){
    loadUsers(); loadCompanies();
    const companyId = 'c_' + Date.now().toString(36);
    companies.push({ id: companyId, name: name, created: new Date().toISOString() });
    saveCompanies();
    // create owner user locally
    const existing = users.find(u=>u.username===ownerUsername);
    if(existing){ existing.role='owner'; existing.company = companyId; existing.password = ownerPass; existing.email = ownerEmail||''; }
    else { users.push({ username: ownerUsername, password: ownerPass, role: 'owner', email: ownerEmail||'', company: companyId }); }
    saveUsers();
    // set session
    session = { username: ownerUsername, role: 'owner', company: companyId };
    saveSession();
    loadUsers(); loadShifts(); render();
  }

  async function loadUsersFromApi(){ try{ const token = localStorage.getItem(API_TOKEN_KEY); if(!token) return; const res = await fetch(API_BASE + '/api/users', { headers:{ 'Authorization':'Bearer '+token }}); if(!res.ok) return; const data = await res.json(); users = data.map(u=>({ username:u.username, role:u.role, email:u.email, password:'' })); }catch(e){} }
  function onLogout(){ if(confirm('Log out?')){ clearSession(); render(); } }

  function updateAuthUI(){ if(session){ currentUserSpan.textContent = session.username+' ('+session.role+')'; loginBtn.classList.add('hidden'); logoutBtn.classList.remove('hidden');
      // show roster button for managers
      if(isManager() && !document.getElementById('rosterBtn')){
        const b = document.createElement('button'); b.id='rosterBtn'; b.textContent='Roster'; b.addEventListener('click', ()=>openRoster()); document.querySelector('.controls').appendChild(b);
      }
    } else { currentUserSpan.textContent=''; loginBtn.classList.remove('hidden'); logoutBtn.classList.add('hidden'); const rb=document.getElementById('rosterBtn'); if(rb) rb.remove(); }
    // show/hide add/import/export
    addShiftBtn.style.display = isManager()? 'inline-block' : 'none';
    exportBtn.style.display = isManager()? 'inline-block' : 'none';
    importBtn.style.display = isManager()? 'inline-block' : 'none';
    populateEmployeeSelect();
  }

  function openRoster(){ if(!isManager()) return alert('Manager only'); populateRosterList(); rosterModal.classList.remove('hidden'); }
  function closeRoster(){ rosterModal.classList.add('hidden'); }
  function populateRosterList(){ rosterList.innerHTML = ''; users.forEach(u=>{
    const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.padding='6px 4px'; row.style.borderBottom='1px solid #eee'; row.innerHTML = `<div>${u.username} (${u.role})</div>`;
    const actions = document.createElement('div'); const del = document.createElement('button'); del.textContent='Delete'; del.addEventListener('click', ()=>{ if(u.username==='admin') return alert('Cannot delete default admin'); if(!confirm('Delete user '+u.username+'?'))return; users = users.filter(x=>x.username!==u.username); saveUsers(); populateRosterList(); });
    actions.appendChild(del); row.appendChild(actions); rosterList.appendChild(row);
  }); }
  function onRosterSubmit(e){ e.preventDefault(); const name=document.getElementById('rosterName').value.trim(); const email=document.getElementById('rosterEmail').value.trim(); const role=document.getElementById('rosterRole').value; const pass=document.getElementById('rosterPass').value; if(!name||!pass) return alert('Name and password required'); const existing = users.find(u=>u.username===name); if(existing){ existing.email=email; existing.role=role; existing.password=pass; } else { users.push({username:name,password:pass,role:role,email:email}); } saveUsers(); populateRosterList(); rosterForm.reset(); populateEmployeeSelect(); alert('Saved'); }
  async function onRosterSubmit(e){ e.preventDefault(); const name=document.getElementById('rosterName').value.trim(); const email=document.getElementById('rosterEmail').value.trim(); const role=document.getElementById('rosterRole').value; const pass=document.getElementById('rosterPass').value; if(!name||!pass) return alert('Name and password required'); // prefer API
    const token = localStorage.getItem(API_TOKEN_KEY);
    if(token){
      try{
        const res = await fetch(API_BASE + '/api/users', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token }, body:JSON.stringify({ username:name, password:pass, role, email }) });
        if(!res.ok) return res.json().then(x=>{ throw new Error(x.error||'Failed'); });
        await loadUsersFromApi(); populateRosterList(); rosterForm.reset(); populateEmployeeSelect(); alert('Saved'); return;
      }catch(err){ alert('Failed to save user: '+err.message); return; }
    }
    const existing = users.find(u=>u.username===name); if(existing){ existing.email=email; existing.role=role; existing.password=pass; } else { users.push({username:name,password:pass,role:role,email:email}); } saveUsers(); populateRosterList(); rosterForm.reset(); populateEmployeeSelect(); alert('Saved'); }

  // helpers
  function startOfWeek(d){ const copy = new Date(d); const day = copy.getDay(); const diff = (day===0? -6:1) - day; copy.setDate(copy.getDate()+diff); copy.setHours(0,0,0,0); return copy; }
  function addDays(d,n){ const c = new Date(d); c.setDate(c.getDate()+n); return c; }
  function getWeekDates(start){ const arr = []; for(let i=0;i<7;i++){ const dd = new Date(start); dd.setDate(start.getDate()+i); arr.push(dd); } return arr; }
  function formatDateShort(d){ return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }
  function formatDatePretty(d){ return `${d.getMonth()+1}/${d.getDate()}`; }
  function toISODate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function timeToMinutes(t){ const [hh,mm]=t.split(':').map(Number); return hh*60+(mm||0); }

  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escapeCsv(s){ if(s==null) return ''; const str = String(s); if(/[",\r\n,]/.test(str)) return '"'+str.replace(/"/g,'""')+'"'; return str; }

  function parseCSV(text){ const lines = text.split(/\r?\n/).filter(Boolean); return lines.map(line=>{
      const row=[]; let cur=''; let inQuotes=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(inQuotes){ if(ch==='"' && line[i+1]==='"'){ cur+='"'; i++; } else if(ch==='"'){ inQuotes=false; } else cur+=ch; } else { if(ch==='"'){ inQuotes=true; } else if(ch===','){ row.push(cur); cur=''; } else cur+=ch; } } row.push(cur); return row; }); }

})();
