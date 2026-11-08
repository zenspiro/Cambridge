-- Claude Haiku 5.5's price for the AI usage dashboard and the monthly cap (owner, 8 Nov 2026: trying a cheaper model
-- for reading papers). US dollars per million tokens from Anthropic's list (October 2026): 0.10 in, 0.50 out for
-- prompts up to 100,000 tokens (a paper reading is about 40,000); longer prompts cost 0.50 and 2.50. Added only when
-- the admin has not set a Haiku price already, so a typed price wins.
UPDATE setting
SET value = json_set(value, '$."claude-haiku-5-5"', json('{"in":0.1,"out":0.5}'))
WHERE key = 'ai_prices' AND json_valid(value) AND json_extract(value, '$."claude-haiku-5-5"') IS NULL;
