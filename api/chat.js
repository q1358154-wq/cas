export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method Not Allowed'
    });
  }

  try {
    // ==============================
    // 1. 检查 API Key
    // ==============================

    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      console.error('DEEPSEEK_API_KEY is not configured');

      return res.status(500).json({
        success: false,
        error: '服务器未配置 DEEPSEEK_API_KEY'
      });
    }

    // ==============================
    // 2. 读取请求数据
    // ==============================

    const body = req.body || {};

    const messages = Array.isArray(body.messages)
      ? body.messages
      : [];

    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: '消息不能为空'
      });
    }

    // ==============================
    // 3. 清理消息
    // ==============================

    const cleanMessages = messages
      .filter(message => {
        return (
          message &&
          typeof message.role === 'string' &&
          typeof message.content === 'string'
        );
      })
      .map(message => ({
        role: message.role,
        content: message.content
      }));

    if (cleanMessages.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有有效的消息内容'
      });
    }

    // ==============================
    // 4. 请求 DeepSeek
    // ==============================

    const response = await fetch(
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
        })
      }
    );

    // ==============================
    // 5. 获取原始响应
    // ==============================

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = {
        raw: responseText
      };
    }

    // ==============================
    // 6. DeepSeek 返回错误
    // ==============================

    if (!response.ok) {
      console.error(
        'DeepSeek API Error:',
        response.status,
        data
      );

      const apiError =
        data?.error?.message ||
        data?.message ||
        `DeepSeek API Error (${response.status})`;

      return res.status(response.status).json({
        success: false,
        error: apiError
      });
    }

    // ==============================
    // 7. 验证返回结果
    // ==============================

    const reply =
      data?.choices?.[0]?.message?.content;

    if (!reply) {
      console.error(
        'Invalid DeepSeek response:',
        data
      );

      return res.status(502).json({
        success: false,
        error: 'DeepSeek 返回了无效响应'
      });
    }

    // ==============================
    // 8. 正常返回
    // ==============================

    return res.status(200).json({
      success: true,
      reply: reply,
      usage: data?.usage || null
    });

  } catch (error) {

    // ==============================
    // 9. 网络 / Fetch / 服务器异常
    // ==============================

    console.error(
      'DeepSeek request failed:',
      error
    );

    return res.status(500).json({
      success: false,
      error: 'DeepSeek 连接失败',
      detail: error?.message || String(error)
    });
  }
}
