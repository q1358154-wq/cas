"use client";

import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    let cancelled = false;

    async function startRuntime() {
      if (cancelled) return;

      const { initCQSAI } = await import("../legacy/runtime.js");

      if (!cancelled && typeof initCQSAI === "function") {
        initCQSAI();
      }
    }

    startRuntime();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {/* CQSAI 原始 HTML UI 会完整放在这里。
          这一层只负责承载原来的页面结构，
          不重新设计、不删减原来的 3D UI。 */}

      <div id="cqsai-app">
        {/* 原始 HTML 主体将在这里完整迁移 */}
      </div>
    </>
  );
}