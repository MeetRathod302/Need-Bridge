import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractRouter } from './routes/extract.js';
import { listingsRouter } from './routes/listings.js';
import { matchRouter } from './routes/match.js';
import { notifyRouter } from './routes/notify.js';
import { db } from './db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, '../frontend')));

// Request logging — keeps it readable without a bulky logger dependency
app.use((req, _res, next) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

app.use('/api/extract', extractRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/match', matchRouter);
app.use('/api/notify', notifyRouter);

app.get('/api/health', async (_req, res) => {
  try {
    await db.from('listings').select('id').limit(1);
    res.json({ status: 'ok', db: 'connected', ts: Date.now() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`NeedBridge API running on :${PORT}`);
});
