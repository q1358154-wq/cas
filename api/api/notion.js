export default async function handler(req, res) {

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
    // ENVIRONMENT
    // =========================================================

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
            stage: "environment",
            error:
                "NOTION_TOKEN 未配置"
        });

    }


    if (!parentPageId) {

        return res.status(500).json({
            success: false,
            stage: "environment",
            error:
                "NOTION_PARENT_PAGE_ID 未配置"
        });

    }


    // =========================================================
    // NORMALIZE PAGE ID
    // =========================================================

    try {

        // 如果误填了完整 Notion URL
        if (
            parentPageId.startsWith("http://") ||
            parentPageId.startsWith("https://")
        ) {

            const url =
                new URL(parentPageId);

            const compactMatch =
                url.pathname.match(
                    /([0-9a-f]{32})/i
                );

            const uuidMatch =
                url.pathname.match(
                    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
                );

            if (uuidMatch) {

                parentPageId =
                    uuidMatch[1];

            } else if (compactMatch) {

                parentPageId =
                    compactMatch[1];

            }

        }


        // 去掉空格
        parentPageId =
            parentPageId.trim();


        // 去掉 UUID 中可能存在的非标准字符
        parentPageId =
            parentPageId.replace(
                /[^0-9a-f-]/gi,
                ""
            );


        // 去掉横杠后判断是不是 32 位 Notion ID
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

        return res.status(400).json({

            success: false,

            stage:
                "page_id_parse",

            error:
                "无法解析 NOTION_PARENT_PAGE_ID",

            detail:
                error?.message ||
                "Invalid Page ID"

        });

    }


    // =========================================================
    // PAGE ID FORMAT
    // =========================================================

    const validPageId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(
                parentPageId
            );


    if (!validPageId) {

        return res.status(400).json({

            success: false,

            stage:
                "page_id_format",

            error:
                "NOTION_PARENT_PAGE_ID 格式无效",

            receivedLength:
                parentPageId.length,

            received:
                parentPageId

        });

    }


    // =========================================================
    // CHECK TOKEN
    // =========================================================

    try {

        const tokenResponse =
            await fetch(
                "https://api.notion.com/v1/users/me",
                {

                    method: "GET",

                    headers: {

                        "Authorization":
                            `Bearer ${notionToken}`,

                        "Notion-Version":
                            "2022-06-28"

                    }

                }
            );


        const tokenText =
            await tokenResponse.text();


        let tokenData = null;


        try {

            tokenData =
                tokenText
                    ? JSON.parse(
                        tokenText
                    )
                    : null;

        } catch {}


        if (
            !tokenResponse.ok
        ) {

            return res.status(401).json({

                success: false,

                stage:
                    "token",

                error:
                    "Notion Token 无效或没有权限",

                notionStatus:
                    tokenResponse.status,

                notionCode:
                    tokenData?.code ||
                    null,

                notionMessage:
                    tokenData?.message ||
                    tokenText ||
                    null

            });

        }


        console.log(
            "[CQS Notion] Token OK"
        );

    } catch (error) {

        return res.status(500).json({

            success: false,

            stage:
                "token_request",

            error:
                error?.message ||
                "无法连接 Notion API"

        });

    }


    // =========================================================
    // CHECK PARENT PAGE
    // =========================================================

    try {

        const pageResponse =
            await fetch(
                `https://api.notion.com/v1/pages/${parentPageId}`,
                {

                    method: "GET",

                    headers: {

                        "Authorization":
                            `Bearer ${notionToken}`,

                        "Notion-Version":
                            "2022-06-28"

                    }

                }
            );


        const pageText =
            await pageResponse.text();


        let pageData = null;


        try {

            pageData =
                pageText
                    ? JSON.parse(
                        pageText
                    )
                    : null;

        } catch {}


        if (
            !pageResponse.ok
        ) {

            return res.status(
                pageResponse.status
            ).json({

                success: false,

                stage:
                    "parent_page",

                error:
                    "Notion 找不到这个页面，或者 Integration 没有访问权限",

                notionStatus:
                    pageResponse.status,

                notionCode:
                    pageData?.code ||
                    null,

                notionMessage:
                    pageData?.message ||
                    pageText ||
                    null,

                pageId:
                    parentPageId

            });

        }


        console.log(
            "[CQS Notion] Parent page OK",
            {
                pageId:
                    parentPageId
            }
        );

    } catch (error) {

        return res.status(500).json({

            success: false,

            stage:
                "parent_page_request",

            error:
                error?.message ||
                "检查 Notion 页面时发生错误"

        });

    }


    // =========================================================
    // BODY
    // =========================================================

    try {

        const body =
            req.body || {};


        const conversationId =
            typeof body.conversationId === "string"
                ? body.conversationId
                    .trim()
                    .substring(0, 100)
                : "";


        const title =
            typeof body.title === "string" &&
            body.title.trim()
                ? body.title
                    .trim()
                    .substring(0, 200)
                : "CQS AI 对话";


        const messages =
            Array.isArray(body.messages)
                ? body.messages
                : [];


        if (
            messages.length === 0
        ) {

            return res.status(400).json({

                success: false,

                stage:
                    "messages",

                error:
                    "没有可保存的对话内容"

            });

        }


        // =====================================================
        // CLEAN MESSAGES
        // =====================================================

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


            if (
                message.role !== "user" &&
                message.role !== "assistant"
            ) {
                continue;
            }


            if (
                typeof message.content !== "string"
            ) {
                continue;
            }


            const content =
                message.content.trim();


            if (!content) {
                continue;
            }


            cleanMessages.push({

                role:
                    message.role,

                content:
                    content.substring(
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

                stage:
                    "messages",

                error:
                    "没有合法的消息内容"

            });

        }


        // =====================================================
        // BUILD BLOCKS
        // =====================================================

        const children = [];


        if (conversationId) {

            children.push({

                object:
                    "block",

                type:
                    "paragraph",

                paragraph: {

                    rich_text: [

                        {

                            type:
                                "text",

                            text: {

                                content:
                                    `Conversation ID: ${conversationId}`

                            }

                        }

                    ]

                }

            });

        }


        children.push({

            object:
                "block",

            type:
                "divider",

            divider: {}

        });


        for (
            const message
            of cleanMessages
        ) {

            const label =
                message.role === "user"
                    ? "用户"
                    : "CQS AI";


            children.push({

                object:
                    "block",

                type:
                    "heading_3",

                heading_3: {

                    rich_text: [

                        {

                            type:
                                "text",

                            text: {

                                content:
                                    label

                            }

                        }

                    ]

                }

            });


            children.push({

                object:
                    "block",

                type:
                    "paragraph",

                paragraph: {

                    rich_text: [

                        {

                            type:
                                "text",

                            text: {

                                content:
                                    message.content

                            }

                        }

                    ]

                }

            });

        }


        // Notion 单次最多 100 个 children
        const limitedChildren =
            children.slice(
                0,
                100
            );


        // =====================================================
        // CREATE PAGE
        // =====================================================

        const notionBody = {

            parent: {

                type:
                    "page_id",

                page_id:
                    parentPageId

            },

            properties: {

                title: {

                    title: [

                        {

                            type:
                                "text",

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


        const response =
            await fetch(
                "https://api.notion.com/v1/pages",
                {

                    method:
                        "POST",

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

        } catch {}


        if (
            !response.ok
        ) {

            console.error(
                "[CQS Notion CREATE ERROR]",
                {

                    status:
                        response.status,

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

                success:
                    false,

                stage:
                    "create_page",

                error:
                    data?.message ||
                    "Notion 创建页面失败",

                notionStatus:
                    response.status,

                notionCode:
                    data?.code ||
                    null,

                notionMessage:
                    data?.message ||
                    null

            });

        }


        // =====================================================
        // SUCCESS
        // =====================================================

        return res.status(200).json({

            success:
                true,

            message:
                "对话已成功保存到 Notion",

            pageId:
                data?.id ||
                null,

            url:
                data?.url ||
                null,

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

            success:
                false,

            stage:
                "server",

            error:
                error?.message ||
                "Notion 保存过程中发生服务器错误"

        });

    }

}