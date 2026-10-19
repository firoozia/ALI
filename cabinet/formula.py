"""Safe arithmetic formula evaluator for cabinet part dimensions.

Formulas are small expressions over named variables, e.g. ``"W-2*t"`` or
``"(W-(doors+1)*g)/doors"``. Evaluation is done with a whitelisted AST walk
(never ``eval``), so a template cannot run arbitrary code. Unlike the CutClick
engine we analysed, division by zero and unknown variables raise a clear error
instead of silently returning 0.

Supported: + - * / // % ** (and ^ as power), unary +/-, parentheses, numbers,
variables, and the functions max, min, sqrt, round, abs, ceil, floor.
"""
from __future__ import annotations

import ast
import math
import operator
import re
from typing import Mapping

__all__ = ["FormulaError", "evaluate", "trace"]


class FormulaError(ValueError):
    """A formula cannot be parsed or evaluated (bad syntax, unknown variable,
    division by zero, or an unsupported construct)."""


_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_FUNCS = {
    "max": max,
    "min": min,
    "sqrt": math.sqrt,
    "round": round,
    "abs": abs,
    "ceil": math.ceil,
    "floor": math.floor,
}


def evaluate(expr, variables: Mapping[str, float]) -> float:
    """Evaluate ``expr`` (a number or a formula string) against ``variables``.

    Raises :class:`FormulaError` on any problem.
    """
    if isinstance(expr, bool):  # guard: bool is an int subclass
        return float(int(expr))
    if isinstance(expr, (int, float)):
        return float(expr)
    text = str(expr).strip()
    if text == "":
        raise FormulaError("empty formula")
    # Accept the woodworking-style caret as power.
    text = text.replace("^", "**")
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as exc:
        raise FormulaError(f"bad formula {expr!r}: {exc.msg}") from exc
    return float(_eval(tree.body, variables, expr))


def _eval(node: ast.AST, v: Mapping[str, float], src) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise FormulaError(f"bad value in {src!r}: {node.value!r}")
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id in v:
            return float(v[node.id])
        raise FormulaError(f"unknown variable {node.id!r} in {src!r}")
    if isinstance(node, ast.BinOp):
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise FormulaError(f"operator not allowed in {src!r}")
        left = _eval(node.left, v, src)
        right = _eval(node.right, v, src)
        if op in (operator.truediv, operator.floordiv, operator.mod) and right == 0:
            raise FormulaError(f"division by zero in {src!r}")
        return op(left, right)
    if isinstance(node, ast.UnaryOp):
        if isinstance(node.op, ast.UAdd):
            return +_eval(node.operand, v, src)
        if isinstance(node.op, ast.USub):
            return -_eval(node.operand, v, src)
        raise FormulaError(f"unary operator not allowed in {src!r}")
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCS:
            raise FormulaError(f"function not allowed in {src!r}")
        if node.keywords:
            raise FormulaError(f"keyword args not allowed in {src!r}")
        args = [_eval(a, v, src) for a in node.args]
        try:
            return float(_FUNCS[node.func.id](*args))
        except (ValueError, TypeError) as exc:
            raise FormulaError(f"bad call in {src!r}: {exc}") from exc
    raise FormulaError(f"unsupported expression in {src!r}")


_IDENT = re.compile(r"[A-Za-z_]\w*")


def trace(expr, variables: Mapping[str, float]) -> str:
    """Return a human-readable "formula = substituted = result" string for the
    build-reason report, e.g. ``"W-2*t = 800-2*16 = 768"``.

    Functions (max/min/...) are left as names in the substituted form.
    """
    result = evaluate(expr, variables)
    if isinstance(expr, (int, float)) and not isinstance(expr, bool):
        return _fmt(result)
    text = str(expr).strip()

    def sub(m: "re.Match[str]") -> str:
        name = m.group(0)
        if name in _FUNCS:
            return name
        if name in variables:
            return _fmt(float(variables[name]))
        return name

    substituted = _IDENT.sub(sub, text)
    norm = substituted.replace(" ", "")
    # Nothing substituted, or it collapsed straight to the value: show once.
    if norm == text.replace(" ", "") or norm == _fmt(result):
        return f"{text} = {_fmt(result)}"
    return f"{text} = {substituted} = {_fmt(result)}"


def _fmt(x: float) -> str:
    """Trim trailing zeros so 768.0 prints as 768 and 397.5 stays 397.5."""
    if x == int(x):
        return str(int(x))
    return f"{x:.3f}".rstrip("0").rstrip(".")
