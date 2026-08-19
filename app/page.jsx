"use client";

import { useEffect } from "react";

const ORIGINAL_BODY = String.raw`
<!-- 原 HTML body 完整内容 -->
`;

export default function Page() {
  useEffect(() => {
    let cleanup;

    import("../legacy/runtime.js").then(({ initCQSAI }) => {
      cleanup = initCQSAI();
    });

    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, []);

  return (
    <div
      id="cqsai-next-root"
      dangerouslySetInnerHTML={{ __html: ORIGINAL_BODY }}
    />
  );
}