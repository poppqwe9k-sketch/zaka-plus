export function buildChatHistoryPayload(messages, maxMessages = 10) {
  const cleaned = (Array.isArray(messages) ? messages : [])
    .filter((msg) => {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.imageError) return false;
      if (msg.type === 'image' && (!msg.content || !String(msg.content).trim())) return false;
      const text = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!text) return false;
      return msg.role === 'user' || msg.role === 'assistant' || msg.role === 'model';
    })
    .map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content: msg.content.trim()
    }));

  // Merge consecutive same-role messages so Gemini always receives alternating turns.
  const alternating = [];
  for (const item of cleaned) {
    const prev = alternating[alternating.length - 1];
    if (prev && prev.role === item.role) {
      prev.content = `${prev.content}\n\n${item.content}`;
    } else {
      alternating.push({ ...item });
    }
  }

  const sliced = alternating.slice(-maxMessages);
  while (sliced.length > 0 && sliced[0].role !== 'user') {
    sliced.shift();
  }

  return sliced;
}
