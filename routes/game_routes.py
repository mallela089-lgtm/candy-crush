from flask import Blueprint, jsonify, render_template, request

from models import GameConfig, GameStat, Level, db
from models.seed_data import ensure_all_levels_exist, seed_default_game_config

game_bp = Blueprint("game", __name__)


@game_bp.route("/", methods=["GET"])
def index():
    # The frontend requests level/config on-demand.
    return render_template("index.html")


@game_bp.route("/level/<int:level_number>", methods=["GET"])
def get_level(level_number: int):
    ensure_all_levels_exist()
    level = Level.query.filter_by(level_number=level_number).first()
    if level is None:
        return jsonify({"error": "Level not found"}), 404

    config = seed_default_game_config()
    return jsonify(
        {
            "level": level.to_public_dict(config=config),
            "config": config.to_public_dict(),
        }
    )


@game_bp.route("/score", methods=["POST"])
def submit_score():
    payload = request.get_json(silent=True) or {}
    level_number = int(payload.get("level_number", 0))
    score = int(payload.get("score", 0))
    completed = bool(payload.get("completed", False))

    ensure_all_levels_exist()

    if level_number <= 0:
        return jsonify({"ok": False, "error": "Invalid level_number"}), 400

    stat = GameStat.query.filter_by(level_number=level_number).first()
    if stat is None:
        stat = GameStat(level_number=level_number, attempts=0, completions=0, best_score=0)
        db.session.add(stat)

    stat.attempts += 1
    if completed:
        stat.completions += 1
        if score > stat.best_score:
            stat.best_score = score

    stat.last_played_at = stat.last_played_at  # updated_at handles ordering
    db.session.commit()
    return jsonify({"ok": True})

