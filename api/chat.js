// =========================================================
// CQS AI GLOBAL
// Multi-Provider Secure Streaming Gateway
// /api/chat.js
//
// Providers:
// 1. DeepSeek  - 当前真实使用
// 2. Still     - 预留 / 可配置
// 3. Agent     - 预留 / 可配置
//
// Environment Variables:
//
// DEEPSEEK_API_KEY
//
// STILL_API_URL
// STILL_API_KEY
// STILL_MODEL
//
// AGENT_API_URL
// AGENT_API_KEY
// AGENT_MODEL
//
// =========================================================

export default async function handler(req, res) {

    // =========================================================
    // METHOD
    // =========================================================

    if (req.method !== "POST") {

        res.setHeader(
            "Allow",
            "POST"
        );

        return res.status(405).json({
            success: false,
            error:
                `Method ${req.method} Not Allowed`
        });

    }


    // =========================================================
    // SECURITY HEADERS
    // =========================================================

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


    // =========================================================
    // REQUEST BODY
    // =========================================================

    try {

        const body =
            req.body || {};


        // =====================================================
        // PROVIDER
        //
        // 默认 DeepSeek
        //
        // 前端未来发送：
        //
        // provider: "deepseek"
        // provider: "still"
        // provider: "agent"
        // =====================================================

        const provider =
            typeof body.provider === "string"
                ? body.provider
                    .trim()
                    .toLowerCase()
                : "deepseek";


        const allowedProviders = new Set([
            "deepseek",
            "still",
            "agent"
        ]);


        if (
            !allowedProviders.has(
                provider
            )
        ) {

            return res.status(400).json({

                success: false,

                error:
                    `不支持的 Provider: ${provider}`

            });

        }


        // =====================================================
        // INPUT
        // =====================================================

        const messages =
            body.messages;

        const systemPrompt =
            body.systemPrompt;

        const conversationId =
            body.conversationId;


        // =====================================================
        // VALIDATE MESSAGES
        // =====================================================

        if (
            !Array.isArray(messages) ||
            messages.length === 0
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "messages 必须是非空数组"

            });

        }


        if (
            messages.length > 50
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "对话上下文过长，最多允许 50 条消息"

            });

        }


        // =====================================================
        // CONVERSATION ID
        // =====================================================

        let safeConversationId = "";

        if (
            typeof conversationId === "string"
        ) {

            safeConversationId =
                conversationId
                    .trim()
                    .substring(
                        0,
                        100
                    );

        }

        // 防止部分运行环境产生未使用变量警告
        void safeConversationId;


        // =====================================================
        // SYSTEM PROMPT
        // =====================================================

        let cleanSystemPrompt = "";

        if (
            typeof systemPrompt === "string"
        ) {

            cleanSystemPrompt =
                systemPrompt.trim();

            if (
                cleanSystemPrompt.length >
                20000
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "System Prompt 过长，最大允许 20000 个字符"

                });

            }

        }


        // =====================================================
        // CLEAN MESSAGES
        // =====================================================

        const allowedRoles =
            new Set([
                "user",
                "assistant"
            ]);

        const cleanMessages = [];


        for (
            const message
            of messages
        ) {

            if (
                !message ||
                typeof message !== "object"
            ) {
                continue;
            }


            const role =
                message.role;

            const content =
                message.content;


            if (
                !allowedRoles.has(
                    role
                )
            ) {
                continue;
            }


            if (
                typeof content !== "string"
            ) {
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
                    cleanContent.substring(
                        0,
                        12000
                    )

            });

        }


        if (
            cleanMessages.length === 0
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "没有合法的对话内容"

            });

        }


        // =====================================================
        // FINAL MESSAGES
        // =====================================================

        const finalMessages = [];


        if (
            cleanSystemPrompt
        ) {

            finalMessages.push({

                role: "system",

                content:
                    cleanSystemPrompt

            });

        }


        finalMessages.push(
            ...cleanMessages
        );


        // =====================================================
        // PROVIDER CONFIGURATION
        // =====================================================

        let providerConfig;


        // =====================================================
        // DEEPSEEK
        // =====================================================

        if (
            provider === "deepseek"
        ) {

            const apiKey =
                process.env.DEEPSEEK_API_KEY;


            if (
                !apiKey ||
                !apiKey.trim()
            ) {

                return res.status(500).json({

                    success: false,

                    error:
                        "服务器未配置 DEEPSEEK_API_KEY"

                });

            }


            providerConfig = {

                name: "DeepSeek",

                url:
                    "https://api.deepseek.com/chat/completions",

                apiKey:
                    apiKey.trim(),

                model:
                    "deepseek-v4-flash",

                thinking:
                    true,

                reasoningEffort:
                    "high"

            };

        }


        // =====================================================
        // STILL
        //
        // 未来只需要在 Vercel 配置：
        //
        // STILL_API_URL
        // STILL_API_KEY
        // STILL_MODEL
        //
        // 当前没有配置时不会假装调用。
        // =====================================================

        if (
            provider === "still"
        ) {

            const apiUrl =
                process.env.STILL_API_URL;

            const apiKey =
                process.env.STILL_API_KEY;

            const model =
                process.env.STILL_MODEL ||
                "default";


            if (
                !apiUrl ||
                !apiUrl.trim()
            ) {

                return res.status(503).json({

                    success: false,

                    provider: "still",

                    error:
                        "Still Provider 尚未配置 STILL_API_URL"

                });

            }


            if (
                !apiKey ||
                !apiKey.trim()
            ) {

                return res.status(503).json({

                    success: false,

                    provider: "still",

                    error:
                        "Still Provider 尚未配置 STILL_API_KEY"

                });

            }


            providerConfig = {

                name: "Still",

                url:
                    apiUrl.trim(),

                apiKey:
                    apiKey.trim(),

                model,

                thinking:
                    false,

                reasoningEffort:
                    null

            };

        }


        // =====================================================
        // AGENT
        //
        // 未来只需要在 Vercel 配置：
        //
        // AGENT_API_URL
        // AGENT_API_KEY
        // AGENT_MODEL
        //
        // =====================================================

        if (
            provider === "agent"
        ) {

            const apiUrl =
                process.env.AGENT_API_URL;

            const apiKey =
                process.env.AGENT_API_KEY;

            const model =
                process.env.AGENT_MODEL ||
                "default";


            if (
                !apiUrl ||
                !apiUrl.trim()
            ) {

                return res.status(503).json({

                    success: false,

                    provider: "agent",

                    error:
                        "Agent Provider 尚未配置 AGENT_API_URL"

                });

            }


            if (
                !apiKey ||
                !apiKey.trim()
            ) {

                return res.status(503).json({

                    success: false,

                    provider: "agent",

                    error:
                        "Agent Provider 尚未配置 AGENT_API_KEY"

                });

            }


            providerConfig = {

                name: "Agent",

                url:
                    apiUrl.trim(),

                apiKey:
                    apiKey.trim(),

                model,

                thinking:
                    false,

                reasoningEffort:
                    null

            };

        }


        // =====================================================
        // SAFETY CHECK
        // =====================================================

        if (!providerConfig) {

            return res.status(500).json({

                success: false,

                error:
                    "Provider 配置初始化失败"

            });

        }


        // =====================================================
        // SSE HEADERS
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
        // SSE STATE
        // =====================================================

        let closed = false;

        let finished = false;


        const upstreamController =
            new AbortController();


        // =====================================================
        // SEND SSE EVENT
        // =====================================================

        const sendEvent = (
            payload
        ) => {

            if (
                closed ||
                res.writableEnded
            ) {
                return;
            }


            try {

                res.write(
                    `data: ${JSON.stringify(
                        payload
                    )}\n\n`
                );

            } catch {

                closed = true;

            }

        };


        // =====================================================
        // CLIENT DISCONNECT
        // =====================================================

        req.on(
            "close",
            () => {

                closed = true;

                try {

                    upstreamController.abort();

                } catch {}

            }
        );


        // =====================================================
        // TIMEOUT
        // =====================================================

        const timeout =
            setTimeout(
                () => {

                    try {

                        upstreamController.abort();

                    } catch {}

                },
                120000
            );


        // =====================================================
        // BUILD UPSTREAM REQUEST
        // =====================================================

        const upstreamBody = {

            model:
                providerConfig.model,

            messages:
                finalMessages,

            stream:
                true

        };


        // =====================================================
        // DEEPSEEK THINKING
        //
        // 只有 DeepSeek 使用当前 Thinking 参数。
        //
        // Still / Agent 暂时不强行添加 DeepSeek 专属参数。
        // =====================================================

        if (
            provider === "deepseek"
        ) {

            upstreamBody.thinking = {

                type: "enabled"

            };


            upstreamBody.reasoning_effort =
                "high";


            upstreamBody.stream_options = {

                include_usage:
                    true

            };

        }


        // =====================================================
        // PROVIDER REQUEST
        // =====================================================

        let upstreamResponse;


        try {

            upstreamResponse =
                await fetch(
                    providerConfig.url,
                    {

                        method:
                            "POST",

                        headers: {

                            "Content-Type":
                                "application/json",

                            "Authorization":
                                `Bearer ${
                                    providerConfig.apiKey
                                }`,

                            "Accept":
                                "text/event-stream"

                        },

                        body:
                            JSON.stringify(
                                upstreamBody
                            ),

                        signal:
                            upstreamController
                                .signal

                    }
                );

        } catch (error) {

            clearTimeout(
                timeout
            );


            if (
                error?.name ===
                "AbortError"
            ) {

                if (!closed) {

                    sendEvent({

                        type:
                            "error",

                        error:
                            "AI 请求超时或已取消"

                    });


                    sendEvent({

                        type:
                            "done"

                    });


                    try {

                        res.end();

                    } catch {}

                }

                return;

            }


            console.error(
                `[CQS ${providerConfig.name} Connection Error]`,
                error
            );


            if (!closed) {

                sendEvent({

                    type:
                        "error",

                    error:
                        `无法连接 ${providerConfig.name} AI 服务`

                });


                sendEvent({

                    type:
                        "done"

                });


                try {

                    res.end();

                } catch {}

            }

            return;

        }


        // =====================================================
        // PROVIDER HTTP ERROR
        // =====================================================

        if (
            !upstreamResponse.ok
        ) {

            clearTimeout(
                timeout
            );


            let errorMessage =
                `${providerConfig.name} API 请求失败 (${upstreamResponse.status})`;


            try {

                const errorText =
                    await upstreamResponse.text();


                if (
                    errorText
                ) {

                    try {

                        const errorData =
                            JSON.parse(
                                errorText
                            );


                        errorMessage =
                            errorData?.error?.message ||
                            errorData?.error ||
                            errorData?.message ||
                            errorMessage;

                    } catch {

                        // 保留默认错误

                    }

                }

            } catch {}


            console.error(

                `[CQS ${providerConfig.name} HTTP Error]`,

                upstreamResponse.status,

                errorMessage

            );


            if (!closed) {

                sendEvent({

                    type:
                        "error",

                    error:
                        errorMessage

                });


                sendEvent({

                    type:
                        "done"

                });


                try {

                    res.end();

                } catch {}

            }

            return;

        }


        // =====================================================
        // CHECK STREAM
        // =====================================================

        if (
            !upstreamResponse.body
        ) {

            clearTimeout(
                timeout
            );


            if (!closed) {

                sendEvent({

                    type:
                        "error",

                    error:
                        `${providerConfig.name} 没有返回流式数据`

                });


                sendEvent({

                    type:
                        "done"

                });


                try {

                    res.end();

                } catch {}

            }

            return;

        }


        // =====================================================
        // READ PROVIDER SSE
        // =====================================================

        const reader =
            upstreamResponse.body
                .getReader();


        const decoder =
            new TextDecoder(
                "utf-8"
            );


        let buffer = "";


        // =====================================================
        // PROCESS SSE EVENT
        // =====================================================

        const processProviderEvent = (
            event
        ) => {

            if (
                closed
            ) {
                return;
            }


            const lines =
                event.split(
                    /\r?\n/
                );


            const dataLines =
                lines
                    .filter(
                        line =>
                            line.startsWith(
                                "data:"
                            )
                    )
                    .map(
                        line =>
                            line
                                .slice(5)
                                .trim()
                    );


            if (
                dataLines.length === 0
            ) {

                return;

            }


            const data =
                dataLines.join(
                    "\n"
                );


            if (
                !data
            ) {

                return;

            }


            // =================================================
            // [DONE]
            // =================================================

            if (
                data === "[DONE]"
            ) {

                finished = true;

                return;

            }


            let packet;


            try {

                packet =
                    JSON.parse(
                        data
                    );

            } catch {

                return;

            }


            // =================================================
            // OPENAI-COMPATIBLE FORMAT
            //
            // DeepSeek / Still / Agent 如果返回：
            //
            // choices[0].delta.content
            //
            // 就可以直接进入这里。
            // =================================================

            const choice =
                packet?.choices?.[0];


            const delta =
                choice?.delta;


            // =================================================
            // THINKING / REASONING
            //
            // DeepSeek:
            // delta.reasoning_content
            //
            // =================================================

            if (
                delta &&
                typeof
                    delta.reasoning_content ===
                    "string" &&
                delta.reasoning_content.length >
                    0
            ) {

                sendEvent({

                    type:
                        "reasoning",

                    content:
                        delta.reasoning_content

                });

            }


            // =================================================
            // SOME PROVIDERS MAY USE:
            //
            // delta.reasoning
            // =================================================

            else if (
                delta &&
                typeof
                    delta.reasoning ===
                    "string" &&
                delta.reasoning.length >
                    0
            ) {

                sendEvent({

                    type:
                        "reasoning",

                    content:
                        delta.reasoning

                });

            }


            // =================================================
            // FINAL ANSWER
            // =================================================

            if (
                delta &&
                typeof
                    delta.content ===
                    "string" &&
                delta.content.length >
                    0
            ) {

                sendEvent({

                    type:
                        "delta",

                    content:
                        delta.content

                });

            }


            // =================================================
            // USAGE
            // =================================================

            if (
                packet?.usage
            ) {

                sendEvent({

                    type:
                        "usage",

                    usage:
                        packet.usage

                });

            }


            // =================================================
            // PROVIDER ERROR INSIDE SSE
            // =================================================

            if (
                packet?.error
            ) {

                const message =
                    typeof packet.error ===
                    "string"
                        ? packet.error
                        : packet.error?.message ||
                          `${providerConfig.name} Provider Error`;


                sendEvent({

                    type:
                        "error",

                    error:
                        message

                });

            }

        };


        // =====================================================
        // READ LOOP
        // =====================================================

        try {

            while (
                !finished &&
                !closed
            ) {

                const {
                    value,
                    done
                } =
                    await reader.read();


                if (
                    done
                ) {

                    break;

                }


                if (
                    value
                ) {

                    buffer +=
                        decoder.decode(
                            value,
                            {
                                stream:
                                    true
                            }
                        );

                }


                // =================================================
                // SSE EVENTS
                // =================================================

                const events =
                    buffer.split(
                        /\r?\n\r?\n/
                    );


                buffer =
                    events.pop() ||
                    "";


                for (
                    const event
                    of events
                ) {

                    if (
                        closed
                    ) {
                        break;
                    }


                    processProviderEvent(
                        event
                    );

                }

            }


            // =====================================================
            // FLUSH UTF-8
            // =====================================================

            buffer +=
                decoder.decode();


            // =====================================================
            // PROCESS REMAINING EVENT
            // =====================================================

            if (
                !closed &&
                buffer.trim()
            ) {

                const events =
                    buffer.split(
                        /\r?\n\r?\n/
                    );


                for (
                    const event
                    of events
                ) {

                    if (
                        closed
                    ) {
                        break;
                    }


                    processProviderEvent(
                        event
                    );

                }

            }


            // =====================================================
            // NORMAL FINISH
            // =====================================================

            if (
                !closed
            ) {

                sendEvent({

                    type:
                        "done"

                });

            }

        } catch (error) {

            console.error(

                `[CQS ${providerConfig.name} Stream Error]`,

                error

            );


            if (
                !closed
            ) {

                sendEvent({

                    type:
                        "error",

                    error:
                        error?.name ===
                        "AbortError"

                            ? "AI 请求已取消"

                            : `${providerConfig.name} AI 流式传输发生错误`

                });


                sendEvent({

                    type:
                        "done"

                });

            }

        } finally {

            clearTimeout(
                timeout
            );


            try {

                reader.releaseLock();

            } catch {}


            if (
                !closed
            ) {

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


        // =====================================================
        // SSE ALREADY STARTED
        // =====================================================

        if (
            res.headersSent
        ) {

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


        // =====================================================
        // NORMAL JSON ERROR
        // =====================================================

        return res.status(500).json({

            success: false,

            error:
                "服务器内部错误"

        });

    }

}