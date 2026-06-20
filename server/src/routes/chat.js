/**
 * @file chat.js
 * @description REST route for the dashboard "Ask Claude" chat widget
 *   POST /api/chat — send a message, get a concise trading-assistant reply
 * @author SwingTrader AI Team
 */

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import Joi from 'joi';
import { validateBody } from '../middleware/validateRequest.js';
import { claudeRateLimiter } from '../middleware/rateLimiter.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const chatSchema = Joi.object({
  message: Joi.string().min(1).max(1000).required(),
  context: Joi.string().max(200).allow('').optional(),
});

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// POST /api/chat
router.post('/', claudeRateLimiter, validateBody(chatSchema), async (req, res, next) => {
  try {
    const { message, context } = req.body;

    const systemPrompt = [
      'You are SwingTrader AI — a helpful NSE swing trading assistant.',
      'Answer questions about Indian stock markets, trading strategies, technical analysis,',
      'and the signals this platform generates. Keep responses concise (2–4 sentences).',
      'Never recommend specific buy/sell decisions — only explain concepts and data.',
      context ? `Current context: ${context}.` : '',
    ].filter(Boolean).join(' ');

    const response = await getClient().messages.create({
      model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    });

    const reply = response.content[0]?.text ?? 'Sorry, I could not generate a response.';
    const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    logger.info('Chat response generated', { tokensUsed });
    res.json({ success: true, data: { reply, tokensUsed }, message: 'Chat response generated' });
  } catch (err) {
    logger.error('Chat route error', { error: err.message });
    next(err);
  }
});

export default router;
