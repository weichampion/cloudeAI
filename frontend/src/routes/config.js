import { Router } from 'express';

const router = Router();

/**
 * GET /api/config
 * 返回服务端默认配置（API Key 不暴露）
 */
router.get('/', (req, res) => {
  res.json({
    data: {
      baseURL: process.env.BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
      model: process.env.MODEL || 'glm-4-flash',
      hasApiKey: !!(process.env.API_KEY),
      // 预设模型列表供前端选择
      presets: [
        { label: '智谱 GLM-4-Flash（默认）', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
        { label: '智谱 GLM-4-Air',   baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-air' },
        { label: '智谱 GLM-4-Plus',  baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
        { label: 'OpenAI GPT-4o',    baseURL: 'https://api.openai.com/v1',           model: 'gpt-4o' },
        { label: 'DeepSeek Chat',    baseURL: 'https://api.deepseek.com/v1',         model: 'deepseek-chat' },
        { label: 'Ollama 本地',      baseURL: 'http://localhost:11434/v1',           model: 'qwen2.5:7b' },
      ],
    },
  });
});

export default router;
