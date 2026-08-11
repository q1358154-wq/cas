export default async function handler(req, res) {
    // =========================================================
    // CQS AI Global
    // DeepSeek Streaming Gateway
    // 与当前前端 SSE 协议完全匹配
    // =========================================================

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");

        return res.status(405).json({
            success: false,
            error: `Method ${req.method} Not Allowed`
        });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        return res.status(500).json({
            success: false,
            error: "服务器未配置 DEEPSEEK_API_KEY"
        });
    }

    try {
        const body = req.body || {};

        const messages = body.messages;
        const conversationId =
            typeof body.conversationId === "string"
                ? body.conversationId
                : "";

        const requestedModel =
            typeof body.model === "string"
                ? body.model
                : "DeepSeek";

        // -----------------------------------------------------
        // 1. 基础请求验证
        // -----------------------------------------------------

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                error: "messages 必须是非空数组"
            });
        }

        if (messages.length > 50) {
            return res.status(400).json({
                success: false,
                error: "对话上下文过长，最多允许 50 条消息"
            });
        }

        // -----------------------------------------------------
        // 2. 当前版本真正调用 DeepSeek
        //
        // 前端虽然有 GPT / Claude / Gemini UI，
        // 但目前没有对应 API，因此不能假装已经接通。
        // -----------------------------------------------------

        const model = "deepseek-chat";

        // -----------------------------------------------------
        // 3. 清洗消息
        // -----------------------------------------------------

        const allowedRoles = new Set([
            "user",
            "assistant"
        ]);

        const cleanMessages = [];

        for (const message of messages) {
            if (!message || typeof message !== "object") {
                continue;
            }

            const role = message.role;
            const content = message.content;

            if (!allowedRoles.has(role)) {
                continue;
            }

            if (typeof content !== "string") {
                continue;
            }

            const cleanContent = content.trim();

            if (!cleanContent) {
                continue;
            }

            cleanMessages.push({
                role,
                content: cleanContent.substring(0, 12000)
            });
        }

        if (cleanMessages.length === 0) {
            return res.status(400).json({
                success: false,
                error: "没有合法的对话内容"
            });
        }

        // -----------------------------------------------------
        // 4. 限制总上下文大小
        // 防止前端 localStorage 历史无限增长
        // -----------------------------------------------------

        const MAX_CONTEXT_MESSAGES = 40;

        const finalMessages =
            cleanMessages.length > MAX_CONTEXT_MESSAGES
                ? cleanMessages.slice(-MAX_CONTEXT_MESSAGES)
                : cleanMessages;

        // -----------------------------------------------------
        // 5. SSE 响应头
        // -----------------------------------------------------

        res.statusCode = 200;

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");

        // Vercel / 代理环境下尽量避免缓冲
        res.setHeader("X-Accel-Buffering", "no");

        // CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

        // -----------------------------------------------------
        // 6. SSE 工具
        // -----------------------------------------------------

        const sendEvent = (payload) => {
            try {
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
            } catch (writeError) {
                console.error(
                    "[CQS AI SSE WRITE ERROR]",
                    writeError
                );
            }
        };

        // -----------------------------------------------------
        // 7. 告诉前端：AI 已开始工作
        // -----------------------------------------------------

        sendEvent({
            type: "status",
            status: "thinking",
            conversationId
        });

        // -----------------------------------------------------
        // 8. 请求 DeepSeek
        // -----------------------------------------------------

        const upstreamResponse = await fetch(
            "https://api.deepseek.com/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey.trim()}`
                },

                body: JSON.stringify({
                    model,
                    messages: finalMessages,

                    // 真正开启 DeepSeek 流式输出
                    stream: true,

                    // 控制输出长度
                    max_tokens: 4096
                })
            }
        );

        // -----------------------------------------------------
        // 9. DeepSeek 请求失败
        // -----------------------------------------------------

        if (!upstreamResponse.ok) {
            const errorText =
                await upstreamResponse.text();

            let errorMessage =
                `DeepSeek API 请求失败 (${upstreamResponse.status})`;

            try {
                const errorData =
                    JSON.parse(errorText);

                errorMessage =
                    errorData?.error?.message ||
                    errorData?.message ||
                    errorMessage;
            } catch {
                if (errorText) {
                    errorMessage = errorText.substring(0, 500);
                }
            }

            console.error(
                "[CQS AI DEEPSEEK ERROR]",
                upstreamResponse.status,
                errorMessage
            );

            sendEvent({
                type: "error",
                error: errorMessage
            });

            sendEvent({
                type: "done"
            });

            return res.end();
        }

        // -----------------------------------------------------
        // 10. DeepSeek 没有返回流
        // -----------------------------------------------------

        if (!upstreamResponse.body) {
            sendEvent({
                type: "error",
                error: "DeepSeek 没有返回流式数据"
            });

            sendEvent({
                type: "done"
            });

            return res.end();
        }

        // -----------------------------------------------------
        // 11. 读取 DeepSeek SSE
        // -----------------------------------------------------

        const reader =
            upstreamResponse.body.getReader();

        const decoder =
            new TextDecoder("utf-8");

        let buffer = "";
        let fullReply = "";

        let finalUsage = null;

        try {
            while (true) {
                const {
                    value,
                    done
                } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(
                    value,
                    { stream: true }
                );

                const events =
                    buffer.split(/\r?\n\r?\n/);

                buffer =
                    events.pop() || "";

                for (const event of events) {
                    const lines =
                        event.split(/\r?\n/);

                    for (const line of lines) {
                        if (!line.startsWith("data:")) {
                            continue;
                        }

                        const data =
                            line.slice(5).trim();

                        if (!data) {
                            continue;
                        }

                        // DeepSeek SSE 结束标志
                        if (data === "[DONE]") {
                            continue;
                        }

                        let packet;

                        try {
                            packet =
                                JSON.parse(data);
                        } catch {
                            continue;
                        }

                        // -------------------------------------------------
                        // DeepSeek 内容增量
                        // -------------------------------------------------

                        const delta =
                            packet?.choices?.[0]?.delta;

                        const content =
                            delta?.content;

                        if (
                            typeof content === "string" &&
                            content.length > 0
                        ) {
                            fullReply += content;

                            sendEvent({
                                type: "delta",
                                content
                            });
                        }

                        // -------------------------------------------------
                        // Usage
                        // -------------------------------------------------

                        if (packet?.usage) {
                            finalUsage =
                                packet.usage;
                        }
                    }
                }
            }

            // -----------------------------------------------------
            // 12. 处理最后残留 buffer
            // -----------------------------------------------------

            buffer +=
                decoder.decode();

            const remaining =
                buffer.trim();

            if (remaining) {
                const lines =
                    remaining.split(/\r?\n/);

                for (const line of lines) {
                    if (!line.startsWith("data:")) {
                        continue;
                    }

                    const data =
                        line.slice(5).trim();

                    if (
                        !data ||
                        data === "[DONE]"
                    ) {
                        continue;
                    }

                    try {
                        const packet =
                            JSON.parse(data);

                        const content =
                            packet?.choices?.[0]?.delta?.content;

                        if (
                            typeof content === "string" &&
                            content.length > 0
                        ) {
                            fullReply += content;

                            sendEvent({
                                type: "delta",
                                content
                            });
                        }

                        if (packet?.usage) {
                            finalUsage =
                                packet.usage;
                        }
                    } catch {
                        // 忽略不完整数据
                    }
                }
            }

        } finally {
            try {
                reader.releaseLock();
            } catch {
                // ignore
            }
        }

        // -----------------------------------------------------
        // 13. 如果没有内容
        // -----------------------------------------------------

        if (!fullReply.trim()) {
            sendEvent({
                type: "error",
                error: "DeepSeek 返回了空响应"
            });

            sendEvent({
                type: "done"
            });

            return res.end();
        }

        // -----------------------------------------------------
        // 14. 发送 Token Usage
        // -----------------------------------------------------

        if (finalUsage) {
            sendEvent({
                type: "usage",
                usage: {
                    prompt_tokens:
                        Number(
                            finalUsage.prompt_tokens || 0
                        ),

                    completion_tokens:
                        Number(
                            finalUsage.completion_tokens || 0
                        ),

                    total_tokens:
                        Number(
                            finalUsage.total_tokens || 0
                        )
                }
            });
        }

        // -----------------------------------------------------
        // 15. 正常结束
        // -----------------------------------------------------

        sendEvent({
            type: "done",
            conversationId,
            model: requestedModel,
            provider: "DeepSeek"
        });

        return res.end();

    } catch (error) {

        console.error(
            "[CQS AI Gateway Error]",
            error
        );

        // 如果 headers 已经发送，
        // 就不能再 res.status(...).json()
        // 必须继续使用 SSE。
        try {
            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    error: "服务器内部错误"
                });
            }

            res.write(
                `data: ${JSON.stringify({
                    type: "error",
                    error:
                        error?.message ||
                        "服务器内部错误"
                })}\n\n`
            );

            res.write(
                `data: ${JSON.stringify({
                    type: "done"
                })}\n\n`
            );

            return res.end();

        } catch (finalError) {

            console.error(
                "[CQS AI FINAL ERROR]",
                finalError
            );

            try {
                return res.end();
            } catch {
                return;
            }
        }
    }
}
