import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send, Sparkles, Square, Trash2 } from 'lucide-react';
import { getInMemoryToken } from '../api';
import type { Country } from '../types';

interface AIAssistantHubProps {
  countries: Country[];
  defaultCountry?: string;
}

type PresetId = 'visa' | 'strategy' | 'guide' | 'checklist';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelLabel?: string;
}

const PRESETS: Array<{ id: PresetId; label: string; desc: string }> = [
  { id: 'visa', label: 'Visa & Document Advisor', desc: 'Deep step-by-step analysis & embassy verification reminders' },
  { id: 'strategy', label: 'University & Career Strategist', desc: 'Compare degrees, Ausbildung, scholarships, and budgets' },
  { id: 'guide', label: 'Abroad Peer Guide', desc: 'Housing safety, language prep, and anti-scam awareness' },
  { id: 'checklist', label: 'Quick Checklist Helper', desc: 'Fast, concise preparation checklists' },
];

export const AIAssistantHub: React.FC<AIAssistantHubProps> = ({ countries, defaultCountry = 'germany' }) => {
  const [preset, setPreset] = useState<PresetId>('guide');
  const [targetCountry, setTargetCountry] = useState(defaultCountry);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Ask me about target countries, university shortlisting, blocked accounts, APS/visa checklists, or housing safety. You can also record your question by voice.',
    },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    setError('');
    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: 'user', text: trimmed };
    const assistantId = `m_${Date.now()}`;
    const historyPayload = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'model', text: '' }]);
    setInput('');
    setStreaming(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AbroadConnect',
      };
      const memToken = getInMemoryToken();
      if (memToken) headers.Authorization = `Bearer ${memToken}`;

      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          preset,
          targetCountry,
          history: historyPayload,
          message: trimmed,
        }),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(typeof errData.error === 'string' ? errData.error : 'Unable to reach AI advisor.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data:')) continue;
          const payload = JSON.parse(line.slice(5).trim()) as { chunk?: string; done?: boolean; model?: string; error?: string };
          if (payload.error) {
            throw new Error(payload.error);
          }
          if (payload.chunk) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + payload.chunk } : m))
            );
          }
          if (payload.done && payload.model) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, modelLabel: payload.model } : m))
            );
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate response.');
      setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.text)));
    } finally {
      setStreaming(false);
    }
  };

  const toggleRecording = async () => {
    setError('');
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 256) return;

        setTranscribing(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = String(reader.result || '');
              const idx = result.indexOf(',');
              resolve(idx >= 0 ? result.slice(idx + 1) : result);
            };
            reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
            reader.readAsDataURL(blob);
          });

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'AbroadConnect',
          };
          const memToken = getInMemoryToken();
          if (memToken) headers.Authorization = `Bearer ${memToken}`;

          const res = await fetch('/api/v1/ai/transcribe', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ audioBase64: base64, mimeType }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(typeof data.error === 'string' ? data.error : 'Transcription failed.');
          }
          if (data.transcript) {
            setInput((prev) => (prev ? `${prev} ${data.transcript}` : data.transcript));
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unable to transcribe audio.');
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone permission is required to record voice questions.');
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-[#2563EB]" />
            <span>AI Abroad Advisor & Voice Assistant</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Multi-turn guidance with role specialization and voice-to-text transcription. Always confirm official rules on government portals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Target country focus"
            value={targetCountry}
            onChange={(e) => setTargetCountry(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium"
          >
            {countries.map((c) => (
              <option key={c.slug} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              setMessages([
                {
                  id: 'welcome',
                  role: 'model',
                  text: 'Started a fresh session. Select an advisor role and ask your question below.',
                },
              ])
            }
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Chat</span>
          </button>
        </div>
      </div>

      {/* Role Preset Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={`text-left rounded-xl border p-3.5 transition-colors ${
              preset === p.id
                ? 'border-[#2563EB] bg-blue-50/60 dark:bg-blue-950/30'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-slate-300'
            }`}
          >
            <p className="text-xs font-semibold text-[#0F172A] dark:text-white">{p.label}</p>
            <p className="text-[11px] text-slate-500 mt-1">{p.desc}</p>
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Scrollable Multi-Turn Conversation */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col h-[480px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[82%] rounded-xl px-4 py-3 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-[#142B5F] text-white dark:bg-[#2563EB]'
                    : 'bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {m.text || (streaming ? 'Thinking...' : '')}
              </div>
            </div>
          ))}
          <div ref={threadEndRef} />
        </div>

        <form onSubmit={sendMessage} className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={streaming || transcribing}
            title={recording ? 'Stop recording' : 'Record voice question'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold border transition-colors shrink-0 ${
              recording
                ? 'bg-red-600 text-white border-red-600'
                : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            <span className="hidden sm:inline">
              {recording ? 'Stop' : transcribing ? 'Transcribing...' : 'Voice'}
            </span>
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${PRESETS.find((p) => p.id === preset)?.label}...`}
            disabled={streaming}
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />

          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white disabled:opacity-50 shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>{streaming ? 'Sending...' : 'Send'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
