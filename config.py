"""
FIROO CAM - Configuration Manager
All settings are stored in config.json and can be changed anytime.
"""

import json
import os
from pathlib import Path

# ── مسیر اصلی پروژه ──────────────────────────────────────────
BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"

# ── تنظیمات پیش‌فرض ──────────────────────────────────────────
DEFAULT_CONFIG = {

    # زبان
    "language": "fa",  # fa | ar | en

    # ابعاد شیت MDF
    "sheet": {
        "width": 2800,       # میلیمتر
        "height": 1220,      # میلیمتر
        "thickness": 18,     # میلیمتر
        "material": "MDF"
    },

    # تنظیمات نستینگ
    "nesting": {
        "edge_margin": 10,       # فاصله از لبه شیت (mm)
        "part_gap": 8,           # فاصله بین قطعات (mm)
        "auto_rotation": True,   # چرخش خودکار 90 درجه
        "respect_grain": False   # جهت الیاف (برای MDF خام: False)
    },

    # تنظیمات ابزار و ماشین
    "machine": {
        "safe_z": 15,        # ارتفاع ایمن (mm)
        "home_z": 50,        # ارتفاع home (mm)
        "spindle_rpm": 18000,
        "feed_rate": 3000,   # mm/min
        "plunge_rate": 800   # mm/min
    },

    # تنظیمات G-code
    "gcode": {
        "format": "tap",         # tap | nc | gc | cnc
        "origin": "(0,0)",       # (0,0) | (X,Y) | (0,Y) | (X,0)
        "units": "mm",           # mm | inch
        "tool_change": "manual"  # manual | atc
    },

    # پوشه خروجی
    "output": {
        "folder": str(BASE_DIR / "output"),
        "dxf": True,
        "gcode": True,
        "report": True
    },

    # مسیر CAMotics
    "camotics_path": "C:/Program Files/CAMotics/CAMotics.exe",

    # ذخیره خودکار
    "autosave": {
        "enabled": True,
        "interval_minutes": 5
    },

    # نمایش
    "ui": {
        "theme": "dark",
        "font_size": "medium",  # small | medium | large
        "show_grid": True,
        "show_labels": True,
        "show_dimensions": True
    }
}


class ConfigManager:
    """مدیریت تنظیمات نرم‌افزار"""

    def __init__(self):
        self._config = {}
        self.load()

    def load(self):
        """بارگذاری تنظیمات از فایل"""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                # ادغام با تنظیمات پیش‌فرض
                self._config = self._merge(DEFAULT_CONFIG, saved)
            except Exception as e:
                print(f"[Config] خطا در بارگذاری: {e} — از پیش‌فرض استفاده می‌شود")
                self._config = DEFAULT_CONFIG.copy()
        else:
            self._config = DEFAULT_CONFIG.copy()
            self.save()

    def save(self):
        """ذخیره تنظیمات در فایل"""
        try:
            CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self._config, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[Config] خطا در ذخیره: {e}")

    def get(self, *keys, default=None):
        """دریافت مقدار تنظیم"""
        val = self._config
        for key in keys:
            if isinstance(val, dict):
                val = val.get(key, default)
            else:
                return default
        return val

    def set(self, value, *keys):
        """تغییر مقدار تنظیم"""
        d = self._config
        for key in keys[:-1]:
            d = d.setdefault(key, {})
        d[keys[-1]] = value
        self.save()

    def reset(self):
        """بازگشت به تنظیمات پیش‌فرض"""
        self._config = DEFAULT_CONFIG.copy()
        self.save()

    def _merge(self, default, saved):
        """ادغام هوشمند تنظیمات"""
        result = default.copy()
        for key, value in saved.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge(result[key], value)
            else:
                result[key] = value
        return result

    # ── Shortcuts پرکاربرد ────────────────────────────────────

    @property
    def sheet_width(self):
        return self.get("sheet", "width")

    @property
    def sheet_height(self):
        return self.get("sheet", "height")

    @property
    def part_gap(self):
        return self.get("nesting", "part_gap")

    @property
    def edge_margin(self):
        return self.get("nesting", "edge_margin")

    @property
    def safe_z(self):
        return self.get("machine", "safe_z")

    @property
    def gcode_format(self):
        return self.get("gcode", "format")

    @property
    def language(self):
        return self.get("language")

    @property
    def output_folder(self):
        folder = self.get("output", "folder")
        Path(folder).mkdir(parents=True, exist_ok=True)
        return folder


# ── instance global ───────────────────────────────────────────
config = ConfigManager()


# ── تست ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 40)
    print("FIROO CAM - Config Manager")
    print("=" * 40)
    print(f"زبان:          {config.language}")
    print(f"ابعاد شیت:     {config.sheet_width} × {config.sheet_height} mm")
    print(f"فاصله قطعات:   {config.part_gap} mm")
    print(f"فاصله لبه:     {config.edge_margin} mm")
    print(f"Safe Z:        {config.safe_z} mm")
    print(f"فرمت G-code:   {config.gcode_format}")
    print(f"پوشه خروجی:    {config.output_folder}")
    print("=" * 40)
    print("✅ Config Manager آماده است")
