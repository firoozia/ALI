"""
FIROO CAM - Language Manager
Handles locale loading, RTL/LTR switching, string formatting.
"""

import json
from pathlib import Path
from typing import Any, Optional

# ── Paths ────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
LOCALES_DIR = BASE_DIR / "locales"

SUPPORTED_LANGUAGES = {
    "en": {"name": "English",   "native": "English",  "direction": "ltr"},
    "fa": {"name": "Persian",   "native": "فارسی",    "direction": "rtl"},
    "ar": {"name": "Arabic",    "native": "العربية",  "direction": "rtl"},
}

_FALLBACK_LANG = "en"


class LanguageManager:
    """
    Singleton language manager.
    Usage:
        from language_manager import lang
        lang.set("fa")
        title = lang.t("nesting.title")
        msg   = lang.t("nesting.status_done", sheets=3, util=87.5)
    """

    _instance: Optional["LanguageManager"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._code      = _FALLBACK_LANG
        self._strings   = {}
        self._fallback  = {}
        self._callbacks = []   # listeners notified on language change
        self._load(_FALLBACK_LANG)
        self._fallback  = dict(self._strings)   # keep EN as fallback

    # ── Public API ────────────────────────────────────────────

    def set(self, code: str) -> bool:
        """Switch language. Returns True on success."""
        code = code.lower().strip()
        if code not in SUPPORTED_LANGUAGES:
            print(f"[Lang] Unsupported language: {code}")
            return False
        if code == self._code:
            return True
        if code != _FALLBACK_LANG:
            ok = self._load(code)
            if not ok:
                return False
        else:
            self._strings = dict(self._fallback)
        self._code = code
        self._notify()
        return True

    def t(self, key: str, **kwargs) -> str:
        """
        Translate a dot-separated key, with optional format args.
        Example: lang.t("nesting.status_done", sheets=3, util=87.5)
        Falls back to English, then returns the key itself.
        """
        raw = self._lookup(key, self._strings)
        if raw is None:
            raw = self._lookup(key, self._fallback)
        if raw is None:
            return key   # last resort: return the key
        if not kwargs:
            return raw
        try:
            return raw.format(**kwargs)
        except (KeyError, ValueError):
            return raw

    def tr(self, key: str, **kwargs) -> str:
        """Alias for t() — shorter name."""
        return self.t(key, **kwargs)

    @property
    def code(self) -> str:
        """Current language code (e.g. 'fa')."""
        return self._code

    @property
    def direction(self) -> str:
        """'ltr' or 'rtl'."""
        return SUPPORTED_LANGUAGES.get(self._code, {}).get("direction", "ltr")

    @property
    def is_rtl(self) -> bool:
        return self.direction == "rtl"

    @property
    def native_name(self) -> str:
        return SUPPORTED_LANGUAGES.get(self._code, {}).get("native", self._code)

    @property
    def language_name(self) -> str:
        return SUPPORTED_LANGUAGES.get(self._code, {}).get("name", self._code)

    def available_languages(self) -> list:
        """Return list of dicts with code/name/native/direction."""
        result = []
        for code, meta in SUPPORTED_LANGUAGES.items():
            locale_file = LOCALES_DIR / f"{code}.json"
            result.append({
                "code":      code,
                "name":      meta["name"],
                "native":    meta["native"],
                "direction": meta["direction"],
                "available": locale_file.exists(),
            })
        return result

    def on_change(self, callback):
        """Register a callback(code, direction) to fire on language switch."""
        self._callbacks.append(callback)

    def remove_change_handler(self, callback):
        self._callbacks = [c for c in self._callbacks if c is not callback]

    # ── PySide6 helpers ───────────────────────────────────────

    def apply_to_widget(self, widget):
        """
        Call after language change to flip layout direction on a QWidget.
        Import Qt lazily to keep this module usable without PySide6.
        """
        try:
            from PySide6.QtCore import Qt
            if self.is_rtl:
                widget.setLayoutDirection(Qt.RightToLeft)
            else:
                widget.setLayoutDirection(Qt.LeftToRight)
        except ImportError:
            pass

    def qt_layout_direction(self):
        """Return Qt.LayoutDirection for current language (requires PySide6)."""
        try:
            from PySide6.QtCore import Qt
            return Qt.RightToLeft if self.is_rtl else Qt.LeftToRight
        except ImportError:
            return None

    # ── Internal ──────────────────────────────────────────────

    def _load(self, code: str) -> bool:
        path = LOCALES_DIR / f"{code}.json"
        if not path.exists():
            print(f"[Lang] Locale file not found: {path}")
            return False
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._strings = self._flatten(data)
            return True
        except Exception as e:
            print(f"[Lang] Error loading {path}: {e}")
            return False

    @staticmethod
    def _flatten(d: dict, prefix: str = "") -> dict:
        """
        Recursively flatten nested dict to dot-key dict.
        {"nesting": {"title": "2D Nesting"}} → {"nesting.title": "2D Nesting"}
        Skips the _meta block.
        """
        out = {}
        for k, v in d.items():
            if k == "_meta":
                continue
            full_key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                out.update(LanguageManager._flatten(v, full_key))
            else:
                out[full_key] = v
        return out

    @staticmethod
    def _lookup(key: str, strings: dict) -> Optional[str]:
        return strings.get(key)

    def _notify(self):
        for cb in self._callbacks:
            try:
                cb(self._code, self.direction)
            except Exception as e:
                print(f"[Lang] Callback error: {e}")


# ── Singleton ─────────────────────────────────────────────────
lang = LanguageManager()


# ── Auto-sync with config ──────────────────────────────────────
def init_from_config():
    """Call once at startup to sync language from config.json."""
    try:
        from config import config
        saved_lang = config.language
        if saved_lang and saved_lang != lang.code:
            lang.set(saved_lang)
    except Exception as e:
        print(f"[Lang] Could not sync with config: {e}")


# ── Test ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("FIROO CAM - Language Manager")
    print("=" * 55)

    def on_lang_change(code, direction):
        print(f"  → Language changed: {code} ({direction})")

    lang.on_change(on_lang_change)

    print("\nAvailable languages:")
    for ln in lang.available_languages():
        status = "✅" if ln["available"] else "❌"
        print(f"  {status} {ln['code']:4} {ln['native']:12} ({ln['direction']})")

    print("\n── English ──────────────────────────────────────────")
    lang.set("en")
    print(f"  App name    : {lang.t('app.name')}")
    print(f"  Nesting tab : {lang.t('tabs.nesting')}")
    print(f"  Status done : {lang.t('nesting.status_done', sheets=3, util=87.5)}")
    print(f"  RTL?        : {lang.is_rtl}")

    print("\n── فارسی ────────────────────────────────────────────")
    lang.set("fa")
    print(f"  App name    : {lang.t('app.name')}")
    print(f"  Nesting tab : {lang.t('tabs.nesting')}")
    print(f"  Status done : {lang.t('nesting.status_done', sheets=3, util=87.5)}")
    print(f"  RTL?        : {lang.is_rtl}")

    print("\n── العربية ──────────────────────────────────────────")
    lang.set("ar")
    print(f"  App name    : {lang.t('app.name')}")
    print(f"  Nesting tab : {lang.t('tabs.nesting')}")
    print(f"  Status done : {lang.t('nesting.status_done', sheets=3, util=87.5)}")
    print(f"  RTL?        : {lang.is_rtl}")

    print("\n── Fallback test ────────────────────────────────────")
    lang.set("fa")
    result = lang.t("nonexistent.key.test")
    print(f"  Missing key returns: '{result}'")

    print("\n✅ Language Manager OK")
