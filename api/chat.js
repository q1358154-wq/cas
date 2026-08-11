export default async function handler(req, res) {
    // ================================
    // CQS AI Global
    // DeepSeek SSE Gateway
    // ================================
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            success: false,
            error: `Method ${req.method} Not Allowed`
        });
    }
    // -------------------------------
    // 基础安全响应头
    // -------------------------------
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // -------------------------------
    // API Key
    // -------------------------------
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || !apiKey.trim()) {
        return res.status(500).json({
            success: false,
            error: "服务器未配置 DEEPSEEK_API_KEY"
        });
    }
    try {
        // -------------------------------
        // 读取请求
        // -------------------------------
        const body = req.body || {};
        const messages = body.messages;
        const conversationId =
            typeof body.conversationId === "string"
                ? body.conversationId.trim()
                : "";
        const requestedModel =
            typeof body.model === "string"
                ? body.model.trim()
                : "DeepSeek";
        const attachments = Array.isArray(body.attachments)
            ? body.attachments
            : [];
        // -------------------------------
        // messages 校验
        // -------------------------------
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
        // -------------------------------
        // 清洗 messages
        // -------------------------------
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
        // -------------------------------
        // 限制附件数量
        // -------------------------------
        const cleanAttachments = attachments
            .filter(item =>
                item &&
                typeof item === "object" &&
                typeof item.name === "string"
            )
            .slice(0, 10)
            .map(item => ({
                name: item.name.substring(0, 200),
                size: Number.isFinite(item.size)
                    ? Math.max(0, Math.floor(item.size))
                    : 0,
                type:
                    typeof item.type === "string"
                        ? item.type.substring(0, 100)
                        : ""
            }));
        // -------------------------------
        // 模型映射
        //
        // 目前真正连接的是 DeepSeek。
        // 前端 GPT / Claude / Gemini
        // 暂时只作为 UI 选择项。
        // -------------------------------
        const modelMap = {
            "DeepSeek": "deepseek-chat"
        };
        const deepseekModel =
            modelMap[requestedModel] || "deepseek-chat";
        // -------------------------------
        // SSE 初始化
        // -------------------------------
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
        // Vercel / 部分代理环境
        res.setHeader(
            "X-Accel-Buffering",
            "no"
        );
        // -------------------------------
        // SSE 工具函数
        // -------------------------------
        const sendEvent = payload => {
            try {
                res.write(
                    `data: ${JSON.stringify(payload)}\n\n`
                );
            } catch (error) {
                console.error(
                    "[CQS SSE Write Error]",
                    error
                );
            }
        };
        // -------------------------------
        // 告诉前端 Gateway 已连接
        // -------------------------------
        sendEvent({
            type: "status",
            status: "connected",
            conversationId: conversationId || null,
            model: deepseekModel
        });
        // -------------------------------
        // 构造发送给 DeepSeek 的消息
        // -------------------------------
        const finalMessages = [
            ...cleanMessages
        ];
        // 如果前端有附件，
        // 当前版本先把附件元数据作为上下文提示。
        //
        // 注意：
        // 当前前端没有上传文件二进制内容，
        // 所以 DeepSeek 暂时无法读取文件本身。
        //
        if (cleanAttachments.length > 0) {
            const attachmentInfo =
                cleanAttachments
                    .map(file =>
                        `- ${file.name} (${file.type || "unknown"}, ${file.size} bytes)`
                    )
                    .join("\n");
            finalMessages.push({
                role: "user",
                content:
                    `用户本次请求附带以下文件信息：\n${attachmentInfo}\n\n` +
                    `注意：当前网关只收到文件元数据，没有收到文件二进制内容。`
            });
        }
        // -------------------------------
        // 调用 DeepSeek
        // -------------------------------
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, 120000);
        let upstreamResponse;
        try {
            upstreamResponse = await fetch(
                "https://api.deepseek.com/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization":
                            `Bearer ${apiKey.trim()}`
                    },
                    body: JSON.stringify({
                        model: deepseekModel,
                        messages: finalMessages,
                        stream: true,
                        temperature: 0.7,
                        max_tokens: 4096
                    }),
                    signal: controller.signal
                }
            );
        } finally {
            clearTimeout(timeout);
        }
        // -------------------------------
        // DeepSeek HTTP 错误
        // -------------------------------
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
                    errorMessage =
                        errorText.substring(0, 500);
                }
            }
            sendEvent({
                type: "error",
                error: errorMessage
            });
            sendEvent({
                type: "done"
            });
            return res.end();
        }
        // -------------------------------
        // 检查流
        // -------------------------------
        if (!upstreamResponse.body) {
            sendEvent({
                type: "error",
                error: "DeepSeek 没有返回可读取的数据流"
            });
            sendEvent({
                type: "done"
            });
            return res.end();
        }
        // -------------------------------
        // 读取 DeepSeek SSE
        // -------------------------------
        const reader =
            upstreamResponse.body.getReader();
        const decoder =
            new TextDecoder("utf-8");
        let buffer = "";
        let totalUsage = null;
        let hasContent = false;
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
                    {
                        stream: true
                    }
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
                        // DeepSeek SSE 结束标记
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
                        // -----------------------
                        // 内容增量
                        // -----------------------
                        const delta =
                            packet?.choices?.[0]?.delta;
                        const content =
                            delta?.content;
                        if (
                            typeof content ===
                            "string" &&
                            content.length > 0
                        ) {
                            hasContent = true;
                            sendEvent({
                                type: "delta",
                                content
                            });
                        }
                        // -----------------------
                        // usage
                        // -----------------------
                        if (packet?.usage) {
                            totalUsage =
                                packet.usage;
                        }
                    }
                }
            }
            // 处理最后残留数据
            buffer += decoder.decode();
            const finalEvents =
                buffer.split(/\r?\n\r?\n/);
            for (const event of finalEvents) {
                const lines =
                    event.split(/\r?\n/);
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
                        if (packet?.usage) {
                            totalUsage =
                                packet.usage;
                        }
                        const content =
                            packet?.choices?.[0]
                                ?.delta
                                ?.content;
                        if (
                            typeof content ===
                            "string" &&
                            content.length > 0
                        ) {
                            hasContent = true;
                            sendEvent({
                                type: "delta",
                                content
                            });
                        }
                    } catch {
                        // 忽略无法解析的最后数据
                    }
                }
            }
        } catch (streamError) {
            console.error(
                "[CQS DeepSeek Stream Error]",
                streamError
            );
            sendEvent({
                type: "error",
                error:
                    streamError?.name ===
                    "AbortError"
                        ? "DeepSeek 请求超时"
                        : "DeepSeek 流式连接中断"
            });
            return res.end();
        } finally {
            try {
                reader.releaseLock();
            } catch {}
        }
        // -------------------------------
        // 没有内容
        // -------------------------------
        if (!hasContent) {
            sendEvent({
                type: "error",
                error: "DeepSeek 返回了空响应"
            });
        }
        // -------------------------------
        // Token 使用量
        // -------------------------------
        if (totalUsage) {
            sendEvent({
                type: "usage",
                usage: {
                    prompt_tokens:
                        Number(
                            totalUsage.prompt_tokens ||
                            0
                        ),
                    completion_tokens:
                        Number(
                            totalUsage.completion_tokens ||
                            0
                        ),
                    total_tokens:
                        Number(
                            totalUsage.total_tokens ||
                            0
                        )
                }
            });
        }
        // -------------------------------
        // 完成
        // -------------------------------
        sendEvent({
            type: "done"
        });
        return res.end();
    } catch (error) {
        console.error(
            "[CQS AI Gateway Error]",
            error
        );
        // 如果 SSE 尚未建立
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                error: "服务器内部错误",
                detail:
                    error?.message ||
                    "Unknown error"
            });
        }
        // 如果已经进入 SSE
        try {
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
        } catch {
            return res.end();
        }
    }
}