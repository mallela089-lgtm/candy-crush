from flask import Blueprint, jsonify, render_template, request

from models import GameConfig, GameStat, Level, db
from models.seed_data import ensure_all_levels_exist, reset_levels, seed_default_game_config

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


@admin_bp.route("", methods=["GET"])
def dashboard():
    ensure_all_levels_exist()
    cfg = seed_default_game_config()
    levels_count = Level.query.count()
    return render_template("admin.html", levels_count=levels_count, config=cfg.to_public_dict())


# ----------------------------
# Level CRUD APIs
# ----------------------------
@admin_bp.route("/api/levels", methods=["GET"])
def list_levels():
    ensure_all_levels_exist()
    levels = Level.query.order_by(Level.level_number.asc()).all()
    return jsonify({"levels": [l.to_public_dict() for l in levels]})


@admin_bp.route("/api/levels/<int:level_id>", methods=["GET"])
def get_level(level_id: int):
    level = Level.query.get(level_id)
    if level is None:
        return jsonify({"error": "Level not found"}), 404
    return jsonify({"level": level.to_public_dict()})


def _parse_int(payload: dict, key: str, default: int) -> int:
    val = payload.get(key, default)
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


@admin_bp.route("/api/levels", methods=["POST"])
def create_level():
    payload = request.get_json(silent=True) or {}
    level_number = _parse_int(payload, "level_number", 1)

    if Level.query.filter_by(level_number=level_number).first() is not None:
        return jsonify({"error": "level_number already exists"}), 409

    lvl = Level(
        level_number=level_number,
        time_limit_seconds=_parse_int(payload, "time_limit_seconds", 60),
        target_score=_parse_int(payload, "target_score", 0),
        objective_clear=_parse_int(payload, "objective_clear", 0),
        difficulty=_parse_int(payload, "difficulty", 1),
        blocker_count=_parse_int(payload, "blocker_count", 0),
        locked_candy_count=_parse_int(payload, "locked_candy_count", 0),
        locked_candy_health=_parse_int(payload, "locked_candy_health", 2),
        pattern_seed=_parse_int(payload, "pattern_seed", level_number * 1337),
    )
    db.session.add(lvl)
    db.session.commit()
    return jsonify({"ok": True, "level": lvl.to_public_dict()})


@admin_bp.route("/api/levels/<int:level_id>", methods=["PUT"])
def update_level(level_id: int):
    lvl = Level.query.get(level_id)
    if lvl is None:
        return jsonify({"error": "Level not found"}), 404

    payload = request.get_json(silent=True) or {}
    # Update only known fields
    if "level_number" in payload:
        lvl.level_number = _parse_int(payload, "level_number", lvl.level_number)
    if "time_limit_seconds" in payload:
        lvl.time_limit_seconds = _parse_int(payload, "time_limit_seconds", lvl.time_limit_seconds)
    if "target_score" in payload:
        lvl.target_score = _parse_int(payload, "target_score", lvl.target_score)
    if "objective_clear" in payload:
        lvl.objective_clear = _parse_int(payload, "objective_clear", lvl.objective_clear)
    if "difficulty" in payload:
        lvl.difficulty = _parse_int(payload, "difficulty", lvl.difficulty)
    if "blocker_count" in payload:
        lvl.blocker_count = _parse_int(payload, "blocker_count", lvl.blocker_count)
    if "locked_candy_count" in payload:
        lvl.locked_candy_count = _parse_int(payload, "locked_candy_count", lvl.locked_candy_count)
    if "locked_candy_health" in payload:
        lvl.locked_candy_health = _parse_int(payload, "locked_candy_health", lvl.locked_candy_health)
    if "pattern_seed" in payload:
        lvl.pattern_seed = _parse_int(payload, "pattern_seed", lvl.pattern_seed)

    db.session.commit()
    return jsonify({"ok": True, "level": lvl.to_public_dict()})


@admin_bp.route("/api/levels/<int:level_id>", methods=["DELETE"])
def delete_level(level_id: int):
    lvl = Level.query.get(level_id)
    if lvl is None:
        return jsonify({"error": "Level not found"}), 404
    db.session.delete(lvl)
    db.session.commit()
    return jsonify({"ok": True})


# ----------------------------
# Game Config APIs
# ----------------------------
@admin_bp.route("/api/config", methods=["GET"])
def get_config():
    cfg = seed_default_game_config()
    return jsonify({"config": cfg.to_public_dict()})


@admin_bp.route("/api/config", methods=["PUT"])
def update_config():
    payload = request.get_json(silent=True) or {}
    cfg = seed_default_game_config()

    if "grid_size" in payload:
        cfg.grid_size = _parse_int(payload, "grid_size", cfg.grid_size)
    if "candy_types" in payload:
        cfg.candy_types = _parse_int(payload, "candy_types", cfg.candy_types)
    if "base_score_per_candy" in payload:
        cfg.base_score_per_candy = _parse_int(payload, "base_score_per_candy", cfg.base_score_per_candy)
    if "combo_bonus_per_combo" in payload:
        cfg.combo_bonus_per_combo = _parse_int(payload, "combo_bonus_per_combo", cfg.combo_bonus_per_combo)
    if "cascade_bonus_per_cascade" in payload:
        cfg.cascade_bonus_per_cascade = _parse_int(payload, "cascade_bonus_per_cascade", cfg.cascade_bonus_per_cascade)
    if "max_combo_multiplier" in payload:
        cfg.max_combo_multiplier = _parse_int(payload, "max_combo_multiplier", cfg.max_combo_multiplier)
    if "scoring_rules_json" in payload:
        cfg.scoring_rules_json = str(payload.get("scoring_rules_json", cfg.scoring_rules_json))

    db.session.commit()
    return jsonify({"ok": True, "config": cfg.to_public_dict()})


# ----------------------------
# Analytics + Data Management
# ----------------------------
@admin_bp.route("/api/stats", methods=["GET"])
def stats():
    ensure_all_levels_exist()
    total_plays = sum(s.attempts for s in GameStat.query.all())
    levels = Level.query.count()
    completion_rate_by_level = []
    for lvl in Level.query.order_by(Level.level_number.asc()).all():
        stat = GameStat.query.filter_by(level_number=lvl.level_number).first()
        attempts = stat.attempts if stat else 0
        completions = stat.completions if stat else 0
        completion_rate_by_level.append(
            {
                "level_number": lvl.level_number,
                "attempts": attempts,
                "completions": completions,
                "completion_rate": (completions / attempts) if attempts > 0 else None,
            }
        )
    return jsonify(
        {
            "total_plays": total_plays,
            "levels": levels,
            "completion_rate_by_level": completion_rate_by_level,
        }
    )


@admin_bp.route("/api/reset", methods=["POST"])
def reset_all():
    # Reset only levels (not stats) per requirement.
    reset_levels()
    return jsonify({"ok": True})

