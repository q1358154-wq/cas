export default async function handler(req, res) {
  // ==============================
  // 1. 只允许 POST
  // ==============================

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: '只允许 POST 请求'
      }
    });
  }

  try {
    // ==============================
    // 2. 检查 API Key
    // ==============================

    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      console.error('DEEPSEEK_API_KEY is not configured');

      return res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_CONFIG_ERROR',
          message: '服务器未正确配置 AI 服务'
        }
      });
    }

    // ==============================
    // 3. 读取请求数据
    // ==============================

    const body = req.body || {};

    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body)
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: '请求数据格式错误'
        }
      });
    }

    const messages = Array.isArray(body.messages)
      ? body.messages
      : [];

    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'EMPTY_MESSAGES',
          message: '消息不能为空'
        }
      });
    }

    // ==============================
    // 4. 限制消息数量
    // ==============================

    const MAX_MESSAGES = 100;

    if (messages.length > MAX_MESSAGES) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOO_MANY_MESSAGES',
          message: `消息数量不能超过 ${MAX_MESSAGES} 条`
        }
      });
    }

    // ==============================
    // 5. 清理并验证消息
    // ==============================

    const allowedRoles = new Set([
      'system',
      'user',
      'assistant'
    ]);

    const MAX_MESSAGE_LENGTH = 20000;
    const MAX_TOTAL_LENGTH = 100000;

    let totalLength = 0;

    const cleanMessages = [];

    for (const message of messages) {
      if (
        !message ||
        typeof message !== 'object' ||
        typeof message.role !== 'string' ||
        typeof message.content !== 'string'
      ) {
        continue;
      }

      if (!allowedRoles.has(message.role)) {
        continue;
      }

      const content = message.content.trim();

      if (!content) {
        continue;
      }

      if (content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MESSAGE_TOO_LONG',
            message: `单条消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符`
          }
        });
      }

      totalLength += content.length;

      if (totalLength > MAX_TOTAL_LENGTH) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CONTEXT_TOO_LARGE',
            message: '本次对话内容过长，请开启新会话'
          }
        });
      }

      cleanMessages.push({
        role: message.role,
        content
      });
    }

    if (cleanMessages.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_MESSAGES',
          message: '没有有效的消息内容'
        }
      });
    }

    // ==============================
    // 6. DeepSeek 请求超时控制
    // ==============================

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000);

    let response;

    try {
      response = await fetch(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },

          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: cleanMessages,
            stream: false
          }),

          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    // ==============================
    // 7. 获取 DeepSeek 原始响应
    // ==============================

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = null;
    }

    // ==============================
    // 8. DeepSeek API 错误
    // ==============================

    if (!response.ok) {
      console.error(
        'DeepSeek API Error:',
        response.status,
        data
      );

      const upstreamMessage =
        data?.error?.message ||
        data?.message ||
        `DeepSeek API Error (${response.status})`;

      let code = 'UPSTREAM_ERROR';

      if (response.status === 401) {
        code = 'UPSTREAM_AUTH_ERROR';
      } else if (response.status === 429) {
        code = 'RATE_LIMITED';
      } else if (response.status >= 500) {
        code = 'UPSTREAM_SERVER_ERROR';
      }

      return res.status(502).json({
        success: false,
        error: {
          code,
          message: upstreamMessage
        }
      });
    }

    // ==============================
    // 9. 验证 AI 回复
    // ==============================

    const reply =
      data?.choices?.[0]?.message?.content;

    if (
      typeof reply !== 'string' ||
      !reply.trim()
    ) {
      console.error(
        'Invalid DeepSeek response:',
        data
      );

      return res.status(502).json({
        success: false,
        error: {
          code: 'INVALID_UPSTREAM_RESPONSE',
          message: 'AI 服务返回了无效响应'
        }
      });
    }

    // ==============================
    // 10. 正常返回
    // ==============================

    return res.status(200).json({
      success: true,
      reply,
      usage: data?.usage || null
    });

  } catch (error) {

    // ==============================
    // 11. Timeout
    // ==============================

    if (error?.name === 'AbortError') {
      console.error('DeepSeek request timeout');

      return res.status(504).json({
        success: false,
        error: {
          code: 'UPSTREAM_TIMEOUT',
          message: 'AI 服务响应超时，请稍后重试'
        }
      });
    }

    // ==============================
    // 12. 网络 / 服务器异常
    // ==============================

    console.error(
      'DeepSeek request failed:',
      error
    );

    return res.status(502).json({
      success: false,
      error: {
        code: 'UPSTREAM_CONNECTION_ERROR',
        message: 'AI 服务连接失败，请稍后重试'
      }
    });
  }
}