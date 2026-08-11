export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({
            success: false,
            error: `Method ${req.method} Not Allowed`
        });
    }
    try {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey || !apiKey.trim()) {
            return res.status(500).json({
                success: false,
                error: '服务器未配置 DEEPSEEK_API_KEY'
            });
        }
        const body = req.body || {};
        const messages = body.messages;
        const systemPrompt = body.systemPrompt;
        
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'messages 必须是非空数组'
            });
        }
        if (messages.length > 50) {
            return res.status(400).json({
                success: false,
                error: '对话上下文过长，最多允许 50 条消息'
            });
        }
        let cleanSystemPrompt = '';
        if (typeof systemPrompt === 'string') {
            cleanSystemPrompt = systemPrompt.trim();
            if (cleanSystemPrompt.length > 20000) {
                return res.status(400).json({
                    success: false,
                    error: 'System Prompt 过长，最大允许 20000 个字符'
                });
            }
        }
        const allowedRoles = new Set(['user', 'assistant']);
        const cleanMessages = [];
        for (const message of messages) {
            if (!message || typeof message !== 'object') continue;
            const role = message.role;
            const content = message.content;
            if (!allowedRoles.has(role) || typeof content !== 'string') continue;
            const cleanContent = content.trim();
            if (!cleanContent) continue;
            cleanMessages.push({
                role,
                content: cleanContent.substring(0, 10000)
            });
        }
        if (cleanMessages.length === 0) {
            return res.status(400).json({
                success: false,
                error: '没有合法的对话内容'
            });
        }
        const finalMessages = [];
        if (cleanSystemPrompt) {
            finalMessages.push({
                role: 'system',
                content: cleanSystemPrompt
            });
        }
        finalMessages.push(...cleanMessages);

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey.trim()}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: finalMessages,
                stream: false
            })
        });
        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            return res.status(502).json({
                success: false,
                error: 'DeepSeek 返回了无法解析的数据'
            });
        }
        if (!response.ok) {
            const errorMessage = data?.error?.message || data?.message || `DeepSeek API 请求失败 (${response.status})`;
            return res.status(response.status).json({
                success: false,
                error: errorMessage
            });
        }
        const reply = data?.choices?.[0]?.message?.content;
        if (typeof reply !== 'string' || !reply.trim()) {
            return res.status(502).json({
                success: false,
                error: 'DeepSeek 返回了无效的 AI 回复'
            });
        }
        return res.status(200).json({
            success: true,
            reply: reply,
            usage: data?.usage || {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: '服务器内部错误',
            detail: error?.message || 'Unknown error'
        });
    }
}
