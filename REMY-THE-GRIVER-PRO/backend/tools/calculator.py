"""Safe AST-based mathematical evaluator and unit converter (never uses raw eval)."""
from __future__ import annotations

import ast
import math
import operator
from typing import Any

_BINARY_OPS: dict[type[ast.operator], Any] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_UNARY_OPS: dict[type[ast.unaryop], Any] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

_SAFE_FUNCS: dict[str, Any] = {
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "log10": math.log10,
    "abs": abs,
    "round": round,
    "floor": math.floor,
    "ceil": math.ceil,
}

_SAFE_CONSTS: dict[str, float] = {
    "pi": math.pi,
    "e": math.e,
}

_UNIT_FACTORS: dict[str, tuple[str, float]] = {
    # length -> meter
    "m": ("length", 1.0),
    "km": ("length", 1000.0),
    "cm": ("length", 0.01),
    "mm": ("length", 0.001),
    "mi": ("length", 1609.344),
    "ft": ("length", 0.3048),
    # mass -> gram
    "g": ("mass", 1.0),
    "kg": ("mass", 1000.0),
    "mg": ("mass", 0.001),
    "lb": ("mass", 453.59237),
    # data -> byte
    "b": ("data", 1.0),
    "kb": ("data", 1024.0),
    "mb": ("data", 1024.0 ** 2),
    "gb": ("data", 1024.0 ** 3),
    "tb": ("data", 1024.0 ** 4),
}


def safe_calculate(expression: str) -> float:
    cleaned = expression.strip()
    if not cleaned or len(cleaned) > 200:
        raise ValueError("Expression must be between 1 and 200 characters.")
    tree = ast.parse(cleaned, mode="eval")
    result = _eval_node(tree.body)
    return float(result)


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return float(node.value)
    if isinstance(node, ast.Name) and node.id in _SAFE_CONSTS:
        return _SAFE_CONSTS[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPS:
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("Exponent exceeds safe limit (100).")
        return float(_BINARY_OPS[type(node.op)](left, right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return float(_UNARY_OPS[type(node.op)](_eval_node(node.operand)))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _SAFE_FUNCS:
        if node.keywords:
            raise ValueError("Keyword arguments are not allowed in math expressions.")
        args = [_eval_node(a) for a in node.args]
        return float(_SAFE_FUNCS[node.func.id](*args))
    raise ValueError(f"Unsupported or unsafe syntax in expression: {ast.dump(node)}")


def convert_unit(value: float, from_unit: str, to_unit: str) -> float:
    u_from = from_unit.strip().lower()
    u_to = to_unit.strip().lower()

    if u_from in ("c", "f", "k") and u_to in ("c", "f", "k"):
        if u_from == "c":
            celsius = value
        elif u_from == "f":
            celsius = (value - 32.0) * 5.0 / 9.0
        else:
            celsius = value - 273.15
        if u_to == "c":
            return round(celsius, 4)
        if u_to == "f":
            return round(celsius * 9.0 / 5.0 + 32.0, 4)
        return round(celsius + 273.15, 4)

    if u_from not in _UNIT_FACTORS or u_to not in _UNIT_FACTORS:
        raise ValueError(f"Unsupported unit conversion: {from_unit} -> {to_unit}")
    cat_a, fac_a = _UNIT_FACTORS[u_from]
    cat_b, fac_b = _UNIT_FACTORS[u_to]
    if cat_a != cat_b:
        raise ValueError(f"Cannot convert {cat_a} ({from_unit}) to {cat_b} ({to_unit}).")
    return round((value * fac_a) / fac_b, 6)
