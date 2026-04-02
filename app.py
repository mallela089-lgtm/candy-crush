import os

from flask import Flask

from models import db
from models.seed_data import ensure_all_levels_exist, reset_levels, seed_default_game_config, seed_levels
from routes.admin_routes import admin_bp
from routes.game_routes import game_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    # SQLite is enough for this project and keeps the backend lightweight.
    instance_dir = os.path.join(os.path.dirname(__file__), "instance")
    os.makedirs(instance_dir, exist_ok=True)
    db_path = os.path.join(instance_dir, "candy_crush.db")

    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    with app.app_context():
        db.create_all()
        seed_default_game_config()
        seed_levels(1, 100)
        ensure_all_levels_exist()

    app.register_blueprint(game_bp)
    app.register_blueprint(admin_bp)

    return app


app = create_app()


if __name__ == "__main__":
    # For local development only.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)

