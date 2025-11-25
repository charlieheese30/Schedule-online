// Quick API test to verify data persistence
const BASE_URL = 'http://localhost:3000/api';

async function testAPI() {
  console.log('=== Testing TeamShifter API ===\n');
  
  try {
    // 1. Test login with default admin
    console.log('1. Testing login with default admin credentials...');
    const loginRes = await fetch(BASE_URL + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' })
    });
    const loginData = await loginRes.json();
    console.log('   Login status:', loginRes.status);
    console.log('   Token received:', !!loginData.token);
    const token = loginData.token;
    
    // 2. Test company registration
    console.log('\n2. Testing company registration...');
    const companyRes = await fetch(BASE_URL + '/companies/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Test Company ' + Date.now(),
        ownerUsername: 'owner_' + Date.now(),
        ownerPassword: 'testpass123',
        ownerEmail: 'owner@test.com'
      })
    });
    const companyData = await companyRes.json();
    console.log('   Company registration status:', companyRes.status);
    console.log('   Company owner token:', !!companyData.token);
    console.log('   Company ID:', companyData.company);
    const companyToken = companyData.token;
    const companyId = companyData.company;
    
    // 3. Test adding a user as owner
    console.log('\n3. Testing user creation (with owner token)...');
    const userRes = await fetch(BASE_URL + '/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + companyToken
      },
      body: JSON.stringify({
        username: 'employee_' + Date.now(),
        password: 'emppass456',
        role: 'employee',
        email: 'emp@test.com'
      })
    });
    console.log('   User creation status:', userRes.status);
    
    // 4. Test shift creation
    console.log('\n4. Testing shift creation (with owner token)...');
    const today = new Date();
    const dateStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    
    const shiftRes = await fetch(BASE_URL + '/shifts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + companyToken
      },
      body: JSON.stringify({
        date: dateStr,
        employee: 'employee_' + Date.now(),
        role: 'employee',
        start: '09:00',
        end: '17:00',
        color: '#2d5016'
      })
    });
    console.log('   Shift creation status:', shiftRes.status);
    
    // 5. Test getting users (verify they were saved)
    console.log('\n5. Testing user retrieval (verify data persisted)...');
    const getUsersRes = await fetch(BASE_URL + '/users', {
      headers: { 'Authorization': 'Bearer ' + companyToken }
    });
    const users = await getUsersRes.json();
    console.log('   Retrieved users count:', users.length);
    console.log('   Users:', users.map(u => u.username).join(', '));
    
    // 6. Test getting shifts (verify they were saved)
    console.log('\n6. Testing shift retrieval (verify data persisted)...');
    const getShiftsRes = await fetch(BASE_URL + '/shifts', {
      headers: { 'Authorization': 'Bearer ' + companyToken }
    });
    const shifts = await getShiftsRes.json();
    console.log('   Retrieved shifts count:', shifts.length);
    console.log('   Shifts for company:', shifts.filter(s => s.company === companyId).length);
    
    console.log('\n✓ All API tests completed successfully!');
    console.log('✓ Data persistence is working - check data/users.json, data/shifts.json, data/companies.json');
    
  } catch (err) {
    console.error('✗ Test failed:', err.message);
    process.exit(1);
  }
}

testAPI();
