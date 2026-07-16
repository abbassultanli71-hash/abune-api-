// Mock database queries before importing the server to allow testing without an active PostgreSQL instance
const db = require('./db');

let mockUsers = [];
let mockOtps = [];

db.executeQuery = async (sql, binds = {}, options = {}) => {
  const sqlClean = sql.replace(/\s+/g, ' ').trim();
  
  if (sqlClean.includes('CREATE TABLE IF NOT EXISTS') || sqlClean.startsWith('ALTER TABLE')) {
    return { rows: [], rowsAffected: 0 };
  }
  
  if (sqlClean.startsWith('SELECT username FROM istifadeciler WHERE username =')) {
    const user = mockUsers.find(u => u.username === binds.username);
    return { rows: user ? [{ USERNAME: user.username }] : [], rowsAffected: user ? 1 : 0 };
  }
  
  if (sqlClean.startsWith('SELECT email FROM istifadeciler WHERE email =')) {
    const user = mockUsers.find(u => u.email === binds.email);
    return { rows: user ? [{ EMAIL: user.email }] : [], rowsAffected: user ? 1 : 0 };
  }
  
  if (sqlClean.startsWith('DELETE FROM otp_verifications WHERE email = :email AND purpose = :purpose AND verified = FALSE')) {
    mockOtps = mockOtps.filter(o => !(o.email === binds.email && o.purpose === binds.purpose && !o.verified));
    return { rows: [], rowsAffected: 1 };
  }
  
  if (sqlClean.startsWith('INSERT INTO otp_verifications')) {
    const newOtp = {
      id: Math.floor(Math.random() * 1000000),
      email: binds.email,
      code_hash: binds.codeHash,
      purpose: binds.purpose,
      payload: binds.payload,
      expires_at: binds.expiresAt,
      verified: false
    };
    mockOtps.push(newOtp);
    return { rows: [], rowsAffected: 1 };
  }
  
  if (sqlClean.startsWith('SELECT id, email, code_hash, purpose, payload, expires_at, verified FROM otp_verifications')) {
    const otps = mockOtps.filter(o => o.email === binds.email && o.purpose === binds.purpose && !o.verified);
    otps.sort((a, b) => b.id - a.id);
    const resultRows = otps.map(o => ({
      ID: o.id,
      EMAIL: o.email,
      CODE_HASH: o.code_hash,
      PURPOSE: o.purpose,
      PAYLOAD: o.payload,
      EXPIRES_AT: o.expires_at,
      VERIFIED: o.verified ? 1 : 0
    }));
    return { rows: resultRows, rowsAffected: resultRows.length };
  }
  
  if (sqlClean.startsWith('UPDATE otp_verifications SET verified = TRUE')) {
    const otp = mockOtps.find(o => o.id === binds.id);
    if (otp) otp.verified = true;
    return { rows: [], rowsAffected: 1 };
  }
  
  if (sqlClean.startsWith('INSERT INTO istifadeciler')) {
    const newUser = {
      id: mockUsers.length + 1,
      username: binds.username,
      ad: binds.ad,
      email: binds.email,
      password: binds.password
    };
    mockUsers.push(newUser);
    return { rows: [], rowsAffected: 1 };
  }
  
  if (sqlClean.startsWith('DROP TABLE IF EXISTS otp_verifications') || sqlClean.startsWith('CREATE TABLE otp_verifications')) {
    return { rows: [], rowsAffected: 0 };
  }
  
  if (sqlClean.startsWith('SELECT id FROM istifadeciler WHERE username =')) {
    const user = mockUsers.find(u => u.username === binds.username);
    return { rows: user ? [{ ID: user.id }] : [], rowsAffected: user ? 1 : 0 };
  }
  
  if (sqlClean.startsWith('INSERT INTO istifadeci_ayarlari') || sqlClean.startsWith('INSERT INTO budceler')) {
    return { rows: [], rowsAffected: 1 };
  }
  
  if (sqlClean.startsWith('DELETE FROM otp_verifications WHERE email = :email AND purpose = :purpose')) {
    mockOtps = mockOtps.filter(o => !(o.email === binds.email && o.purpose === binds.purpose));
    return { rows: [], rowsAffected: 1 };
  }
  
  if (sqlClean.startsWith('SELECT id,') && sqlClean.includes('FROM istifadeciler WHERE username =')) {
    const user = mockUsers.find(u => u.username === binds.username);
    return {
      rows: user ? [{
        ID: user.id,
        USERNAME: user.username,
        AD: user.ad,
        EMAIL: user.email,
        PASSWORD: user.password,
        YARADILMA_TARIXI: '2026-07-16 12:00:00'
      }] : [],
      rowsAffected: user ? 1 : 0
    };
  }
  
  if (sqlClean.startsWith('UPDATE istifadeciler SET password = :newPasswordHash')) {
    const user = mockUsers.find(u => u.id === binds.userId);
    if (user) user.password = binds.newPasswordHash;
    return { rows: [], rowsAffected: 1 };
  }

  throw new Error(`Mock SQL: Unhandled query: ${sqlClean}`);
};

// Intercept OTP email sending to capture the generated codes during execution
const otpService = require('./otpService');
let lastCapturedOtp = '';
otpService.sendOtpEmail = async (to, code, purposeText) => {
  console.log(`[TEST SPY] Intercepted OTP: ${code} for ${purposeText} to ${to}`);
  lastCapturedOtp = code;
  return true;
};

// Start the server
process.env.PORT = 8080;
process.env.API_USER = 'admin';
process.env.API_PASSWORD = 'admin123';

// Require server.js to boot the express server
const server = require('./server');

async function runTests() {
  const baseUrl = 'http://localhost:8080/api/istifadeciler';
  const basicAuthHeader = 'Basic ' + Buffer.from('admin:admin123').toString('base64');

  console.log(`\n===========================================================`);
  console.log(`  RUNNING INTEGRATION TESTS FOR abune-api-`);
  console.log(`===========================================================\n`);

  try {
    const testUsername = 'test.user';
    const testEmail = 'test@example.com';
    const originalPassword = 'SifremGizli123';
    const newPassword = 'YeniSifre456';

    // =========================================================
    // Test 1: Initiate Registration
    // =========================================================
    console.log('[Test 1] Initiating registration...');
    const regInitRes = await fetch(`${baseUrl}/register/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({
        username: testUsername,
        ad: 'Test User Name',
        email: testEmail,
        password: originalPassword
      })
    });
    
    const regInitData = await regInitRes.json();
    if (regInitRes.status !== 200) {
      throw new Error(`Failed to initiate registration: ${JSON.stringify(regInitData)}`);
    }
    
    const registrationOtp = lastCapturedOtp;
    console.log(`✔ Registration initiated. message: ${regInitData.message}`);
    console.log(`✔ Intercepted Registration OTP: ${registrationOtp}\n`);

    // =========================================================
    // Test 2: Verify Registration with Invalid OTP
    // =========================================================
    console.log('[Test 2] Verifying registration with incorrect OTP...');
    const regVerifyFailRes = await fetch(`${baseUrl}/register/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({ email: testEmail, otp: '999999' })
    });
    
    const regVerifyFailData = await regVerifyFailRes.json();
    if (regVerifyFailRes.status === 201) {
      throw new Error('Verification succeeded with incorrect OTP, which is a bug!');
    }
    console.log(`✔ Failed as expected. Status: ${regVerifyFailRes.status}, Error: ${regVerifyFailData.error}\n`);

    // =========================================================
    // Test 3: Verify Registration with Correct OTP
    // =========================================================
    console.log('[Test 3] Verifying registration with correct OTP...');
    const regVerifyRes = await fetch(`${baseUrl}/register/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({ email: testEmail, otp: registrationOtp })
    });
    
    const regVerifyData = await regVerifyRes.json();
    if (regVerifyRes.status !== 201) {
      throw new Error(`Verification failed: ${JSON.stringify(regVerifyData)}`);
    }
    console.log(`✔ Registration completed successfully. User account created!\n`);

    // =========================================================
    // Test 4: Authenticate / Login
    // =========================================================
    console.log('[Test 4] Logging in with registration credentials...');
    const loginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({ username: testUsername, password: originalPassword })
    });
    
    const loginData = await loginRes.json();
    if (loginRes.status !== 200) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }
    console.log('✔ Login successful.\n');

    // =========================================================
    // Test 5: Initiate Password Change
    // =========================================================
    console.log('[Test 5] Initiating password change...');
    const passInitRes = await fetch(`${baseUrl}/change-password/initiate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({
        username: testUsername,
        currentpassword: originalPassword,
        newpassword: newPassword
      })
    });
    
    const passInitData = await passInitRes.json();
    if (passInitRes.status !== 200) {
      throw new Error(`Password change initiation failed: ${JSON.stringify(passInitData)}`);
    }
    
    const passwordOtp = lastCapturedOtp;
    console.log(`✔ Password change initiated. message: ${passInitData.message}`);
    console.log(`✔ Intercepted Password OTP: ${passwordOtp}\n`);

    // =========================================================
    // Test 6: Verify Password Change with Wrong OTP
    // =========================================================
    console.log('[Test 6] Verifying password change with incorrect OTP...');
    const passVerifyFailRes = await fetch(`${baseUrl}/change-password/verify`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({ username: testUsername, otp: '000000' })
    });
    
    const passVerifyFailData = await passVerifyFailRes.json();
    if (passVerifyFailRes.status === 200) {
      throw new Error('Password updated with wrong OTP, which is a bug!');
    }
    console.log(`✔ Failed as expected. Status: ${passVerifyFailRes.status}, Error: ${passVerifyFailData.error}\n`);

    // =========================================================
    // Test 7: Verify Password Change with Correct OTP
    // =========================================================
    console.log('[Test 7] Verifying password change with correct OTP...');
    const passVerifyRes = await fetch(`${baseUrl}/change-password/verify`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({ username: testUsername, otp: passwordOtp })
    });
    
    const passVerifyData = await passVerifyRes.json();
    if (passVerifyRes.status !== 200) {
      throw new Error(`Password change verification failed: ${JSON.stringify(passVerifyData)}`);
    }
    console.log('✔ Password change successfully completed.\n');

    // =========================================================
    // Test 8: Verify login with OLD password fails
    // =========================================================
    console.log('[Test 8] Attempting to login with OLD password...');
    const loginOldRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({ username: testUsername, password: originalPassword })
    });
    
    const loginOldData = await loginOldRes.json();
    if (loginOldRes.status === 200) {
      throw new Error('Successfully logged in with the old password after it was changed!');
    }
    console.log(`✔ Blocked as expected. Status: ${loginOldRes.status}, Error: ${loginOldData.error}\n`);

    // =========================================================
    // Test 9: Verify login with NEW password succeeds
    // =========================================================
    console.log('[Test 9] Logging in with NEW password...');
    const loginNewRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuthHeader
      },
      body: JSON.stringify({ username: testUsername, password: newPassword })
    });
    
    const loginNewData = await loginNewRes.json();
    if (loginNewRes.status !== 200) {
      throw new Error(`Login with new password failed: ${JSON.stringify(loginNewData)}`);
    }
    console.log('✔ Login with new password successful!\n');

    console.log(`===========================================================`);
    console.log(`  🎉 ALL OTP INTEGRATION TESTS PASSED SUCCESSFULLY!`);
    console.log(`===========================================================`);

  } catch (error) {
    console.error(`\n❌ TEST FAILURE:`, error);
    process.exit(1);
  } finally {
    console.log('Closing test server...');
    process.exit(0);
  }
}

// Start running the tests after the server finishes starting
setTimeout(runTests, 1000);
