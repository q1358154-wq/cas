// =========================================================
// CQS AI Global
// Notion Secure Gateway
// /api/notion.js
//
// 功能：
// 1. 创建 Notion 页面
// 2. 保存 CQS AI 对话
// 3. 保存 conversationId
// 4. 保存用户消息
// 5. 保存 AI 回复
//
// 环境变量：
// NOTION_TOKEN
// NOTION_PARENT_PAGE_ID
// =========================================================
export default async function handler(req, res) {
    // ---------------------------------------------------------
    // Method
    // ---------------------------------------------------------
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
    // ---------------------------------------------------------
    // Environment
    // ---------------------------------------------------------
    const notionToken =
        process.env.NOTION_TOKEN;
    const parentPageId =
        process.env.NOTION_PARENT_PAGE_ID;
    if (!notionToken) {
        return res.status(500).json({
            success: false,
            error: "服务器未配置 NOTION_TOKEN"
        });
    }
    if (!parentPageId) {
        return res.status(500).json({
            success: false,
            error: "服务器未配置 NOTION_PARENT_PAGE_ID"
        });
    }
    // ---------------------------------------------------------
    // Main
    // ---------------------------------------------------------
    try {
        const body = req.body || {};
        const conversationId =
            typeof body.conversationId === "string"
                ? body.conversationId
                    .trim()
                    .substring(0, 100)
                : "";
        const title =
            typeof body.title === "string"
                ? body.title
                    .trim()
                    .substring(0, 200)
                : "CQS AI 对话";
        const messages =
            Array.isArray(body.messages)
                ? body.messages
                : [];
        // -----------------------------------------------------
        // Validate
        // -----------------------------------------------------
        if (messages.length === 0) {
            return res.status(400).json({
                success: false,
                error: "没有可保存的对话内容"
            });
        }
        // -----------------------------------------------------
        // Clean Messages
        // -----------------------------------------------------
        const cleanMessages = [];
        for (const message of messages) {
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
                role !== "user" &&
                role !== "assistant"
            ) {
                continue;
            }
            if (
                typeof content !== "string" ||
                !content.trim()
            ) {
                continue;
            }
            cleanMessages.push({
                role,
                content:
                    content
                        .trim()
                        .substring(0, 5000)
            });
        }
        if (cleanMessages.length === 0) {
            return res.status(400).json({
                success: false,
                error: "没有合法的对话内容"
            });
        }
        // -----------------------------------------------------
        // Build Notion Blocks
        // -----------------------------------------------------
        const children = [];
        // conversationId
        if (conversationId) {
            children.push({
                object: "block",
                type: "paragraph",
                paragraph: {
                    rich_text: [
                        {
                            type: "text",
                            text: {
                                content:
                                    `Conversation ID: ${conversationId}`
                            }
                        }
                    ]
                }
            });
        }
        // Divider
        children.push({
            object: "block",
            type: "divider",
            divider: {}
        });
        // Messages
        for (const message of cleanMessages) {
            const label =
                message.role === "user"
                    ? "👤 用户"
                    : "🤖 CQS AI";
            // Role
            children.push({
                object: "block",
                type: "heading_3",
                heading_3: {
                    rich_text: [
                        {
                            type: "text",
                            text: {
                                content: label
                            }
                        }
                    ]
                }
            });
            // Content
            children.push({
                object: "block",
                type: "paragraph",
                paragraph: {
                    rich_text: [
                        {
                            type: "text",
                            text: {
                                content:
                                    message.content
                            }
                        }
                    ]
                }
            });
        }
        // -----------------------------------------------------
        // Notion API
        // -----------------------------------------------------
        const response =
            await fetch(
                "https://api.notion.com/v1/pages",
                {
                    method: "POST",
                    headers: {
                        "Authorization":
                            `Bearer ${notionToken}`,
                        "Content-Type":
                            "application/json",
                        "Notion-Version":
                            "2022-06-28"
                    },
                    body: JSON.stringify({
                        parent: {
                            type: "page_id",
                            page_id:
                                parentPageId
                        },
                        properties: {
                            title: {
                                title: [
                                    {
                                        type: "text",
                                        text: {
                                            content:
                                                title
                                        }
                                    }
                                ]
                            }
                        },
                        children:
                            children.slice(0, 100)
                    })
                }
            );
        // -----------------------------------------------------
        // Notion Error
        // -----------------------------------------------------
        if (!response.ok) {
            let errorMessage =
                `Notion API 请求失败 (${response.status})`;
            try {
                const errorData =
                    await response.json();
                errorMessage =
                    errorData?.message ||
                    errorMessage;
            } catch {}
            console.error(
                "[CQS Notion API Error]",
                errorMessage
            );
            return res.status(
                response.status
            ).json({
                success: false,
                error: errorMessage
            });
        }
        // -----------------------------------------------------
        // Success
        // -----------------------------------------------------
        const data =
            await response.json();
        return res.status(200).json({
            success: true,
            message:
                "对话已成功保存到 Notion",
            pageId:
                data.id || null,
            url:
                data.url || null,
            conversationId:
                conversationId || null
        });
    } catch (error) {
        console.error(
            "[CQS Notion Gateway Error]",
            error
        );
        return res.status(500).json({
            success: false,
            error:
                "保存到 Notion 时发生服务器错误"
        });
    }
}