# OpenClaw

AI 驱动的多智能体聊天平台，支持一对一 AI 对话、群聊协作和多种多智能体协作模式。

## 功能特性

### 一对一 AI 对话
- SSE 流式响应，实时显示回复
- 支持 Function Calling / Tool Use
- 可配置系统提示词
- 自动从首条消息生成会话标题

### 群聊
- WebSocket 实时通信
- 邀请码加入群组
- 成员角色管理（群主、成员、禁言）
- 多种 Bot 路由方式：`@BotName` 提及、活跃 Bot 选择、技能自动匹配、`@AI` 兜底

### 多智能体协作模式
| 命令 | 说明 |
|------|------|
| `/task [描述]` | 多 Bot 流水线任务处理 |
| `/discuss [主题]` | 结构化多智能体讨论，轮流发言 |
| `/freedom [背景]` | 自由 AI 群聊，Bot 自主对话 |
| `/research [主题]` | 深度研究，自动生成报告并保存为 Markdown |
| `/stop` | 停止当前运行的操作 |

### 技能/插件系统
- 内置技能：日期时间、计算器、随机数
- 文件操作：读取、写入、列表
- 数据库操作：支持 SQLite、MySQL、PostgreSQL
- 网络搜索：支持 Serper、Tavily API
- HTTP API 调用
- MCP StreamableHTTP 协议
- 群组管理：踢出、警告、禁言/解禁

### 用户系统
- 注册/登录（JWT 认证）
- 首位注册用户自动成为管理员
- 好友系统：搜索、发送/接受/拒绝请求
- 好友私聊

### Bot 管理
- 创建自定义 Bot（名称、颜色、系统提示词、API Key、模型）
- 绑定技能到 Bot
- 群组内添加/移除 Bot
- 设置群组活跃 Bot

### 移动端支持
- Capacitor 封装，支持 iOS 和 Android
- 原生 splash screen 和状态栏配置

## 技术栈

**前端：** React 18 + Vite + Tailwind CSS + Capacitor

**后端：** Node.js + Express + WebSocket + SQLite + JWT

**AI SDK：** OpenAI SDK + Anthropic SDK（统一客户端自动路由）

## 快速开始

### 环境要求
- Node.js >= 18
- npm

### 后端

```bash
cd backend
npm install
```

创建 `backend/.env` 文件：

```env
API_KEY=your-api-key
BASE_URL=https://api.anthropic.com
MODEL=claude-sonnet-4-20250514
PORT=3000
CORS_ORIGIN=*
MAX_HISTORY_TURNS=20
```

```bash
# 生产模式
npm start

# 开发模式（自动重载）
npm run dev
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

开发服务器运行在 `http://localhost:5173`，自动代理 API 请求到后端。

### 生产部署

```bash
cd frontend
npm run build
```

构建产物输出到 `frontend/dist/`，后端会自动托管静态文件。访问 `http://localhost:3000` 即可使用。

### 移动端构建

```bash
cd frontend
npm run cap:android   # 构建并打开 Android Studio
npm run cap:ios       # 构建并打开 Xcode
```

## 项目结构

```
cloudAI/
  backend/
    src/
      index.js              # 主入口（Express + WebSocket）
      ai/client.js          # 统一 AI 客户端
      control/              # 管理控制台
      db/                   # 数据库表结构
      middleware/            # 认证、权限中间件
      routes/               # REST API 路由
      ws/                   # WebSocket 处理器
    data/
      openclaw.db           # SQLite 数据库
      uploads/              # 上传文件
  frontend/
    src/
      main.jsx              # React 入口
      App.jsx               # 主组件
      pages/                # 页面组件
      components/           # UI 组件
      hooks/                # 自定义 Hooks
      services/             # API 服务
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 获取当前用户 |
| GET/POST | `/api/sessions` | 会话列表/创建 |
| POST | `/api/chat/:sessionId` | 发送消息（SSE 流） |
| GET/POST | `/api/groups` | 群组列表/创建 |
| POST | `/api/groups/join` | 加入群组 |
| GET | `/api/bots` | Bot 列表 |
| GET | `/api/skills` | 技能列表 |
| POST | `/api/upload` | 文件上传 |
| WS | `/ws/group` | 群聊 WebSocket |

## 预置模型

- MiMo（默认）
- 智谱 GLM-4（Flash/Air/Plus）
- DeepSeek Chat
- OpenAI GPT-4o
- Claude Sonnet
- Ollama 本地模型

## License

MIT
