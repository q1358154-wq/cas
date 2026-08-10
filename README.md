<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeepSeek Global AI Terminal</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Inter:wght@300;400;600&display=swap');
    body {
      background: #030712; color: #f3f4f6; font-family: 'Inter', sans-serif;
      margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; height: 100vh;
    }
    .container { width: 100%; max-width: 600px; background: rgba(3, 7, 18, 0.9); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 16px; padding: 20px; box-shadow: 0 0 30px rgba(59, 130, 246, 0.1); display: flex; flex-direction: column; height: 80vh; }
    h2 { font-family: 'Orbitron', sans-serif; color: #60a5fa; font-size: 16px; margin-top: 0; text-align: center; }
    .chat-box { flex: 1; background: #020617; border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 10px; padding: 12px; overflow-y: auto; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
    .msg { padding: 8px 12px; border-radius: 8px; max-width: 80%; line-height: 1.4; word-break: break-word; }
    .msg.user { background: #2563eb; color: #fff; align-self: flex-end; }
    .msg.assistant { background: #1e293b; color: #e2e8f0; align-self: flex-start; }
    .input-area { display: flex; gap: 8px; }
    input { flex: 1; background: #020617; border: 1px solid rgba(59, 130, 246, 0.4); padding: 10px; border-radius: 8px; color: #fff; outline: none; }
    button { background: #3b82f6; color: #fff; border: none; padding: 0 20px; border-radius: 8px; font-weight: bold; cursor: pointer; font-family: 'Orbitron', sans-serif; }
  </style>
</head>
<body>
<div class="container">
  <h2>🌍 DEEPSEEK GLOBAL TERMINAL</h2>
  <div class="chat-box" id="chatBox">
    <div class="msg assistant">Hello! I am your global AI assistant powered by DeepSeek. How can I help you today?</div>
  </div>
  <div class="input-area">
    <input type="text" id="userInput" placeholder="Ask something in English or any language...">
    <button onclick="sendMsg()">Send</button>
  </div>
</div>

<script>
async function sendMsg() {
  const input = document.getElementById('userInput');
  const chatBox = document.getElementById('chatBox');
  const text = input.value.trim();
  if(!text) return;

  chatBox.innerHTML += `<div class="msg user">${text}</div>`;
  input.value = '';
  chatBox.scrollTop = chatBox.scrollHeight;

  const aiMsg = document.createElement('div');
  aiMsg.className = 'msg assistant';
  aiMsg.textContent = 'Thinking...';
  chatBox.appendChild(aiMsg);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    aiMsg.textContent = data.reply || 'Error getting response.';
  } catch (e) {
    aiMsg.textContent = 'Network connection error.';
  }
  chatBox.scrollTop = chatBox.scrollHeight;
}
</script>
</body>
</html>
