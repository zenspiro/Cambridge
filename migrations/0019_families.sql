-- Families (Phase 1 step 4, owner decisions 5 Nov 2026): one parent per family, no second guardian, a child in one
-- family. Children join with a family code, by being approved by that parent, or by the parent creating their
-- account. Deleting the parent removes the family (the children's own accounts stay); deleting a child removes
-- their membership. Built so a family plan can point at family.id later.

CREATE TABLE family (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT NOT NULL UNIQUE REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE family_child (
  family_id TEXT NOT NULL REFERENCES family (id) ON DELETE CASCADE,
  child_id  TEXT NOT NULL UNIQUE REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  how       TEXT NOT NULL CHECK (how IN ('code', 'approved', 'created')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, child_id)
);

-- One live code per family. Kept readable so the parent can see it again; it only lets a signed-in student ask to
-- join, expires, and joins are rate limited.
CREATE TABLE family_code (
  family_id  TEXT PRIMARY KEY REFERENCES family (id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- An approval links the child to that parent's family once; a parent who later removes the child is not overruled.
ALTER TABLE parent_consent ADD COLUMN linked_at INTEGER;
