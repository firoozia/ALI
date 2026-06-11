"""
FIROO CAM - Design Resolver
Maps part.design_code → .fdr file path.

Supports:
  cd1  → designs/cd1.fdr
  1    → designs/cd1.fdr
  101  → designs/cd1.fdr
  CD1  → designs/cd1.fdr  (case insensitive)

Usage:
    from design_resolver import DesignResolver
    resolver = DesignResolver()
    fdr_path = resolver.resolve("cd1")   # returns Path or None
    design   = resolver.load("cd1")      # returns DesignData or None
"""
from __future__ import annotations
import sys
from pathlib import Path
from typing import Optional, Dict


def _designs_dir() -> Path:
    """
    Always resolve relative to this file's parent.
    Works in both Python mode and PyInstaller EXE mode.
    """
    if getattr(sys, "frozen", False):
        # PyInstaller EXE
        base = Path(sys.executable).parent
    else:
        base = Path(__file__).parent
    return base / "designs"


class DesignResolver:
    """
    Resolves design_code strings to .fdr file paths.
    Caches the directory listing for speed.
    """

    _FDR_EXT   = ".fdr"
    _JSON_EXT  = ".json"

    def __init__(self, designs_dir: str = None):
        self._dir    = Path(designs_dir) if designs_dir else _designs_dir()
        self._cache: Dict[str, Path] = {}
        self._scan()

    def _scan(self):
        """Index all .fdr and .json design files in designs dir."""
        self._cache = {}
        if not self._dir.exists():
            print(f"[DesignResolver] designs dir not found: {self._dir}")
            return
        for p in self._dir.iterdir():
            if p.suffix.lower() not in (self._FDR_EXT, self._JSON_EXT):
                continue
            stem = p.stem.lower()
            # Skip index/metadata files
            if stem.startswith("_") or stem in ("index", "readme"):
                continue
            # Only index files that look like designs: cd1, cd12, or pure numbers
            if stem.startswith("cd") or stem.isdigit():
                self._cache[stem] = p
        print(f"[DesignResolver] Indexed {len(self._cache)} designs in {self._dir}")

    def _normalize(self, code: str) -> str:
        """
        Normalize design_code to lookup key:
          "CD1"  → "cd1"
          "1"    → "cd1"
          "101"  → "cd1"   (strip leading "10" prefix)
          "102"  → "cd2"
          "1012" → "cd12"
          "cd7"  → "cd7"
        """
        if not code:
            return ""
        code = str(code).strip().lower()

        # Already in cd-form: cd1, cd12
        if code.startswith("cd"):
            return code

        # Pure number
        if code.isdigit():
            n = int(code)
            # Numbers with leading "10" prefix: 101→cd1, 102→cd2, 1012→cd12
            # Only strip if result key exists or number > 100
            if n > 100:
                # Try stripping first two digits if they are "10"
                s = str(n)
                if s.startswith("10") and len(s) >= 3:
                    tail = s[2:]
                    if tail.isdigit() and int(tail) > 0:
                        return f"cd{int(tail)}"
            return f"cd{n}"

        return code

    def resolve(self, design_code: str) -> Optional[Path]:
        """Return Path to .fdr file, or None if not found."""
        key = self._normalize(design_code)
        if not key:
            return None
        # Direct lookup
        if key in self._cache:
            return self._cache[key]
        # Refresh cache and retry (in case files were added)
        self._scan()
        return self._cache.get(key)

    def load(self, design_code: str, width: float = None, height: float = None):
        """
        Load DesignData for the given code.
        Optionally resize to (width, height) if provided.
        Returns DesignData or None.
        """
        try:
            from design_editor import DesignData
        except ImportError as e:
            print(f"[DesignResolver] Cannot import DesignData: {e}")
            return None

        path = self.resolve(design_code)
        if path is None:
            print(f"[DesignResolver] Design not found: '{design_code}'")
            return None

        design = DesignData.load(str(path))
        if design is None:
            print(f"[DesignResolver] Failed to load: {path}")
            return None

        if width is not None and height is not None:
            design.width  = float(width)
            design.height = float(height)

        return design

    def exists(self, design_code: str) -> bool:
        """Return True if the design file exists."""
        return self.resolve(design_code) is not None

    def all_codes(self):
        """Return list of all available design codes."""
        return sorted(self._cache.keys())

    def validate(self, design_code: str) -> tuple:
        """
        Validate design_code.
        Returns (is_valid: bool, message: str)
        """
        if not design_code or design_code.strip() in ("", "cd0", "0"):
            return False, "No design assigned"
        if self.exists(design_code):
            path = self.resolve(design_code)
            return True, f"OK — {path.name}"
        return False, f"Design '{design_code}' not found"


# ── Module-level singleton ────────────────────────────────────
_resolver: Optional[DesignResolver] = None


def get_resolver() -> DesignResolver:
    global _resolver
    if _resolver is None:
        _resolver = DesignResolver()
    return _resolver


def resolve(design_code: str) -> Optional[Path]:
    return get_resolver().resolve(design_code)


def load_design(design_code: str, width: float = None, height: float = None):
    return get_resolver().load(design_code, width, height)


def design_exists(design_code: str) -> bool:
    return get_resolver().exists(design_code)


# ── Test ──────────────────────────────────────────────────────
if __name__ == "__main__":
    r = DesignResolver()
    print(f"Available designs: {r.all_codes()[:10]}")
    for test in ["cd1", "1", "101", "CD7", "cd90", "999"]:
        ok, msg = r.validate(test)
        sym = "✅" if ok else "❌"
        print(f"  {sym}  '{test}' → {msg}")
