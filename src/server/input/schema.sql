-- Main table
CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  size INTEGER,
  ratings REAL,
  complexity REAL,
  min_players INTEGER,
  max_players INTEGER,
  min_players_rec INTEGER,
  max_players_rec INTEGER,
  min_players_best INTEGER,
  max_players_best INTEGER,
  min_time INTEGER,
  max_time INTEGER,
  year INTEGER,
  lon REAL,
  lat REAL
);

-- Normalized tag table with TYPE
CREATE TABLE game_tags (
  game_id INTEGER NOT NULL,
  tag INTEGER NOT NULL,
  tag_type TEXT NOT NULL CHECK(tag_type IN ('category','mechanic','family')),
  FOREIGN KEY (game_id) REFERENCES games(id)
);

-- Indexes
CREATE INDEX idx_ratings ON games(ratings);
CREATE INDEX idx_complexity ON games(complexity);
CREATE INDEX idx_year ON games(year);
CREATE INDEX idx_min_players ON games(min_players);
CREATE INDEX idx_max_players ON games(max_players);
CREATE INDEX idx_min_time ON games(min_time);
CREATE INDEX idx_max_time ON games(max_time);

CREATE INDEX idx_tag_type ON game_tags(tag_type);
CREATE INDEX idx_tag_value ON game_tags(tag);
CREATE INDEX idx_tag_combo ON game_tags(tag_type, tag);
CREATE INDEX idx_game_tag ON game_tags(game_id);
