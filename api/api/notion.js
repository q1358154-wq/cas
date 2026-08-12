async function saveToNotion() {

    if (state.messages.length === 0) {

        toast(
            state.language === "zh"
                ? "当前没有可保存的对话"
                : "No conversation to save"
        );

        return;
    }

    try {

        const response =
            await fetch(
                "/api/notion",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        conversationId:
                            state.currentConversationId || "",

                        title:
                            state.messages[0]?.content
                                ?.substring(0, 50) ||
                            "CQS AI 对话",

                        messages:
                            state.messages
                    })
                }
            );

        const data =
            await response.json();

        // -----------------------------------------------------
        // Notion Error
        // -----------------------------------------------------

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.error ||
                "Notion 保存失败"
            );
        }

        // -----------------------------------------------------
        // Success
        // -----------------------------------------------------
        // 不自动打开 Notion 页面
        //
        // 直接显示 Page ID，
        // 用于确认 Notion API 是否真的创建成功。
        // -----------------------------------------------------

        toast(
            state.language === "zh"
                ? `Notion 保存成功\nPage ID: ${
                    data.pageId ||
                    "未返回"
                }`
                : `Saved to Notion\nPage ID: ${
                    data.pageId ||
                    "Not returned"
                }`
        );

        // -----------------------------------------------------
        // Console Verification
        // -----------------------------------------------------

        console.log(
            "[CQS Notion Success]",
            {
                success:
                    data.success,

                pageId:
                    data.pageId,

                url:
                    data.url,

                conversationId:
                    data.conversationId
            }
        );

    } catch (error) {

        // -----------------------------------------------------
        // Frontend Error
        // -----------------------------------------------------

        console.error(
            "[CQS Notion Frontend Error]",
            error
        );

        toast(
            state.language === "zh"
                ? `Notion 保存失败：${
                    error.message ||
                    "未知错误"
                }`
                : `Notion save failed: ${
                    error.message ||
                    "Unknown error"
                }`
        );
    }
}