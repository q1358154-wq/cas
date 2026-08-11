export default async function handler(req, res) {
    // =========================================================
    // CQS AI Global
    // Notion Secure Gateway
    // /api/notion.js
    // =========================================================
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
    // Notion Token
    // ---------------------------------------------------------
    const notionToken =
        process.env.NOTION_API_KEY;
    if (
        !notionToken ||
        !notionToken.trim()
    ) {
        return res.status(500).json({
            success: false,
            error: "服务器未配置 NOTION_API_KEY"
        });
    }
    // ---------------------------------------------------------
    // Main
    // ---------------------------------------------------------
    try {
        const body =
            req.body || {};
        const action =
            typeof body.action === "string"
                ? body.action.trim()
                : "";
        // -----------------------------------------------------
        // Validate action
        // -----------------------------------------------------
        const allowedActions = new Set([
            "search",
            "get_page",
            "create_page",
            "append_blocks"
        ]);
        if (
            !allowedActions.has(action)
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "不支持的 Notion 操作"
            });
        }
        // -----------------------------------------------------
        // Notion API helper
        // -----------------------------------------------------
        async function notionFetch(
            endpoint,
            options = {}
        ) {
            const response =
                await fetch(
                    `https://api.notion.com/v1${endpoint}`,
                    {
                        ...options,
                        headers: {
                            "Authorization":
                                `Bearer ${notionToken.trim()}`,
                            "Content-Type":
                                "application/json",
                            "Notion-Version":
                                "2022-06-28",
                            ...(options.headers || {})
                        }
                    }
                );
            const text =
                await response.text();
            let data = null;
            try {
                data =
                    text
                        ? JSON.parse(text)
                        : null;
            } catch {
                data = {
                    message: text
                };
            }
            if (!response.ok) {
                const error =
                    data?.message ||
                    data?.error ||
                    `Notion API Error (${response.status})`;
                const err =
                    new Error(error);
                err.status =
                    response.status;
                throw err;
            }
            return data;
        }
        // =====================================================
        // SEARCH
        // =====================================================
        if (action === "search") {
            const query =
                typeof body.query === "string"
                    ? body.query.trim()
                    : "";
            if (!query) {
                return res.status(400).json({
                    success: false,
                    error:
                        "search 操作需要 query"
                });
            }
            if (query.length > 200) {
                return res.status(400).json({
                    success: false,
                    error:
                        "搜索内容过长"
                });
            }
            const result =
                await notionFetch(
                    "/search",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            query,
                            page_size: 20,
                            sort: {
                                direction: "descending",
                                timestamp: "last_edited_time"
                            }
                        })
                    }
                );
            return res.status(200).json({
                success: true,
                action: "search",
                results:
                    result?.results || []
            });
        }
        // =====================================================
        // GET PAGE
        // =====================================================
        if (action === "get_page") {
            const pageId =
                typeof body.pageId === "string"
                    ? body.pageId.trim()
                    : "";
            if (!pageId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "get_page 操作需要 pageId"
                });
            }
            const page =
                await notionFetch(
                    `/pages/${encodeURIComponent(pageId)}`,
                    {
                        method: "GET"
                    }
                );
            const blocks =
                await notionFetch(
                    `/blocks/${encodeURIComponent(pageId)}/children?page_size=100`,
                    {
                        method: "GET"
                    }
                );
            return res.status(200).json({
                success: true,
                action: "get_page",
                page,
                blocks:
                    blocks?.results || []
            });
        }
        // =====================================================
        // CREATE PAGE
        // =====================================================
        if (action === "create_page") {
            const parentId =
                typeof body.parentId === "string"
                    ? body.parentId.trim()
                    : "";
            const title =
                typeof body.title === "string"
                    ? body.title.trim()
                    : "";
            const content =
                typeof body.content === "string"
                    ? body.content.trim()
                    : "";
            if (!parentId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "create_page 操作需要 parentId"
                });
            }
            if (!title) {
                return res.status(400).json({
                    success: false,
                    error:
                        "create_page 操作需要 title"
                });
            }
            if (title.length > 200) {
                return res.status(400).json({
                    success: false,
                    error:
                        "页面标题过长"
                });
            }
            // -------------------------------------------------
            // Convert simple text into Notion paragraphs
            // -------------------------------------------------
            const blocks = [];
            if (content) {
                const paragraphs =
                    content
                        .split(/\n+/)
                        .map(
                            item =>
                                item.trim()
                        )
                        .filter(Boolean);
                for (
                    const paragraph
                    of paragraphs.slice(0, 100)
                ) {
                    blocks.push({
                        object: "block",
                        type: "paragraph",
                        paragraph: {
                            rich_text: [
                                {
                                    type: "text",
                                    text: {
                                        content:
                                            paragraph.slice(
                                                0,
                                                2000
                                            )
                                    }
                                }
                            ]
                        }
                    });
                }
            }
            const page =
                await notionFetch(
                    "/pages",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            parent: {
                                page_id:
                                    parentId
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
                                blocks
                        })
                    }
                );
            return res.status(200).json({
                success: true,
                action: "create_page",
                page
            });
        }
        // =====================================================
        // APPEND BLOCKS
        // =====================================================
        if (action === "append_blocks") {
            const pageId =
                typeof body.pageId === "string"
                    ? body.pageId.trim()
                    : "";
            const content =
                typeof body.content === "string"
                    ? body.content.trim()
                    : "";
            if (!pageId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "append_blocks 操作需要 pageId"
                });
            }
            if (!content) {
                return res.status(400).json({
                    success: false,
                    error:
                        "append_blocks 操作需要 content"
                });
            }
            const paragraphs =
                content
                    .split(/\n+/)
                    .map(
                        item =>
                            item.trim()
                    )
                    .filter(Boolean)
                    .slice(0, 100);
            const children =
                paragraphs.map(
                    paragraph => ({
                        object: "block",
                        type: "paragraph",
                        paragraph: {
                            rich_text: [
                                {
                                    type: "text",
                                    text: {
                                        content:
                                            paragraph.slice(
                                                0,
                                                2000
                                            )
                                    }
                                }
                            ]
                        }
                    })
                );
            const result =
                await notionFetch(
                    `/blocks/${encodeURIComponent(pageId)}/children`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            children
                        })
                    }
                );
            return res.status(200).json({
                success: true,
                action: "append_blocks",
                results:
                    result?.results || []
            });
        }
        return res.status(400).json({
            success: false,
            error:
                "未处理的 Notion 操作"
        });
    } catch (error) {
        console.error(
            "[CQS Notion Gateway Error]",
            error
        );
        const status =
            Number(error?.status) >= 400 &&
            Number(error?.status) < 600
                ? Number(error.status)
                : 500;
        return res.status(status).json({
            success: false,
            error:
                error?.message ||
                "Notion 服务请求失败"
        });
    }
}