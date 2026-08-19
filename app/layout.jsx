import "./globals.css";

export const metadata = {
  title:
    "CQSAI — ULTIMATE GEEK SPATIAL CONSOLE WITH IMMERSIVE T-BRIDGE & FULL FUNCTION LINKAGE",
  description: "CQSAI Spatial Console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" data-lang="zh">
      <body>{children}</body>
    </html>
  );
}