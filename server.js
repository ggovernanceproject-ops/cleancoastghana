require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');

const app = express();

// ── MIDDLEWARE ──
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── FIREBASE INIT ──
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.firestore();
const auth = admin.auth();

// ── AUTH MIDDLEWARE ──
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ── AUTH ROUTES ──

// Admin login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const userRecord = await auth.getUserByEmail(email);
    
    // Check if user has admin claim
    const claims = (await auth.getUser(userRecord.uid)).customClaims;
    if (!claims || !claims.admin) {
      return res.status(403).json({ error: 'Admin access denied' });
    }
    
    const token = jwt.sign(
      { uid: userRecord.uid, email: userRecord.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { email: userRecord.email, uid: userRecord.uid } });
  } catch (error) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Admin register (protected - first admin only)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const adminKey = req.headers['x-admin-key'];
    
    if (adminKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({ error: 'Invalid setup key' });
    }
    
    const userRecord = await auth.createUser({
      email,
      password,
      emailVerified: false
    });
    
    await auth.setCustomUserClaims(userRecord.uid, { admin: true });
    res.json({ uid: userRecord.uid, email: userRecord.email });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── DATA ROUTES ──

// Get donations
app.get('/api/donations', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const snapshot = await db.collection('donations')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    const donations = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json({ 
      data: donations,
      stats: {
        total: donations.length,
        completed: donations.filter(d => d.status === 'paid').length,
        totalAmount: donations.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get investor inquiries
app.get('/api/investors', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const snapshot = await db.collection('investor_inquiries')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    const investors = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json({ data: investors, total: investors.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get contact messages
app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const snapshot = await db.collection('contact_messages')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    const contacts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json({ data: contacts, total: contacts.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update donation status
app.patch('/api/donations/:id', authenticateToken, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const docRef = db.collection('donations').doc(req.params.id);
    
    await docRef.update({
      status,
      notes: notes || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({ message: 'Updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete record
app.delete('/api/:collection/:id', authenticateToken, async (req, res) => {
  try {
    const { collection, id } = req.params;
    await db.collection(collection).doc(id).delete();
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── CONTENT MANAGEMENT ──

// Get page content
app.get('/api/content/:page', authenticateToken, async (req, res) => {
  try {
    const doc = await db.collection('page_content').doc(req.params.page).get();
    res.json(doc.exists ? doc.data() : { page: req.params.page, sections: {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update page content
app.put('/api/content/:page', authenticateToken, async (req, res) => {
  try {
    const { sections, metadata } = req.body;
    await db.collection('page_content').doc(req.params.page).set({
      page: req.params.page,
      sections,
      metadata,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.email
    }, { merge: true });
    
    res.json({ message: 'Content updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all content
app.get('/api/content', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.collection('page_content').get();
    const content = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ data: content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── SETTINGS ──

// Get settings
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('main').get();
    res.json(doc.exists ? doc.data() : { 
      siteTitle: 'Ghana Coastline Conservation Program',
      hero: {},
      footer: {}
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings
app.put('/api/settings', authenticateToken, async (req, res) => {
  try {
    await db.collection('settings').doc('main').set({
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.email
    }, { merge: true });
    
    res.json({ message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── EXPORT DATA ──

// Export to CSV
app.get('/api/export/:collection', authenticateToken, async (req, res) => {
  try {
    const { collection } = req.params;
    const snapshot = await db.collection(collection)
      .orderBy('createdAt', 'desc')
      .get();
    
    const docs = snapshot.docs.map(doc => doc.data());
    
    if (docs.length === 0) {
      return res.json({ csv: 'No data' });
    }
    
    // Convert to CSV
    const headers = Object.keys(docs[0]);
    const csv = [
      headers.join(','),
      ...docs.map(doc => 
        headers.map(h => {
          const val = doc[h];
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val).includes(',') ? `"${val}"` : val;
        }).join(',')
      )
    ].join('\n');
    
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="${collection}-export.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── HEALTH CHECK ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ── ERROR HANDLING ──
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── START SERVER ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Admin server running on port ${PORT}`);
  console.log(`✓ Dashboard: http://localhost:${PORT}`);
});
