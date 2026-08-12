// =========================================================
// CQS AI GLOBAL
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
        typeof process.env.NOTION_TOKEN === "string"
            ? process.env.NOTION_TOKEN.trim()
            : "";

    const parentPageId =
        typeof process.env.NOTION_PARENT_PAGE_ID === "string"
            ? process.env.NOTION_PARENT_PAGE_ID.trim()
            : "";


    if (!notionToken) {

        return res.status(500).json({
            success: false,
            error:
                "服务器未配置 NOTION_TOKEN"
        });

    }


    if (!parentPageId) {

        return res.status(500).json({
            success: false,
            error:
                "服务器未配置 NOTION_PARENT_PAGE_ID"
        });

    }


    // ---------------------------------------------------------
    // Main
    // ---------------------------------------------------------

    try {

        const body =
            req.body || {};


        // -----------------------------------------------------
        // Conversation ID
        // -----------------------------------------------------

        const conversationId =
            typeof body.conversationId === "string"
                ? body.conversationId
                    .trim()
                    .substring(0, 100)
                : "";


        // -----------------------------------------------------
        // Title
        // -----------------------------------------------------

        const title =
            typeof body.title === "string" &&
            body.title.trim()
                ? body.title
                    .trim()
                    .substring(0, 200)
                : "CQS AI 对话";


        // -----------------------------------------------------
        // Messages
        // -----------------------------------------------------

        const messages =
            Array.isArray(body.messages)
                ? body.messages
                : [];


        if (
            messages.length === 0
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "没有可保存的对话内容"
            });

        }


        // -----------------------------------------------------
        // Clean Messages
        // -----------------------------------------------------

        const cleanMessages = [];


        for (
            const message of messages
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
                role !== "user" &&
                role !== "assistant"
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


            if (
                !cleanContent
            ) {
                continue;
            }


            cleanMessages.push({

                role,

                content:
                    cleanContent.substring(
                        0,
                        5000
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


        // -----------------------------------------------------
        // Build Notion Blocks
        // -----------------------------------------------------

        const children = [];


        // Conversation ID

        if (
            conversationId
        ) {

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

        for (
            const message of cleanMessages
        ) {

            const label =
                message.role === "user"
                    ? "用户"
                    : "CQS AI";


            // Role

            children.push({

                object: "block",

                type: "heading_3",

                heading_3: {

                    rich_text: [

                        {

                            type: "text",

                            text: {

                                content:
                                    label

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
        // Limit Notion blocks
        // -----------------------------------------------------

        const limitedChildren =
            children.slice(
                0,
                100
            );


        // -----------------------------------------------------
        // Notion Request Body
        // -----------------------------------------------------

        const notionBody = {

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
                limitedChildren

        };


        // -----------------------------------------------------
        // Debug
        // -----------------------------------------------------

        console.log(
            "[CQS Notion] Creating page",
            {
                parentPageId,
                title,
                messageCount:
                    cleanMessages.length,
                blockCount:
                    limitedChildren.length
            }
        );


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

                    body:
                        JSON.stringify(
                            notionBody
                        )

                }
            );


        // -----------------------------------------------------
        // Read Notion Response
        // -----------------------------------------------------

        const responseText =
            await response.text();


        let data = null;

        try {

            data =
                responseText
                    ? JSON.parse(
                        responseText
                    )
                    : null;

        } catch {

            data = null;

        }


        // -----------------------------------------------------
        // Notion Error
        // -----------------------------------------------------

        if (
            !response.ok
        ) {

            console.error(
                "[CQS Notion API Error]",
                {

                    status:
                        response.status,

                    statusText:
                        response.statusText,

                    code:
                        data?.code ||
                        null,

                    message:
                        data?.message ||
                        null,

                    raw:
                        responseText

                }
            );


            return res.status(
                response.status
            ).json({

                success: false,

                error:
                    data?.message ||
                    `Notion API 请求失败 (${response.status})`,

                code:
                    data?.code ||
                    null,

                status:
                    response.status

            });

        }


        // -----------------------------------------------------
        // Success
        // -----------------------------------------------------

        const pageId =
            data?.id ||
            null;

        const pageUrl =
            data?.url ||
            null;


        console.log(
            "[CQS Notion Success]",
            {

                pageId,

                url:
                    pageUrl,

                conversationId

            }
        );


        return res.status(200).json({

            success: true,

            message:
                "对话已成功保存到 Notion",

            pageId,

            url:
                pageUrl,

            conversationId:
                conversationId ||
                null

        });


    } catch (error) {

        console.error(
            "[CQS Notion Gateway Error]",
            error
        );


        return res.status(500).json({

            success: false,

            error:
                error?.message ||
                "保存到 Notion 时发生服务器错误"

        });

    }

}