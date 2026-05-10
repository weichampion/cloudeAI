/**
 * AI 配置中间件
 * 优先级：请求头 X-AI-* > 环境变量
 * 前端设置页可通过请求头传入运行时配置
 */
export function resolveAIConfig(req) {
  return {
    apiKey:  req.headers['x-ai-api-key']  || process.env.API_KEY  || '',
    baseURL: req.headers['x-ai-base-url'] || process.env.BASE_URL || 'https://token-plan-cn.xiaomimimo.com/anthropic',
    model:   req.headers['x-ai-model']    || process.env.MODEL    || 'mimo-v2.5-pro',
  };
}
