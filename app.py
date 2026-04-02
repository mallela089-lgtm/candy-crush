import os

from flask import Flask

from models import db
from models.seed_data import ensure_all_levels_exist, reset_levels, seed_default_game_config, seed_levels
from routes.admin_routes import admin_bp
from routes.game_routes import game_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    # Render doesn't guarantee long-lived writable storage across restarts.
    # Let Render configure a SQLite file path via `SQLITE_DB_PATH`.
    # (Locally, we fall back to ./instance/candy_crush.db.)
    instance_dir = os.path.join(os.path.dirname(__file__), "instance")
    sqlite_db_path = os.environ.get("SQLITE_DB_PATH")
    if not sqlite_db_path:
        os.makedirs(instance_dir, exist_ok=True)
        sqlite_db_path = os.path.join(instance_dir, "candy_crush.db")

    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    else:
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{sqlite_db_path}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    # Avoid SQLite threading issues under gunicorn.
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite:///"):
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"connect_args": {"check_same_thread": False}}

    db.init_app(app)

    with app.app_context():
        db.create_all()
        seed_default_game_config()
        seed_levels(1, 100)
        ensure_all_levels_exist()

    app.register_blueprint(game_bp)
    app.register_blueprint(admin_bp)

    @app.route("/health", methods=["GET"])
    def health():
        return {"ok": True}

    return app


app = create_app()


if __name__ == "__main__":
    # For local development only.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)

