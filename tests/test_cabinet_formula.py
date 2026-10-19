import math

import pytest

from cabinet import formula
from cabinet.formula import FormulaError


def test_basic_arithmetic():
    v = {"W": 800, "t": 16}
    assert formula.evaluate("W-2*t", v) == 768
    assert formula.evaluate("(W-(doors+1)*g)/doors", {"W": 800, "doors": 2, "g": 3}) == pytest.approx((800 - 3 * 3) / 2)


def test_caret_is_power_and_funcs():
    assert formula.evaluate("2^3", {}) == 8
    assert formula.evaluate("sqrt(16)", {}) == 4
    assert formula.evaluate("max(3, 5, 1)", {}) == 5
    assert formula.evaluate("round(397.5)", {}) in (397, 398)  # banker's rounding ok


def test_number_passthrough():
    assert formula.evaluate(560, {}) == 560.0
    assert formula.evaluate(6, {}) == 6.0


def test_divide_by_zero_raises():
    with pytest.raises(FormulaError):
        formula.evaluate("W/doors", {"W": 800, "doors": 0})


def test_unknown_variable_raises():
    with pytest.raises(FormulaError):
        formula.evaluate("W-2*t", {"W": 800})  # t missing


def test_bad_syntax_raises():
    with pytest.raises(FormulaError):
        formula.evaluate("W-*2", {"W": 800})


def test_no_code_execution():
    with pytest.raises(FormulaError):
        formula.evaluate("__import__('os').system('echo hi')", {})
    with pytest.raises(FormulaError):
        formula.evaluate("open('x')", {})


def test_trace_is_readable():
    v = {"W": 800, "t": 16}
    assert formula.trace("W-2*t", v) == "W-2*t = 800-2*16 = 768"
    # a plain number traces to just the value
    assert formula.trace(560, v) == "560"
