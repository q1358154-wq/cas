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
// 6. 返回真实 Notion Page ID / URL
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

    let parentPageId =
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
    // Normalize Notion Page ID
    //
    // Notion 页面 ID 可能来自：
    //
    // 1. 32 位无横杠 ID
    // 2. UUID 格式 ID
    // 3. Notion URL
    // ---------------------------------------------------------

    try {

        if (
            parentPageId.startsWith(
                "http://"
            ) ||
            parentPageId.startsWith(
                "https://"
            )
        ) {

            const url =
                new URL(
                    parentPageId
                );

            const path =
                url.pathname;

            const match =
                path.match(
                    /([0-9a-f]{32})$/i
                );

            if (match) {

                parentPageId =
                    match[1];

            } else {

                const uuidMatch =
                    path.match(
                        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
                    );

                if (uuidMatch) {

                    parentPageId =
                        uuidMatch[1];

                }

            }

        }


        // Remove everything except hexadecimal
        // characters and existing UUID hyphens.

        parentPageId =
            parentPageId
                .replace(
                    /[^0-9a-f-]/gi,
                    ""
                );


        // Convert 32-character ID
        // into UUID format.

        const compactId =
            parentPageId.replace(
                /-/g,
                ""
            );


        if (
            /^[0-9a-f]{32}$/i.test(
                compactId
            )
        ) {

            parentPageId =
                compactId.replace(
                    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
                    "$1-$2-$3-$4-$5"
                );

        }


    } catch (error) {

        console.error(
            "[CQS Notion ID Parse Error]",
            error
        );

        return res.status(400).json({

            success: false,

            error:
                "NOTION_PARENT_PAGE_ID 格式无效",

            detail:
                error?.message ||
                "Invalid Page ID"

        });

    }


    // ---------------------------------------------------------
    // Final Page ID Validation
    // ---------------------------------------------------------

    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            parentPageId
        )
    ) {

        return res.status(400).json({

            success: false,

            error:
                "NOTION_PARENT_PAGE_ID 格式无效",

            received:
                parentPageId,

            hint:
                "请填写 Notion 页面 ID，而不是 Integration Token。"

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


            // Role heading

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


            // Message content

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
        // Notion API allows max 100 children per request
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

                parentPageIdLength:
                    parentPageId.length,

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
        // Read Response
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
        // Notion API Error
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