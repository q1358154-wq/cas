export default async function handler(req, res) {
    "use strict";
    // =========================================================
    // CQS AI Global
    // Secure DeepSeek Streaming Gateway
    // File: api/chat.js
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
    // ---------------------------------------------------------
    // 基础安全 Header
    // ---------------------------------------------------------
    res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
    );
    res.setHeader(
        "X-Frame-Options",
        "SAMEORIGIN"
    );
    res.setHeader(
        "Referrer-Policy",
        "strict-origin-when-cross-origin"
    );
    let upstreamController = null;
    let clientClosed = false;
    try {
        const body = req.body || {};
        const messages = body.messages;
        const systemPrompt = body.systemPrompt;
        const conversationId = body.conversationId;
        // =====================================================
        // 参数验证
        // =====================================================
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
        // =====================================================
        // Conversation ID
        // =====================================================
        let safeConversationId = "";
        if (typeof conversationId === "string") {
            safeConversationId =
                conversationId
                    .trim()
                    .substring(0, 100);
        }
        // 防止未使用变量被误解
        void safeConversationId;
        // =====================================================
        // System Prompt
        // =====================================================
        let cleanSystemPrompt = "";
        if (typeof systemPrompt === "string") {
            cleanSystemPrompt =
                systemPrompt.trim();
            if (cleanSystemPrompt.length > 20000) {
                return res.status(400).json({
                    success: false,
                    error: "System Prompt 过长，最大允许 20000 个字符"
                });
            }
        }
        // =====================================================
        // 清洗 Messages
        // =====================================================
        const allowedRoles =
            new Set([
                "user",
                "assistant"
            ]);
        const cleanMessages = [];
        for (const message of messages) {
            if (
                !message ||
                typeof message !== "object"
            ) {
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
            const cleanContent =
                content.trim();
            if (!cleanContent) {
                continue;
            }
            cleanMessages.push({
                role,
                content:
                    cleanContent.substring(0, 12000)
            });
        }
        if (cleanMessages.length === 0) {
            return res.status(400).json({
                success: false,
                error: "没有合法的对话内容"
            });
        }
        // =====================================================
        // 最终 Messages
        // =====================================================
        const finalMessages = [];
        if (cleanSystemPrompt) {
            finalMessages.push({
                role: "system",
                content: cleanSystemPrompt
            });
        }
        finalMessages.push(
            ...cleanMessages
        );
        // =====================================================
        // SSE Headers
        // =====================================================
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
        // =====================================================
        // SSE Sender
        // =====================================================
        const sendEvent = payload => {
            if (
                clientClosed ||
                res.writableEnded
            ) {
                return;
            }
            try {
                res.write(
                    `data: ${JSON.stringify(payload)}\n\n`
                );
            } catch (error) {
                clientClosed = true;
            }
        };
        // =====================================================
        // 客户端断开
        // =====================================================
        req.on("close", () => {
            clientClosed = true;
            if (upstreamController) {
                try {
                    upstreamController.abort();
                } catch {}
            }
        });
        // =====================================================
        // DeepSeek Controller
        // =====================================================
        upstreamController =
            new AbortController();
        const timeout =
            setTimeout(() => {
                try {
                    upstreamController.abort();
                } catch {}
            }, 120000);
        // =====================================================
        // DeepSeek API
        // =====================================================
        let upstreamResponse;
        try {
            upstreamResponse =
                await fetch(
                    "https://api.deepseek.com/chat/completions",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json",
                            "Authorization":
                                `Bearer ${apiKey.trim()}`,
                            "Accept":
                                "text/event-stream"
                        },
                        body: JSON.stringify({
                            /*
                             * 这里使用 DeepSeek Reasoner。
                             *
                             * 如果你的账户/API环境不支持，
                             * 可以改成：
                             *
                             * deepseek-chat
                             */
                            model:
                                "deepseek-reasoner",
                            messages:
                                finalMessages,
                            stream: true,
                            stream_options: {
                                include_usage: true
                            }
                        }),
                        signal:
                            upstreamController.signal
                    }
                );
        } catch (error) {
            clearTimeout(timeout);
            if (!clientClosed) {
                sendEvent({
                    type: "error",
                    error:
                        error?.name === "AbortError"
                            ? "AI 请求已取消或超时"
                            : "无法连接 DeepSeek AI 服务"
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
        // =====================================================
        // HTTP Error
        // =====================================================
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
                    } catch {}
                }
            } catch {}
            if (!clientClosed) {
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
        // =====================================================
        // Stream 检查
        // =====================================================
        if (!upstreamResponse.body) {
            clearTimeout(timeout);
            if (!clientClosed) {
                sendEvent({
                    type: "error",
                    error:
                        "DeepSeek 没有返回流式数据"
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
        // =====================================================
        // 读取 Stream
        // =====================================================
        const reader =
            upstreamResponse.body.getReader();
        const decoder =
            new TextDecoder("utf-8");
        let buffer = "";
        let finished = false;
        try {
            while (
                !finished &&
                !clientClosed
            ) {
                const {
                    value,
                    done
                } = await reader.read();
                if (done) {
                    break;
                }
                if (value) {
                    buffer +=
                        decoder.decode(
                            value,
                            {
                                stream: true
                            }
                        );
                }
                const events =
                    buffer.split(
                        /\r?\n\r?\n/
                    );
                buffer =
                    events.pop() || "";
                for (const event of events) {
                    if (clientClosed) {
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
                    if (
                        dataLines.length === 0
                    ) {
                        continue;
                    }
                    const data =
                        dataLines.join("\n");
                    if (!data) {
                        continue;
                    }
                    // DeepSeek 结束
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
                    // 思考内容
                    // =================================================
                    if (
                        delta &&
                        typeof
                            delta.reasoning_content
                            === "string" &&
                        delta.reasoning_content.length
                    ) {
                        sendEvent({
                            type:
                                "reasoning",
                            content:
                                delta.reasoning_content
                        });
                    }
                    // =================================================
                    // 最终答案
                    // =================================================
                    if (
                        delta &&
                        typeof
                            delta.content
                            === "string" &&
                        delta.content.length
                    ) {
                        sendEvent({
                            type:
                                "delta",
                            content:
                                delta.content
                        });
                    }
                    // =================================================
                    // Token Usage
                    // =================================================
                    if (packet?.usage) {
                        sendEvent({
                            type:
                                "usage",
                            usage:
                                packet.usage
                        });
                    }
                }
            }
            // =====================================================
            // Flush Decoder
            // =====================================================
            buffer +=
                decoder.decode();
            // =====================================================
            // 最后一个残留 SSE
            // =====================================================
            if (
                !clientClosed &&
                buffer.trim()
            ) {
                const lines =
                    buffer.split(/\r?\n/);
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
                if (dataLines.length) {
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
                                typeof
                                    delta.reasoning_content
                                    === "string"
                            ) {
                                sendEvent({
                                    type:
                                        "reasoning",
                                    content:
                                        delta.reasoning_content
                                });
                            }
                            if (
                                delta &&
                                typeof
                                    delta.content
                                    === "string"
                            ) {
                                sendEvent({
                                    type:
                                        "delta",
                                    content:
                                        delta.content
                                });
                            }
                            if (packet?.usage) {
                                sendEvent({
                                    type:
                                        "usage",
                                    usage:
                                        packet.usage
                                });
                            }
                        } catch {}
                    }
                }
            }
            // =====================================================
            // Done
            // =====================================================
            if (!clientClosed) {
                sendEvent({
                    type:
                        "done"
                });
            }
        } catch (error) {
            console.error(
                "[CQS AI Stream Error]",
                error
            );
            if (!clientClosed) {
                sendEvent({
                    type:
                        "error",
                    error:
                        error?.name === "AbortError"
                            ? "AI 请求已取消"
                            : "AI 流式传输发生错误"
                });
                sendEvent({
                    type:
                        "done"
                });
            }
        } finally {
            clearTimeout(timeout);
            try {
                reader.releaseLock();
            } catch {}
            if (!clientClosed) {
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
        if (res.headersSent) {
            try {
                res.write(
                    `data: ${JSON.stringify({
                        type:
                            "error",
                        error:
                            "服务器内部错误"
                    })}\n\n`
                );
                res.write(
                    `data: ${JSON.stringify({
                        type:
                            "done"
                    })}\n\n`
                );
                res.end();
            } catch {}
            return;
        }
        return res.status(500).json({
            success: false,
            error:
                "服务器内部错误"
        });
    }
}