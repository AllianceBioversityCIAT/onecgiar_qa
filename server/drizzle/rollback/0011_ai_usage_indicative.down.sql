-- Manual down script for 0011_ai_usage_indicative (ai-suggestions, contract 2.0.0).
-- Applied by a human, never by drizzle-kit or by an agent. Take a backup first.
-- It fails while any row has ai_signal = 'indicative': delete or keep those rows
-- consciously before running it (they are usage of the indicative AI fields).
ALTER TABLE `ai_suggestion_usage` MODIFY COLUMN `ai_signal` enum('green','amber','red') NOT NULL;
