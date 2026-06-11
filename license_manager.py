"""
FIROO CAM - License Manager
HWID-based software protection.
Generates machine fingerprint from CPU+Motherboard+MAC.
License key format: FIROO-XXXX-XXXX-XXXX-XXXX
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import platform
import struct
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Tuple

# ── Secret (change before release) ───────────────────────────
_SECRET = b"FIROO_CAM_2026_LICENSE_SECRET_KEY_CHANGE_ME"
_APP_ID = "FIROO_CAM_V1"


# ═══════════════════════════════════════════════════════════════
# Hardware Fingerprint
# ═══════════════════════════════════════════════════════════════
def _get_hwid_components() -> Dict[str, str]:
    """Collect hardware identifiers."""
    components = {}

    # MAC address (most reliable cross-platform)
    try:
        mac = uuid.getnode()
        components["mac"] = hex(mac)
    except Exception:
        components["mac"] = "unknown_mac"

    # Platform
    components["platform"] = platform.system()
    components["machine"]  = platform.machine()

    # Windows: CPU + Motherboard via registry
    if platform.system() == "Windows":
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            components["cpu"] = winreg.QueryValueEx(
                key, "ProcessorNameString")[0]
            winreg.CloseKey(key)
        except Exception:
            components["cpu"] = platform.processor()

        try:
            import subprocess
            result = subprocess.run(
                ["wmic", "baseboard", "get", "serialnumber"],
                capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in result.stdout.split("\n")
                     if l.strip() and l.strip() != "SerialNumber"]
            components["motherboard"] = lines[0] if lines else "unknown"
        except Exception:
            components["motherboard"] = "unknown_mb"
    else:
        # Linux/Mac
        components["cpu"] = platform.processor() or "unknown_cpu"
        components["motherboard"] = "cross_platform"

    return components


def get_hwid() -> str:
    """
    Generate a stable hardware ID.
    Returns 32-char hex string.
    """
    parts = _get_hwid_components()
    raw   = "|".join(sorted(
        f"{k}:{v}" for k, v in parts.items()))
    return hashlib.sha256(raw.encode()).hexdigest()


# ═══════════════════════════════════════════════════════════════
# License Key Generator / Validator
# ═══════════════════════════════════════════════════════════════
class LicenseEngine:
    """
    Generates and validates FIROO CAM license keys.

    Key format: FIROO-XXXX-XXXX-XXXX-XXXX  (20 chars + 4 dashes)
    Encodes: HWID hash + expiry date + features + checksum
    """

    TRIAL_DAYS   = 30
    VERSION      = 1

    @staticmethod
    def _encode_b32(data: bytes) -> str:
        """Encode bytes to base32 string (uppercase, no padding)."""
        import base64
        return base64.b32encode(data).decode().replace("=", "")

    @staticmethod
    def _decode_b32(s: str) -> bytes:
        """Decode base32 string to bytes."""
        import base64
        # Pad to multiple of 8
        s = s.upper().strip()
        padding = (8 - len(s) % 8) % 8
        try:
            return base64.b32decode(s + "=" * padding)
        except Exception:
            return b""

    def generate(self, hwid: str,
                 days: int = 365,
                 features: int = 0xFF) -> str:
        """
        Generate a license key for the given HWID.
        features bitmask: bit0=nesting, bit1=gcode, bit2=export, ...
        """
        # 4 bytes: HWID fingerprint (first 4 bytes of SHA256)
        hwid_bytes = bytes.fromhex(hwid[:8])

        # 4 bytes: expiry (unix timestamp / 86400 = day number)
        expiry_day = (int(time.time()) // 86400) + days
        exp_bytes  = struct.pack(">I", expiry_day)

        # 1 byte: version + features
        feat_byte  = bytes([self.VERSION << 4 | (features & 0x0F)])

        payload = hwid_bytes + exp_bytes + feat_byte

        # 7 bytes: HMAC-SHA256 truncated
        sig    = hmac.new(_SECRET,
                           payload + hwid.encode(),
                           hashlib.sha256).digest()[:7]

        raw    = payload + sig          # 16 bytes total
        enc    = self._encode_b32(raw)  # 26 chars
        enc    = enc[:26].upper()

        # Format: FIROO-XXXXXX-XXXXXX-XXXXXX-XXXXXXXX
        key    = (f"FIROO-{enc[0:6]}-{enc[6:12]}"
                  f"-{enc[12:18]}-{enc[18:26]}")
        return key

    def validate(self, key: str, hwid: str) -> Dict:
        """
        Validate a license key against the current HWID.
        Returns: {valid, error, expiry_date, days_left, features}
        """
        result = {
            "valid":       False,
            "error":       None,
            "expiry_date": None,
            "days_left":   0,
            "features":    0,
        }

        # Clean key — remove prefix and dashes
        clean = key.upper().replace(" ","")
        if clean.startswith("FIROO-"):
            clean = clean[6:]
        clean = clean.replace("-","")

        if len(clean) < 21:
            result["error"] = f"Invalid key format (too short: {len(clean)})"
            return result

        try:
            raw   = self._decode_b32(clean[:26])
            if len(raw) < 16:
                result["error"] = "Key too short"
                return result

            payload    = raw[:9]
            sig_stored = raw[9:16]

            # Verify HMAC
            sig_calc = hmac.new(_SECRET,
                                  payload + hwid.encode(),
                                  hashlib.sha256).digest()[:7]
            if not hmac.compare_digest(sig_stored, sig_calc):
                result["error"] = "Invalid key (signature mismatch)"
                return result

            # Check HWID match
            hwid_from_key = payload[:4].hex()
            hwid_short    = hwid[:8]
            if hwid_from_key != hwid_short:
                result["error"] = (
                    "Key not valid for this machine\n"
                    f"Expected: {hwid_short[:8].upper()}\n"
                    f"Got:      {hwid_from_key[:8].upper()}")
                return result

            # Check expiry
            expiry_day  = struct.unpack(">I", payload[4:8])[0]
            today_day   = int(time.time()) // 86400
            days_left   = expiry_day - today_day
            expiry_date = datetime.fromtimestamp(
                expiry_day * 86400).strftime("%Y-%m-%d")

            if days_left < 0:
                result["error"] = (
                    f"License expired on {expiry_date}")
                return result

            features = payload[8] & 0x0F

            result.update({
                "valid":       True,
                "expiry_date": expiry_date,
                "days_left":   days_left,
                "features":    features,
            })

        except Exception as e:
            result["error"] = f"Validation error: {e}"

        return result


# ═══════════════════════════════════════════════════════════════
# License File Manager
# ═══════════════════════════════════════════════════════════════
class LicenseManager:
    """
    Manages the license file on disk and provides
    high-level check / activate / status API.
    """

    LICENSE_FILE = "license.lic"
    TRIAL_FILE   = "trial.dat"

    def __init__(self, app_dir: str = None):
        self._dir    = Path(app_dir or Path(__file__).parent)
        self._engine = LicenseEngine()
        self._hwid   = get_hwid()
        self._status: Optional[Dict] = None

    @property
    def hwid(self) -> str:
        return self._hwid

    @property
    def hwid_display(self) -> str:
        """User-friendly HWID display: XXXX-XXXX-XXXX-XXXX"""
        h = self._hwid.upper()[:16]
        return f"{h[0:4]}-{h[4:8]}-{h[8:12]}-{h[12:16]}"

    # ── Check ─────────────────────────────────────────────────
    def check(self) -> Dict:
        """
        Full license check. Returns status dict.
        Priority: full license > trial > expired/not found
        """
        # 1. Full license
        lic_path = self._dir / self.LICENSE_FILE
        if lic_path.exists():
            try:
                with open(lic_path, encoding="utf-8") as f:
                    data = json.load(f)
                key    = data.get("key","")
                result = self._engine.validate(key, self._hwid)
                if result["valid"]:
                    result["mode"] = "full"
                    result["key"]  = key
                    self._status   = result
                    return result
                else:
                    # Key invalid — fall through to trial
                    pass
            except Exception:
                pass

        # 2. Trial
        trial = self._check_trial()
        if trial["valid"]:
            self._status = trial
            return trial

        # 3. No valid license
        self._status = {
            "valid":   False,
            "mode":    "none",
            "error":   "No valid license found",
            "days_left": 0,
        }
        return self._status

    def _check_trial(self) -> Dict:
        trial_path = self._dir / self.TRIAL_FILE
        today      = int(time.time()) // 86400

        if not trial_path.exists():
            # First run — start trial
            data = {
                "start_day": today,
                "hwid":      self._hwid[:16],
            }
            try:
                with open(trial_path, "w") as f:
                    json.dump(data, f)
            except Exception:
                pass

        try:
            with open(trial_path, encoding="utf-8") as f:
                data = json.load(f)
            start_day = data.get("start_day", today)
            # Verify HWID hasn't changed
            if data.get("hwid","") != self._hwid[:16]:
                return {"valid": False, "mode": "trial",
                        "error": "Trial HWID mismatch"}
            days_used = today - start_day
            days_left = LicenseEngine.TRIAL_DAYS - days_used
            if days_left > 0:
                expiry = datetime.fromtimestamp(
                    (start_day + LicenseEngine.TRIAL_DAYS)
                    * 86400).strftime("%Y-%m-%d")
                return {
                    "valid":       True,
                    "mode":        "trial",
                    "days_left":   days_left,
                    "expiry_date": expiry,
                    "features":    0xFF,
                    "error":       None,
                }
            else:
                return {
                    "valid":   False,
                    "mode":    "trial_expired",
                    "error":   f"Trial expired ({abs(days_left)} days ago)",
                    "days_left": days_left,
                }
        except Exception as e:
            return {"valid": False, "mode": "trial",
                    "error": str(e)}

    # ── Activate ──────────────────────────────────────────────
    def activate(self, key: str) -> Dict:
        result = self._engine.validate(key, self._hwid)
        if result["valid"]:
            lic_path = self._dir / self.LICENSE_FILE
            try:
                with open(lic_path, "w", encoding="utf-8") as f:
                    json.dump({
                        "key":        key,
                        "activated":  datetime.now().isoformat(),
                        "hwid_short": self.hwid_display,
                    }, f, indent=2)
                result["mode"] = "full"
                self._status   = result
            except Exception as e:
                result["valid"] = False
                result["error"] = f"Cannot save license: {e}"
        return result

    def deactivate(self):
        lic_path = self._dir / self.LICENSE_FILE
        if lic_path.exists():
            lic_path.unlink()
        self._status = None

    @property
    def is_valid(self) -> bool:
        if not self._status:
            self.check()
        return self._status.get("valid", False)

    @property
    def status(self) -> Dict:
        if not self._status:
            self.check()
        return self._status


# ═══════════════════════════════════════════════════════════════
# Activation Dialog
# ═══════════════════════════════════════════════════════════════
try:
    from PySide6.QtCore    import Qt, Signal
    from PySide6.QtGui     import QColor, QFont
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout,
        QLabel, QPushButton, QLineEdit,
        QFrame, QDialog, QApplication,
        QMessageBox, QGroupBox, QFormLayout
    )

    C_BG    = "#1e1e1e"; C_PANEL = "#252526"
    C_BORD  = "#3e3e42"; C_TEXT  = "#cccccc"
    C_DIM   = "#858585"; C_ACC   = "#0078d4"
    C_GOOD  = "#4ec9b0"; C_WARN  = "#ce9178"

    class ActivationDialog(QDialog):
        """
        License activation / status dialog.
        Shows HWID, trial status, activation input.
        """
        activated = Signal()

        def __init__(self, manager: LicenseManager, parent=None):
            super().__init__(parent)
            self._mgr = manager
            self.setWindowTitle("FIROO CAM — License")
            self.setModal(True)
            self.setFixedSize(460, 380)
            self._build()
            self._apply_style()
            self._refresh()

        def _build(self):
            lay = QVBoxLayout(self)
            lay.setSpacing(12)

            # Header
            hdr = QLabel("🔑  FIROO CAM License")
            hdr.setStyleSheet(
                f"color:{C_TEXT};font-size:16px;"
                f"font-weight:700;")
            lay.addWidget(hdr)

            # Current status
            self._grp_status = QGroupBox("License Status")
            gs = QFormLayout(self._grp_status)
            gs.setSpacing(6)
            self._lbl_mode    = QLabel("—")
            self._lbl_expiry  = QLabel("—")
            self._lbl_days    = QLabel("—")
            self._lbl_error   = QLabel("")
            self._lbl_error.setStyleSheet(
                f"color:{C_WARN};font-size:11px;")
            self._lbl_error.setWordWrap(True)
            for l in [self._lbl_mode, self._lbl_expiry,
                      self._lbl_days]:
                l.setStyleSheet(
                    f"color:{C_TEXT};font-weight:600;")
            gs.addRow("Mode:",    self._lbl_mode)
            gs.addRow("Expiry:",  self._lbl_expiry)
            gs.addRow("Days left:", self._lbl_days)
            gs.addRow("",         self._lbl_error)
            lay.addWidget(self._grp_status)

            # HWID
            grp2 = QGroupBox("Machine ID")
            g2   = QVBoxLayout(grp2)
            hwid_row = QHBoxLayout()
            self._lbl_hwid = QLabel(
                self._mgr.hwid_display)
            self._lbl_hwid.setStyleSheet(
                f"color:{C_ACC};font-size:13px;"
                f"font-weight:700;font-family:Consolas,monospace;")
            self._btn_copy = QPushButton("Copy")
            self._btn_copy.setFixedWidth(60)
            self._btn_copy.setFixedHeight(26)
            self._btn_copy.clicked.connect(self._copy_hwid)
            hwid_row.addWidget(self._lbl_hwid)
            hwid_row.addWidget(self._btn_copy)
            g2.addLayout(hwid_row)
            lbl_hint = QLabel(
                "Send this ID to receive your license key")
            lbl_hint.setStyleSheet(
                f"color:{C_DIM};font-size:11px;")
            g2.addWidget(lbl_hint)
            lay.addWidget(grp2)

            # Activation input
            grp3 = QGroupBox("Enter License Key")
            g3   = QVBoxLayout(grp3)
            self._key_input = QLineEdit()
            self._key_input.setPlaceholderText(
                "FIROO-XXXX-XXXX-XXXX-XXXX")
            self._key_input.setFixedHeight(32)
            self._key_input.setStyleSheet(
                f"font-family:Consolas,monospace;"
                f"font-size:13px;letter-spacing:1px;")
            g3.addWidget(self._key_input)

            btn_row = QHBoxLayout()
            self._btn_activate = QPushButton("Activate")
            self._btn_deact    = QPushButton("Deactivate")
            self._btn_activate.setFixedHeight(32)
            self._btn_deact.setFixedHeight(32)
            self._btn_activate.setStyleSheet(
                "background:#1a5c2a;border:1px solid #27ae60;"
                "border-radius:3px;color:white;font-weight:600;")
            btn_row.addWidget(self._btn_activate)
            btn_row.addWidget(self._btn_deact)
            g3.addLayout(btn_row)
            lay.addWidget(grp3)

            # Close
            self._btn_close = QPushButton("Close")
            self._btn_close.setFixedHeight(30)
            self._btn_close.clicked.connect(self.accept)
            lay.addWidget(self._btn_close)

            self._btn_activate.clicked.connect(self._activate)
            self._btn_deact.clicked.connect(self._deactivate)

        def _refresh(self):
            st = self._mgr.check()
            mode = st.get("mode","none")
            mode_labels = {
                "full":          "✅  Full License",
                "trial":         "🕐  Trial",
                "trial_expired": "❌  Trial Expired",
                "none":          "❌  No License",
            }
            mode_colors = {
                "full": C_GOOD, "trial": "#f39c12",
                "trial_expired": C_WARN, "none": C_WARN
            }
            self._lbl_mode.setText(
                mode_labels.get(mode, mode))
            self._lbl_mode.setStyleSheet(
                f"color:{mode_colors.get(mode, C_TEXT)};"
                f"font-weight:700;")
            self._lbl_expiry.setText(
                st.get("expiry_date","—"))
            dl = st.get("days_left",0)
            self._lbl_days.setText(
                f"{dl} days" if dl > 0 else "Expired")
            err = st.get("error","")
            self._lbl_error.setText(err or "")

        def _activate(self):
            key = self._key_input.text().strip()
            if not key:
                QMessageBox.warning(
                    self,"No Key","Enter a license key.")
                return
            result = self._mgr.activate(key)
            if result["valid"]:
                self._refresh()
                QMessageBox.information(
                    self,"Activation Successful",
                    f"License activated!\n"
                    f"Valid until: {result['expiry_date']}\n"
                    f"Days remaining: {result['days_left']}")
                self.activated.emit()
            else:
                QMessageBox.critical(
                    self,"Activation Failed",
                    result.get("error","Invalid key"))

        def _deactivate(self):
            ans = QMessageBox.question(
                self,"Deactivate",
                "Remove license from this machine?",
                QMessageBox.Yes | QMessageBox.No)
            if ans == QMessageBox.Yes:
                self._mgr.deactivate()
                self._refresh()

        def _copy_hwid(self):
            from PySide6.QtWidgets import QApplication
            QApplication.clipboard().setText(
                self._mgr.hwid_display)
            self._btn_copy.setText("Copied!")
            from PySide6.QtCore import QTimer
            QTimer.singleShot(
                2000, lambda: self._btn_copy.setText("Copy"))

        def _apply_style(self):
            self.setStyleSheet(f"""
            QDialog,QWidget{{background:{C_BG};
                color:{C_TEXT};
                font-family:"Segoe UI",sans-serif;
                font-size:12px;}}
            QGroupBox{{background:transparent;
                border:1px solid {C_BORD};
                border-radius:3px;margin-top:6px;
                padding-top:6px;color:{C_DIM};
                font-size:11px;font-weight:600;}}
            QGroupBox::title{{subcontrol-origin:margin;
                left:6px;padding:0 3px;}}
            QPushButton{{background:{C_PANEL};
                border:1px solid {C_BORD};
                border-radius:3px;padding:3px 10px;
                color:{C_TEXT};}}
            QPushButton:hover{{background:#3e3e42;
                border-color:{C_ACC};}}
            QLineEdit{{background:#1a1a1a;
                border:1px solid {C_BORD};
                border-radius:3px;padding:2px 8px;
                color:{C_TEXT};}}
            QLineEdit:focus{{border-color:{C_ACC};}}
            """)

    HAS_QT = True

except ImportError:
    HAS_QT = False


# ═══════════════════════════════════════════════════════════════
# Test / CLI
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import sys

    print("FIROO CAM — License Manager Test")
    print("="*50)

    mgr = LicenseManager("/tmp/firoo_test")
    print(f"HWID:         {mgr.hwid}")
    print(f"HWID Display: {mgr.hwid_display}")

    # Generate a test key
    engine  = LicenseEngine()
    hwid    = mgr.hwid
    key_365 = engine.generate(hwid, days=365)
    key_30  = engine.generate(hwid, days=30)
    key_bad = engine.generate("0"*64, days=365)

    print(f"\n365-day key: {key_365}")
    print(f" 30-day key: {key_30}")
    print(f"  Wrong key: {key_bad}")

    # Validate
    print(f"\nValidation tests:")
    for k, desc in [(key_365,"365-day"),
                    (key_30, "30-day"),
                    (key_bad,"wrong HWID")]:
        r = engine.validate(k, hwid)
        status = (f"✅ valid — {r['days_left']} days"
                  if r["valid"] else f"❌ {r['error']}")
        print(f"  {desc:12}: {status}")

    # Activate
    status = mgr.check()
    print(f"\nCurrent status: {status}")

    result = mgr.activate(key_365)
    print(f"After activate: valid={result['valid']}")

    if "--gui" in sys.argv and HAS_QT:
        from PySide6.QtWidgets import QApplication
        app = QApplication(sys.argv)
        dlg = ActivationDialog(mgr)
        dlg.exec()
