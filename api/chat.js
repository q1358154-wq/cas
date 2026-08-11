export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { messages } = req.body;
  const apiKey = process.env.DEEPSEEK_API_KEY;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro', // 👈 已更新为最新模型名称
        messages: messages,
        stream: false
      })
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'API Connection Failed' });
  }
}
