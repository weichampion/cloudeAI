import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import controlRouter from './router.js';
import '../db/users.js';
import '../db/control.js';

const app = express();
const PORT = parseInt(process.env.CONTROL_PORT || '18789', 10);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'control-plane', time: new Date().toISOString() });
});

app.use('/api/control', controlRouter);

app.use((err, req, res, _next) => {
  console.error('[control-plane]', err);
  res.status(500).json({ error: '控制平面内部错误' });
});

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`✅ Control Plane 运行在 http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/control`);
});

