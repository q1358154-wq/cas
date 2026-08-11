// =========================================================
// CQS AI GLOBAL
// Multi-Provider Secure Streaming Gateway
// /api/chat.js
// =========================================================

export default async function handler(req, res) {

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            success: false,
            error: `Method ${req.method} Not Allowed`
        });
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    try {
        const body = req.body || {};

        const provider =
            typeof body.provider === "string"
                ? body.provider.trim().toLowerCase()
                : "deepseek";

        const allowedProviders = new Set(["deepseek", "still", "agent"]);

        if (!allowedProviders.has(provider)) {
            return res.status(400).json({
                success: false,
                error: `不支持的 Provider: ${provider}`
            });
        }

        const messages = body.messages;
        const systemPrompt = body.systemPrompt;
        const conversationId = body.conversationId;

        // 🟢 【新增日志 1】在这里打印前端传过来的核心参数，方便你排查到底选的是哪个模型
        console.log(`[CQS DEBUG] 收到前端请求 -> Provider: ${provider}, 消息条数: ${messages?.length || 0}`);

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ success: false, error: "messages 必须是非空数组" });
        }

        if (messages.length > 50) {
            return res.status(400).json({ success: false, error: "对话上下文过长，最多允许 50 条消息" });
        }

        let safeConversationId = "";
        if (typeof conversationId === "string") {
            safeConversationId = conversationId.trim().substring(0, 100);
        }
        void safeConversationId;

        let cleanSystemPrompt = "";
        if (typeof systemPrompt === "string") {
            cleanSystemPrompt = systemPrompt.trim();
            if (cleanSystemPrompt.length > 20000) {
                return res.status(400).json({ success: false, error: "System Prompt 过长，最大允许 20000 个字符" });
            }
        }

        const allowedRoles = new Set(["user", "assistant"]);
        const cleanMessages = [];

        for (const message of messages) {
            if (!message || typeof message !== "object") continue;
            const role = message.role;
            const content = message.content;
            if (!allowedRoles.has(role) || typeof content !== "string") continue;
            const cleanContent = content.trim();
            if (!cleanContent) continue;

            cleanMessages.push({
                role,
                content: cleanContent.substring(0, 12000)
            });
        }

        if (cleanMessages.length === 0) {
            return res.status(400).json({ success: false, error: "没有合法的对话内容" });
        }

        const finalMessages = [];
        if (cleanSystemPrompt) {
            finalMessages.push({ role: "system", content: cleanSystemPrompt });
        }
        finalMessages.push(...cleanMessages);

        let providerConfig;

        // DEEPSEEK
        if (provider === "deepseek") {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            if (!apiKey || !apiKey.trim()) {
                return res.status(500).json({ success: false, error: "服务器未配置 DEEPSEEK_API_KEY" });
            }

            providerConfig = {
                name: "DeepSeek",
                url: "https://api.deepseek.com/chat/completions",
                apiKey: apiKey.trim(),
                model: "deepseek-v4-flash",
                thinking: true,
                reasoningEffort: "high"
            };
        }

        // STILL
        if (provider === "still") {
            const apiUrl = process.env.STILL_API_URL;
            const apiKey = process.env.STILL_API_KEY;
            const model = process.env.STILL_MODEL || "default";

            if (!apiUrl || !apiUrl.trim()) {
                return res.status(503).json({ success: false, provider: "still", error: "Still Provider 尚未配置 STILL_API_URL" });
            }
            if (!apiKey || !apiKey.trim()) {
                return res.status(503).json({ success: false, provider: "still", error: "Still Provider 尚未配置 STILL_API_KEY" });
            }

            providerConfig = {
                name: "Still",
                url: apiUrl.trim(),
                apiKey: apiKey.trim(),
                model,
                thinking: false,
                reasoningEffort: null
            };
        }

        // AGENT
        if (provider === "agent") {
            const apiUrl = process.env.AGENT_API_URL;
            const apiKey = process.env.AGENT_API_KEY;
            const model = process.env.AGENT_MODEL || "default";

            if (!apiUrl || !apiUrl.trim()) {
                return res.status(503).json({ success: false, provider: "agent", error: "Agent Provider 尚未配置 AGENT_API_URL" });
            }
            if (!apiKey || !apiKey.trim()) {
                return res.status(503).json({ success: false, provider: "agent", error: "Agent Provider 尚未配置 AGENT_API_KEY" });
            }

            providerConfig = {
                name: "Agent",
                url: apiUrl.trim(),
                apiKey: apiKey.trim(),
                model,
                thinking: false,
                reasoningEffort: null
            };
        }

        if (!providerConfig) {
            return res.status(500).json({ success: false, error: "Provider 配置初始化失败" });
        }

        // 🟢 【新增日志 2】打印最终准备发给上游 AI 接口的目标 URL 和模型名字
        console.log(`[CQS DEBUG] 正在转发请求 -> 目标: ${providerConfig.name}, URL: ${providerConfig.url}, Model: ${providerConfig.model}`);

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        let closed = false;
        let finished = false;
        const upstreamController = new AbortController();

        const sendEvent = (payload) => {
            if (closed || res.writableEnded) return;
            try {
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
            } catch {
                closed = true;
            }
        };

        req.on("close", () => {
            closed = true;
            try { upstreamController.abort(); } catch {}
        });

        const timeout = setTimeout(() => {
            try { upstreamController.abort(); } catch {}
        }, 120000);

        const upstreamBody = {
            model: providerConfig.model,
            messages: finalMessages,
            stream: true
        };

        if (provider === "deepseek") {
            upstreamBody.thinking = { type: "enabled" };
            upstreamBody.reasoning_effort = "high";
            upstreamBody.stream_options = { include_usage: true };
        }

        let upstreamResponse;
        try {
            upstreamResponse = await fetch(providerConfig.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${providerConfig.apiKey}`,
                    "Accept": "text/event-stream"
                },
                body: JSON.stringify(upstreamBody),
                signal: upstreamController.signal
            });
        } catch (error) {
            clearTimeout(timeout);
            console.error(`[CQS ${providerConfig.name} Connection Error Detail]:`, error);

            if (!closed) {
                sendEvent({ type: "error", error: `无法连接 ${providerConfig.name} AI 服务: ${error.message}` });
                sendEvent({ type: "done" });
                try { res.end(); } catch {}
            }
            return;
        }

        if (!upstreamResponse.ok) {
            clearTimeout(timeout);
            let errorMessage = `${providerConfig.name} API 请求失败 (${upstreamResponse.status})`;
            try {
                const errorText = await upstreamResponse.text();
                // 🟢 【新增日志 3】把大模型上游返回的原始错误信息完整打印到后端日志里
                console.error(`[CQS ${providerConfig.name} Upstream Raw Error]:`, errorText);
                if (errorText) {
                    try {
                        const errorData = JSON.parse(errorText);
                        errorMessage = errorData?.error?.message || errorData?.error || errorData?.message || errorMessage;
                    } catch {}
                }
            } catch {}

            if (!closed) {
                sendEvent({ type: "error", error: errorMessage });
                sendEvent({ type: "done" });
                try { res.end(); } catch {}
            }
            return;
        }

        if (!upstreamResponse.body) {
            clearTimeout(timeout);
            if (!closed) {
                sendEvent({ type: "error", error: `${providerConfig.name} 没有返回流式数据` });
                sendEvent({ type: "done" });
                try { res.end(); } catch {}
            }
            return;
        }

        const reader = upstreamResponse.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        const processProviderEvent = (event) => {
            if (closed) return;
            const lines = event.split(/\r?\n/);
            const dataLines = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trim());
            if (dataLines.length === 0) return;
            const data = dataLines.join("\n");
            if (!data) return;

            if (data === "[DONE]") {
                finished = true;
                return;
            }

            let packet;
            try {
                packet = JSON.parse(data);
            } catch {
                return;
            }

            const choice = packet?.choices?.[0];
            const delta = choice?.delta;

            if (delta && typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
                sendEvent({ type: "reasoning", content: delta.reasoning_content });
            } else if (delta && typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
                sendEvent({ type: "reasoning", content: delta.reasoning });
            }

            if (delta && typeof delta.content === "string" && delta.content.length > 0) {
                sendEvent({ type: "delta", content: delta.content });
            }

            if (packet?.usage) {
                sendEvent({ type: "usage", usage: packet.usage });
            }

            if (packet?.error) {
                const message = typeof packet.error === "string" ? packet.error : packet.error?.message || `${providerConfig.name} Provider Error`;
                sendEvent({ type: "error", error: message });
            }
        };

        try {
            while (!finished && !closed) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                }

                const events = buffer.split(/\r?\n\r?\n/);
                buffer = events.pop() || "";

                for (const event of events) {
                    if (closed) break;
                    processProviderEvent(event);
                }
            }

            buffer += decoder.decode();
            if (!closed && buffer.trim()) {
                const events = buffer.split(/\r?\n\r?\n/);
                for (const event of events) {
                    if (closed) break;
                    processProviderEvent(event);
                }
            }

            if (!closed) {
                sendEvent({ type: "done" });
            }
        } catch (error) {
            console.error(`[CQS ${providerConfig.name} Stream Error Detail]:`, error);
            if (!closed) {
                sendEvent({ type: "error", error: error?.name === "AbortError" ? "AI 请求已取消" : `${providerConfig.name} AI 流式传输发生错误` });
                sendEvent({ type: "done" });
            }
        } finally {
            clearTimeout(timeout);
            try { reader.releaseLock(); } catch {}
            if (!closed) {
                try { res.end(); } catch {}
            }
        }

    } catch (error) {
        console.error("[CQS AI Gateway Critical Error]:", error);
        if (res.headersSent) {
            try {
                res.write(`data: ${JSON.stringify({ type: "error", error: "服务器内部错误" })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
                res.end();
            } catch {}
            return;
        }

        return res.status(500).json({ success: false, error: "服务器内部错误" });
    }
}
