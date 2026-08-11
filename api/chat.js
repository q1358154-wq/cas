export default async function handler(req, res) {
    // =========================================================
    // CQS AI Global
    // DeepSeek V4 Secure Streaming Gateway
    // /api/chat.js
    // =========================================================

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            success: false,
            error: `Method ${req.method} Not Allowed`
        });
    }

    // ---------------------------------------------------------
    // Security Headers
    // ---------------------------------------------------------

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader(
        "Referrer-Policy",
        "strict-origin-when-cross-origin"
    );

    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        return res.status(500).json({
            success: false,
            error: "服务器未配置 DEEPSEEK_API_KEY"
        });
    }

    // ---------------------------------------------------------
    // Main
    // ---------------------------------------------------------

    try {
        const body = req.body || {};

        const messages = body.messages;
        const systemPrompt = body.systemPrompt;
        const conversationId = body.conversationId;

        // -----------------------------------------------------
        // Validate messages
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
        // Conversation ID
        // -----------------------------------------------------

        let safeConversationId = "";

        if (typeof conversationId === "string") {
            safeConversationId = conversationId
                .trim()
                .substring(0, 100);
        }

        // 防止变量未使用导致部分运行环境警告
        void safeConversationId;

        // -----------------------------------------------------
        // System Prompt
        // -----------------------------------------------------

        let cleanSystemPrompt = "";

        if (typeof systemPrompt === "string") {
            cleanSystemPrompt = systemPrompt.trim();

            if (cleanSystemPrompt.length > 20000) {
                return res.status(400).json({
                    success: false,
                    error: "System Prompt 过长，最大允许 20000 个字符"
                });
            }
        }

        // -----------------------------------------------------
        // Clean Messages
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
        // Final Messages
        // -----------------------------------------------------

        const finalMessages = [];

        if (cleanSystemPrompt) {
            finalMessages.push({
                role: "system",
                content: cleanSystemPrompt
            });
        }

        finalMessages.push(...cleanMessages);

        // -----------------------------------------------------
        // SSE Headers
        // -----------------------------------------------------

        res.statusCode = 200;

        res.setHeader(
            "Content-Type",
            "text/event-stream; charset=utf-8"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache, no-transform"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        res.setHeader(
            "X-Accel-Buffering",
            "no"
        );

        // -----------------------------------------------------
        // SSE State
        // -----------------------------------------------------

        let closed = false;

        // 先创建 Controller
        // 再注册 req.close，避免变量时序问题
        const upstreamController =
            new AbortController();

        const sendEvent = (payload) => {
            if (closed || res.writableEnded) {
                return;
            }

            try {
                res.write(
                    `data: ${JSON.stringify(payload)}\n\n`
                );
            } catch {
                closed = true;
            }
        };

        // -----------------------------------------------------
        // Client Disconnect
        // -----------------------------------------------------

        req.on("close", () => {
            closed = true;

            try {
                upstreamController.abort();
            } catch {}
        });

        // -----------------------------------------------------
        // Timeout
        // -----------------------------------------------------

        const timeout = setTimeout(() => {
            try {
                upstreamController.abort();
            } catch {}
        }, 120000);

        // -----------------------------------------------------
        // DeepSeek V4
        //
        // deepseek-v4-flash:
        // - 更快
        // - 更便宜
        // - 支持 Thinking
        //
        // deepseek-v4-pro:
        // - 更强
        // - 成本更高
        //
        // 这里默认使用 Flash
        // -----------------------------------------------------

        const model = "deepseek-v4-flash";

        let upstreamResponse;

        try {
            upstreamResponse = await fetch(
                "https://api.deepseek.com/chat/completions",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                        "Authorization":
                            `Bearer ${apiKey.trim()}`,
                        "Accept":
                            "text/event-stream"
                    },

                    body: JSON.stringify({
                        model,

                        messages: finalMessages,

                        // =================================================
                        // 开启 DeepSeek V4 Thinking
                        // =================================================

                        thinking: {
                            type: "enabled"
                        },

                        // 思考强度
                        reasoning_effort: "high",

                        // =================================================
                        // Streaming
                        // =================================================

                        stream: true,

                        // =================================================
                        // 最终返回 usage
                        // =================================================

                        stream_options: {
                            include_usage: true
                        }
                    }),

                    signal: upstreamController.signal
                }
            );
        } catch (error) {
            clearTimeout(timeout);

            if (error?.name === "AbortError") {
                if (!closed) {
                    sendEvent({
                        type: "error",
                        error: "AI 请求超时或已取消"
                    });

                    sendEvent({
                        type: "done"
                    });

                    try {
                        res.end();
                    } catch {}
                }

                return;
            }

            console.error(
                "[CQS DeepSeek Connection Error]",
                error
            );

            if (!closed) {
                sendEvent({
                    type: "error",
                    error: "无法连接 DeepSeek AI 服务"
                });

                sendEvent({
                    type: "done"
                });

                try {
                    res.end();
                } catch {}
            }

            return;
        }

        // ---------------------------------------------------------
        // DeepSeek HTTP Error
        // ---------------------------------------------------------

        if (!upstreamResponse.ok) {
            clearTimeout(timeout);

            let errorMessage =
                `DeepSeek API 请求失败 (${upstreamResponse.status})`;

            try {
                const errorText =
                    await upstreamResponse.text();

                if (errorText) {
                    try {
                        const errorData =
                            JSON.parse(errorText);

                        errorMessage =
                            errorData?.error?.message ||
                            errorData?.message ||
                            errorMessage;

                    } catch {
                        // 保留默认错误
                    }
                }
            } catch {}

            console.error(
                "[CQS DeepSeek HTTP Error]",
                upstreamResponse.status,
                errorMessage
            );

            if (!closed) {
                sendEvent({
                    type: "error",
                    error: errorMessage
                });

                sendEvent({
                    type: "done"
                });

                try {
                    res.end();
                } catch {}
            }

            return;
        }

        // ---------------------------------------------------------
        // Check Stream
        // ---------------------------------------------------------

        if (!upstreamResponse.body) {
            clearTimeout(timeout);

            if (!closed) {
                sendEvent({
                    type: "error",
                    error: "DeepSeek 没有返回流式数据"
                });

                sendEvent({
                    type: "done"
                });

                try {
                    res.end();
                } catch {}
            }

            return;
        }

        // ---------------------------------------------------------
        // Read DeepSeek SSE
        // ---------------------------------------------------------

        const reader =
            upstreamResponse.body.getReader();

        const decoder =
            new TextDecoder("utf-8");

        let buffer = "";
        let finished = false;

        try {
            while (!finished && !closed) {

                const {
                    value,
                    done
                } = await reader.read();

                if (done) {
                    break;
                }

                if (value) {
                    buffer += decoder.decode(
                        value,
                        {
                            stream: true
                        }
                    );
                }

                // -----------------------------------------------------
                // SSE events separated by blank line
                // -----------------------------------------------------

                const events =
                    buffer.split(/\r?\n\r?\n/);

                buffer =
                    events.pop() || "";

                for (const event of events) {

                    if (closed) {
                        break;
                    }

                    const lines =
                        event.split(/\r?\n/);

                    const dataLines =
                        lines
                            .filter(line =>
                                line.startsWith("data:")
                            )
                            .map(line =>
                                line
                                    .slice(5)
                                    .trim()
                            );

                    if (dataLines.length === 0) {
                        continue;
                    }

                    const data =
                        dataLines.join("\n");

                    if (!data) {
                        continue;
                    }

                    // -------------------------------------------------
                    // DeepSeek [DONE]
                    // -------------------------------------------------

                    if (data === "[DONE]") {
                        finished = true;
                        break;
                    }

                    let packet;

                    try {
                        packet =
                            JSON.parse(data);
                    } catch {
                        continue;
                    }

                    const choice =
                        packet?.choices?.[0];

                    const delta =
                        choice?.delta;

                    // =================================================
                    // THINKING / REASONING
                    // =================================================

                    if (
                        delta &&
                        typeof delta.reasoning_content === "string" &&
                        delta.reasoning_content.length > 0
                    ) {
                        sendEvent({
                            type: "reasoning",
                            content:
                                delta.reasoning_content
                        });
                    }

                    // =================================================
                    // FINAL ANSWER
                    // =================================================

                    if (
                        delta &&
                        typeof delta.content === "string" &&
                        delta.content.length > 0
                    ) {
                        sendEvent({
                            type: "delta",
                            content:
                                delta.content
                        });
                    }

                    // =================================================
                    // Usage
                    // =================================================

                    if (packet?.usage) {
                        sendEvent({
                            type: "usage",
                            usage: packet.usage
                        });
                    }
                }
            }

            // ---------------------------------------------------------
            // Flush remaining UTF-8 bytes
            // ---------------------------------------------------------

            buffer += decoder.decode();

            // ---------------------------------------------------------
            // Process remaining SSE event
            // ---------------------------------------------------------

            if (!closed && buffer.trim()) {

                const events =
                    buffer.split(/\r?\n\r?\n/);

                for (const event of events) {

                    const lines =
                        event.split(/\r?\n/);

                    const dataLines =
                        lines
                            .filter(line =>
                                line.startsWith("data:")
                            )
                            .map(line =>
                                line
                                    .slice(5)
                                    .trim()
                            );

                    if (dataLines.length === 0) {
                        continue;
                    }

                    const data =
                        dataLines.join("\n");

                    if (!data || data === "[DONE]") {
                        continue;
                    }

                    try {
                        const packet =
                            JSON.parse(data);

                        const choice =
                            packet?.choices?.[0];

                        const delta =
                            choice?.delta;

                        // reasoning
                        if (
                            delta &&
                            typeof delta.reasoning_content === "string" &&
                            delta.reasoning_content.length > 0
                        ) {
                            sendEvent({
                                type: "reasoning",
                                content:
                                    delta.reasoning_content
                            });
                        }

                        // answer
                        if (
                            delta &&
                            typeof delta.content === "string" &&
                            delta.content.length > 0
                        ) {
                            sendEvent({
                                type: "delta",
                                content:
                                    delta.content
                            });
                        }

                        // usage
                        if (packet?.usage) {
                            sendEvent({
                                type: "usage",
                                usage: packet.usage
                            });
                        }

                    } catch {
                        // 忽略无法解析的残留数据
                    }
                }
            }

            // ---------------------------------------------------------
            // Normal Finish
            // ---------------------------------------------------------

            if (!closed) {
                sendEvent({
                    type: "done"
                });
            }

        } catch (error) {

            console.error(
                "[CQS AI Stream Error]",
                error
            );

            if (!closed) {

                sendEvent({
                    type: "error",
                    error:
                        error?.name === "AbortError"
                            ? "AI 请求已取消"
                            : "AI 流式传输发生错误"
                });

                sendEvent({
                    type: "done"
                });
            }

        } finally {

            clearTimeout(timeout);

            try {
                reader.releaseLock();
            } catch {}

            if (!closed) {
                try {
                    res.end();
                } catch {}
            }
        }

    } catch (error) {

        console.error(
            "[CQS AI Gateway Error]",
            error
        );

        // ---------------------------------------------------------
        // SSE already started
        // ---------------------------------------------------------

        if (res.headersSent) {

            try {

                res.write(
                    `data: ${JSON.stringify({
                        type: "error",
                        error: "服务器内部错误"
                    })}\n\n`
                );

                res.write(
                    `data: ${JSON.stringify({
                        type: "done"
                    })}\n\n`
                );

                res.end();

            } catch {}

            return;
        }

        // ---------------------------------------------------------
        // Normal JSON error
        // ---------------------------------------------------------

        return res.status(500).json({
            success: false,
            error: "服务器内部错误"
        });
    }
}