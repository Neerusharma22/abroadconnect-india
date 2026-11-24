import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured in server secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export type AdvisorPreset = 'visa' | 'strategy' | 'guide' | 'checklist';

interface PresetConfig {
  model: string;
  thinkingLevel?: ThinkingLevel;
  systemInstruction: string;
}

const PRESET_MAP: Record<AdvisorPreset, PresetConfig> = {
  visa: {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.XHIGH,
    systemInstruction:
      'You are the AbroadConnect India Visa & Documentation Advisor. Give clear, realistic, scam-aware guidance for Indian students, apprentices, and professionals preparing applications abroad. Always remind users to verify current visa rules, blocked-account amounts, and deadlines on official embassy/consulate portals, and never promise visa approvals or legal representation. Structure responses cleanly with actionable next steps.',
  },
  strategy: {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.HIGH,
    systemInstruction:
      'You are the AbroadConnect India Career & University Strategist. Help Indian applicants compare university programs, German Ausbildung/apprenticeships, scholarships, tuition, and post-study work pathways realistically. Highlight official portal verification and transparent cost planning.',
  },
  guide: {
    model: 'gemini-4-hydrogen',
    systemInstruction:
      'You are the AbroadConnect India Peer Community Guide. Answer questions about student life, accommodation safety, city communities, language exams (IELTS, TestDaF, JLPT), and anti-scam awareness in a warm, grounded, concise tone.',
  },
  checklist: {
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.MINIMAL,
    systemInstruction:
      'You are the AbroadConnect India Quick Checklist Helper. Provide crisp, scannable checklists and concise answers in under 200 words for immediate preparation steps.',
  },
};

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export async function streamAdvisorChat(params: {
  preset: AdvisorPreset;
  targetCountry?: string;
  history: ChatTurn[];
  message: string;
  onChunk: (text: string) => void;
}): Promise<{ model: string }> {
  const ai = getGenAIClient();
  const cfg = PRESET_MAP[params.preset] || PRESET_MAP.guide;
  const countryNote = params.targetCountry
    ? ` Current user focus country: ${params.targetCountry}.`
    : '';

  const formattedHistory = params.history
    .filter((t) => t.text.trim().length > 0)
    .slice(-16)
    .map((t) => ({
      role: t.role,
      parts: [{ text: t.text }],
    }));

  const chat = ai.chats.create({
    model: cfg.model,
    history: formattedHistory,
    config: {
      systemInstruction: `${cfg.systemInstruction}${countryNote}`,
      ...(cfg.thinkingLevel
        ? { thinkingConfig: { thinkingLevel: cfg.thinkingLevel } }
        : {}),
    },
  });

  const stream = await chat.sendMessageStream({
    message: params.message,
  });

  for await (const chunk of stream) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      params.onChunk(c.text);
    }
  }

  return { model: cfg.model };
}

export async function transcribeUserAudio(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const ai = getGenAIClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.audioBase64,
          },
        },
        {
          text: 'Transcribe this audio accurately. Return only the spoken text.',
        },
      ],
    },
  });

  return (response.text ?? '').trim();
}
