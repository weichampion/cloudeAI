import 'dotenv/config';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import sessionsRouter from './routes/sessions.js';
import chatRouter from './routes/chat.js';
import configRouter from './routes/config.js';
import groupsRouter from './routes/groups.js';
import botsRouter from './routes/bots.js';
import authRouter from './routes/auth.js';
import friendsRouter from './routes/friends.js';
import skillsRouter from './routes/skills.js';
import uploadRouter from './routes/upload.js';
import { setupGroupWebSocket } from './ws/groupChat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import './db/groups.js'; // 初始化群聊数据表
import './db/users.js';  // 初始化用户数据表
import './db/skills.js'; // 初始化技能数据表 + 内置技能
import './db/discussion.js'; // 初始化讨论数据表
import { authMiddleware } from './middleware/auth.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/sessions', sessionsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/config', configRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/bots', botsRouter);
app.use('/api/auth', authRouter);
app.use('/api/friends', authMiddleware, friendsRouter);
app.use('/api/skills', authMiddleware, skillsRouter);
app.use('/api/upload', uploadRouter);
// Serve uploaded files (与 upload.js 的 UPLOADS_DIR 保持一致)
app.use('/uploads', express.static(path.join(__dirname, '../data/uploads')));

// Serve frontend static files
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
// SPA fallback: 非 API 路由统一返回 index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 创建 HTTP Server，WebSocket 共用同一端口
const server = http.createServer(app);
setupGroupWebSocket(server);

server.listen(PORT, () => {
  console.log(`✅ OpenClaw 后端运行在 http://localhost:${PORT}`);
  console.log(`   WebSocket 群聊: ws://localhost:${PORT}/ws/group`);
  console.log(`   模型: ${process.env.MODEL || 'mimo-v2.5-pro'}`);
});
