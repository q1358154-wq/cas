export default async function handler(req, res) {
    // =========================================================
    // CQS AI Global
    // DeepSeek Secure Streaming Gateway
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
    // 基础安全响应头
    // ---------------------------------------------------------
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || !apiKey.trim()) {
        return res.status(500).json({
            success: false,
            error: "服务器未配置 DEEPSEEK_API_KEY"
        });
    }
    // ---------------------------------------------------------
    // 读取请求
    // ---------------------------------------------------------
    try {
        const body = req.body || {};
        const messages = body.messages;
        const systemPrompt = body.systemPrompt;
        const conversationId = body.conversationId;
        // -----------------------------------------------------
        // messages 基础验证
        // -----------------------------------------------------
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                error: "messages 必须是非空数组"
            });
        }
        // 防止无限增长
        if (messages.length > 50) {
            return res.status(400).json({
                success: false,
                error: "对话上下文过长，最多允许 50 条消息"
            });
        }
        // -----------------------------------------------------
        // conversationId 只用于识别，不作为系统指令
        // -----------------------------------------------------
        let safeConversationId = "";
        if (typeof conversationId === "string") {
            safeConversationId = conversationId
                .trim()
                .substring(0, 100);
        }
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
        // 清理消息
        //
        // 前端只允许：
        // user
        // assistant
        //
        // system 不允许由普通 messages 注入。
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
        // 最终发送给 DeepSeek 的消息
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
        // 某些代理/CDN 不应该缓冲 SSE
        res.setHeader(
            "X-Accel-Buffering",
            "no"
        );
        // -----------------------------------------------------
        // SSE 工具
        // -----------------------------------------------------
        let closed = false;
        const sendEvent = (payload) => {
            if (closed || res.writableEnded) {
                return;
            }
            try {
                res.write(
                    `data: ${JSON.stringify(payload)}\n\n`
                );
            } catch (error) {
                closed = true;
            }
        };
        // -----------------------------------------------------
        // 客户端断开连接
        // -----------------------------------------------------
        req.on("close", () => {
            closed = true;
            if (upstreamController) {
                try {
                    upstreamController.abort();
                } catch {}
            }
        });
        // -----------------------------------------------------
        // DeepSeek 请求控制器
        // -----------------------------------------------------
        const upstreamController = new AbortController();
        // 120 秒超时
        const timeout = setTimeout(() => {
            try {
                upstreamController.abort();
            } catch {}
        }, 120000);
        // -----------------------------------------------------
        // 调用 DeepSeek
        // -----------------------------------------------------
        let upstreamResponse;
        try {
            upstreamResponse = await fetch(
                "https://api.deepseek.com/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey.trim()}`,
                        "Accept": "text/event-stream"
                    },
                    body: JSON.stringify({
                        model: "deepseek-chat",
                        messages: finalMessages,
                        stream: true,
                        // 要求 API 返回最终 usage
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
        // -----------------------------------------------------
        // DeepSeek HTTP 错误
        // -----------------------------------------------------
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
        // -----------------------------------------------------
        // 检查流
        // -----------------------------------------------------
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
        // -----------------------------------------------------
        // 读取 DeepSeek SSE
        // -----------------------------------------------------
        const reader =
            upstreamResponse.body.getReader();
        const decoder =
            new TextDecoder("utf-8");
        let buffer = "";
        let finished = false;
        try {
            while (!finished && !closed) {
                const { value, done } =
                    await reader.read();
                if (done) {
                    break;
                }
                if (value) {
                    buffer += decoder.decode(
                        value,
                        { stream: true }
                    );
                }
                // DeepSeek SSE 使用空行分隔事件
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
                    // DeepSeek 结束标记
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
                    // -------------------------------------------------
                    // DeepSeek 正常 delta
                    // -------------------------------------------------
                    const choice =
                        packet?.choices?.[0];
                    const delta =
                        choice?.delta;
                    // 普通回答内容
                    if (
                        delta &&
                        typeof delta.content === "string" &&
                        delta.content.length > 0
                    ) {
                        sendEvent({
                            type: "delta",
                            content: delta.content
                        });
                    }
                    // -------------------------------------------------
                    // 如果未来模型/API返回 reasoning_content
                    // -------------------------------------------------
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
                    // -------------------------------------------------
                    // usage
                    // -------------------------------------------------
                    if (packet?.usage) {
                        sendEvent({
                            type: "usage",
                            usage: packet.usage
                        });
                    }
                    // -------------------------------------------------
                    // finish_reason
                    // -------------------------------------------------
                    if (
                        choice &&
                        choice.finish_reason
                    ) {
                        // 不立即结束。
                        // 等待 [DONE] 或 stream 结束。
                    }
                }
            }
            // ---------------------------------------------------------
            // 处理最后残留 buffer
            // ---------------------------------------------------------
            if (!closed && buffer.trim()) {
                const lines =
                    buffer.split(/\r?\n/);
                const dataLines =
                    lines
                        .filter(line =>
                            line.startsWith("data:")
                        )
                        .map(line =>
                            line.slice(5).trim()
                        );
                if (dataLines.length > 0) {
                    const data =
                        dataLines.join("\n");
                    if (data !== "[DONE]") {
                        try {
                            const packet =
                                JSON.parse(data);
                            const choice =
                                packet?.choices?.[0];
                            const delta =
                                choice?.delta;
                            if (
                                delta &&
                                typeof delta.content === "string"
                            ) {
                                sendEvent({
                                    type: "delta",
                                    content:
                                        delta.content
                                });
                            }
                            if (
                                delta &&
                                typeof delta.reasoning_content === "string"
                            ) {
                                sendEvent({
                                    type: "reasoning",
                                    content:
                                        delta.reasoning_content
                                });
                            }
                            if (packet?.usage) {
                                sendEvent({
                                    type: "usage",
                                    usage: packet.usage
                                });
                            }
                        } catch {}
                    }
                }
            }
            // ---------------------------------------------------------
            // 正常结束
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
        // 如果 SSE 已经开始，
        // 不能再返回普通 JSON。
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
        return res.status(500).json({
            success: false,
            error: "服务器内部错误"
        });
    }
}