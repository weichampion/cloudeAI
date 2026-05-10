import { useState, useCallback, useRef } from 'react';
import { streamChat, sessionsApi } from '../services/api.js';

export function useChat(sessionId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  // Map<toolCallId, { toolName, status, result, error }>
  const [toolCalls, setToolCalls] = useState(new Map());
  const abortRef = useRef(null);

  const loadMessages = useCallback(async () => {
    if (!sessionId) return;
    const res = await sessionsApi.get(sessionId);
    setMessages(res.data.messages || []);
  }, [sessionId]);

  const sendMessage = useCallback(async (text, botId) => {
    if (!text.trim() || loading || !sessionId) return;

    const tempUserMsg = { id: 'tmp-user', role: 'user', content: text, created_at: Date.now() };
    setMessages(prev => [...prev, tempUserMsg]);
    setLoading(true);
    setStreamingContent('');
    setToolCalls(new Map());

    const systemPrompt = localStorage.getItem('system_prompt') || '';

    abortRef.current = streamChat({
      sessionId,
      message: text,
      systemPrompt: systemPrompt || undefined,
      botId: botId || undefined,
      onDelta: (delta) => setStreamingContent(prev => prev + delta),
      onDone: async () => {
        setStreamingContent('');
        setLoading(false);
        await loadMessages();
      },
      onError: (errMsg) => {
        setStreamingContent('');
        setLoading(false);
        setMessages(prev => [
          ...prev.filter(m => m.id !== 'tmp-user'),
          { id: 'err-' + Date.now(), role: 'assistant', content: `❌ ${errMsg}`, created_at: Date.now(), isError: true },
        ]);
      },
      onToolCallStart: ({ toolName, toolCallId }) => {
        setToolCalls(prev => new Map(prev).set(toolCallId, { toolName, status: 'running' }));
      },
      onToolCallDone: ({ toolName, toolCallId, result }) => {
        setToolCalls(prev => {
          const next = new Map(prev);
          const cur = next.get(toolCallId) || { toolName };
          next.set(toolCallId, { ...cur, status: 'done', result });
          return next;
        });
      },
      onToolCallError: ({ toolName, toolCallId, error }) => {
        setToolCalls(prev => {
          const next = new Map(prev);
          const cur = next.get(toolCallId) || { toolName };
          next.set(toolCallId, { ...cur, status: 'error', error });
          return next;
        });
      },
    });
  }, [sessionId, loading, loadMessages]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.();
    setLoading(false);
    setStreamingContent('');
  }, []);

  return { messages, loading, streamingContent, toolCalls, loadMessages, sendMessage, stopGeneration, setMessages };
}
