-- Read accuracy per paper (owner, 7 Nov 2026): how well the AIs read a paper by themselves, kept from its first full
-- reading and never changed by later fixes. first_items: question parts read; first_clean: parts with no flag
-- (figure boxes do not count); first_red: red (wording) flags. The colour is worked out in code (paperScore).
ALTER TABLE paper_read ADD COLUMN first_items INTEGER;
ALTER TABLE paper_read ADD COLUMN first_clean INTEGER;
ALTER TABLE paper_read ADD COLUMN first_red INTEGER;
ALTER TABLE paper_read ADD COLUMN first_at INTEGER;
