import random

from .game_models import db, GameConfig, Level


def seed_default_game_config() -> GameConfig:
    config = GameConfig.query.first()
    if config is not None:
        return config

    config = GameConfig(
        grid_size=8,
        candy_types=5,
        base_score_per_candy=10,
        combo_bonus_per_combo=15,
        cascade_bonus_per_cascade=25,
        max_combo_multiplier=6,
        scoring_rules_json="{}",
    )
    db.session.add(config)
    db.session.commit()
    return config


def seed_levels(start_level: int = 1, end_level: int = 100) -> None:
    config = seed_default_game_config()

    existing_count = Level.query.count()
    if existing_count > 0:
        # If levels already exist, don't stomp them unless asked by reset.
        return

    for level_number in range(start_level, end_level + 1):
        difficulty = 1 + (level_number - 1) // 10

        # Time scaling: starts generous, tightens over time.
        time_limit_seconds = max(15, int(70 - level_number * 0.4 - (level_number // 25) * 6))

        # Mix objective types across the campaign.
        if level_number <= 50:
            objective_clear = 20 + level_number * 2
            target_score = 0
        else:
            objective_clear = 0
            target_score = 2500 + (level_number - 50) * 180

        blocker_count = min(22, int(level_number * 0.16))
        locked_candy_count = min(16, int(level_number * 0.085))
        locked_candy_health = 2 if level_number < 70 else 3

        pattern_seed = level_number * 1337 + config.candy_types * 91

        lvl = Level(
            level_number=level_number,
            time_limit_seconds=time_limit_seconds,
            target_score=int(target_score),
            objective_clear=int(objective_clear),
            difficulty=int(difficulty),
            blocker_count=blocker_count,
            locked_candy_count=locked_candy_count,
            locked_candy_health=locked_candy_health,
            pattern_seed=pattern_seed,
        )
        db.session.add(lvl)

    db.session.commit()


def reset_levels() -> None:
    # Clear and reseed everything (config remains).
    Level.query.delete()
    db.session.commit()
    seed_levels(1, 100)


def ensure_all_levels_exist() -> None:
    config = seed_default_game_config()
    _ = config
    existing = {lvl.level_number for lvl in Level.query.all()}
    missing = [i for i in range(1, 101) if i not in existing]
    if not missing:
        return

    for level_number in missing:
        # Generate the same default scaling used by seed_levels.
        difficulty = 1 + (level_number - 1) // 10
        time_limit_seconds = max(15, int(70 - level_number * 0.4 - (level_number // 25) * 6))
        if level_number <= 50:
            objective_clear = 20 + level_number * 2
            target_score = 0
        else:
            objective_clear = 0
            target_score = 2500 + (level_number - 50) * 180

        blocker_count = min(22, int(level_number * 0.16))
        locked_candy_count = min(16, int(level_number * 0.085))
        locked_candy_health = 2 if level_number < 70 else 3
        pattern_seed = level_number * 1337 + config.candy_types * 91

        lvl = Level(
            level_number=level_number,
            time_limit_seconds=time_limit_seconds,
            target_score=int(target_score),
            objective_clear=int(objective_clear),
            difficulty=int(difficulty),
            blocker_count=blocker_count,
            locked_candy_count=locked_candy_count,
            locked_candy_health=locked_candy_health,
            pattern_seed=pattern_seed,
        )
        db.session.add(lvl)

    db.session.commit()

