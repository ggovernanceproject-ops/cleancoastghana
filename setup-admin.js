#!/usr/bin/env node

require('dotenv').config();
const admin = require('firebase-admin');
const readline = require('readline');

const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function setupAdmin() {
  console.log('\n🔧 GCCP Admin Setup\n');
  
  try {
    const email = await question('Admin email: ');
    const password = await question('Admin password (min 6 chars): ');
    
    if (!email || !password || password.length < 6) {
      console.error('❌ Invalid input');
      rl.close();
      return;
    }
    
    console.log('\n⏳ Creating admin user...');
    
    const userRecord = await auth.createUser({
      email,
      password,
      emailVerified: false
    });
    
    await auth.setCustomUserClaims(userRecord.uid, { admin: true });
    
    console.log('\n✅ Admin user created successfully!');
    console.log(`   Email: ${email}`);
    console.log(`   UID: ${userRecord.uid}`);
    console.log('\n   You can now log in at: http://localhost:3000/admin-login.html\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  rl.close();
}

setupAdmin();
