// Tests never call a real model: server/ai/models.ts returns mock models when AI_MOCK=1.
process.env.AI_MOCK ??= '1';
