import json
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class GameConfig(db.Model):
    __tablename__ = "game_config"

    id = db.Column(db.Integer, primary_key=True)
    # Core sizing
    grid_size = db.Column(db.Integer, nullable=False, default=8)
    candy_types = db.Column(db.Integer, nullable=False, default=5)

    # Scoring / difficulty tuning (kept simple but editable from admin)
    base_score_per_candy = db.Column(db.Integer, nullable=False, default=10)
    combo_bonus_per_combo = db.Column(db.Integer, nullable=False, default=10)
    cascade_bonus_per_cascade = db.Column(db.Integer, nullable=False, default=25)
    # Multiplier that caps at a reasonable value (to prevent runaway scores)
    max_combo_multiplier = db.Column(db.Integer, nullable=False, default=5)

    # JSON blob for future extensions
    scoring_rules_json = db.Column(db.Text, nullable=False, default="{}")

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_public_dict(self) -> dict:
        return {
            "grid_size": self.grid_size,
            "candy_types": self.candy_types,
            "scoring": {
                "base_score_per_candy": self.base_score_per_candy,
                "combo_bonus_per_combo": self.combo_bonus_per_combo,
                "cascade_bonus_per_cascade": self.cascade_bonus_per_cascade,
                "max_combo_multiplier": self.max_combo_multiplier,
            },
            "scoring_rules": json.loads(self.scoring_rules_json or "{}"),
        }


class Level(db.Model):
    __tablename__ = "levels"

    id = db.Column(db.Integer, primary_key=True)
    level_number = db.Column(db.Integer, nullable=False, unique=True, index=True)

    # Objective: use either target_score or objective_clear (or both)
    time_limit_seconds = db.Column(db.Integer, nullable=False, default=60)
    target_score = db.Column(db.Integer, nullable=False, default=0)
    objective_clear = db.Column(db.Integer, nullable=False, default=0)

    # Difficulty scaling parameters used by the frontend to generate blockers/locked candies.
    difficulty = db.Column(db.Integer, nullable=False, default=1)
    blocker_count = db.Column(db.Integer, nullable=False, default=0)
    locked_candy_count = db.Column(db.Integer, nullable=False, default=0)
    locked_candy_health = db.Column(db.Integer, nullable=False, default=2)

    # Layout/pattern tuning
    pattern_seed = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_public_dict(self, config: GameConfig | None = None) -> dict:
        return {
            "id": self.id,
            "level_number": self.level_number,
            "time_limit_seconds": self.time_limit_seconds,
            "target_score": self.target_score,
            "objective_clear": self.objective_clear,
            "difficulty": self.difficulty,
            "blocker_count": self.blocker_count,
            "locked_candy_count": self.locked_candy_count,
            "locked_candy_health": self.locked_candy_health,
            "pattern_seed": self.pattern_seed,
            "grid_size": (config.grid_size if config else None),
        }


class GameStat(db.Model):
    __tablename__ = "game_stats"

    id = db.Column(db.Integer, primary_key=True)
    level_number = db.Column(db.Integer, nullable=False, index=True)

    attempts = db.Column(db.Integer, nullable=False, default=0)
    completions = db.Column(db.Integer, nullable=False, default=0)
    best_score = db.Column(db.Integer, nullable=False, default=0)
    last_played_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_public_dict(self) -> dict:
        return {
            "level_number": self.level_number,
            "attempts": self.attempts,
            "completions": self.completions,
            "best_score": self.best_score,
            "last_played_at": self.last_played_at.isoformat(),
        }

