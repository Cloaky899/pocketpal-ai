from __future__ import annotations

import ast
from dataclasses import dataclass

ALLOWED_IMPORT_ROOTS = {"manim", "numpy", "scipy", "typing", "math", "random"}
FORBIDDEN_NAMES = {
    "__import__",
    "eval",
    "exec",
    "compile",
    "open",
    "breakpoint",
}
FORBIDDEN_MODULE_ROOTS = {
    "os",
    "subprocess",
    "socket",
    "pathlib",
    "shutil",
    "requests",
    "urllib",
    "httpx",
    "sys",
}
SCENE_BASES = {
    "Scene",
    "ThreeDScene",
    "MovingCameraScene",
    "ZoomedScene",
    "LinearTransformationScene",
    "VectorScene",
}


@dataclass(frozen=True)
class PolicyResult:
    scene_names: list[str]
    imports: list[str]


class ProgramPolicyError(ValueError):
    pass


def _module_root(name: str) -> str:
    return name.split(".", 1)[0]


def validate_source(source: str) -> PolicyResult:
    if len(source.encode("utf-8")) > 250_000:
        raise ProgramPolicyError("source exceeds the 250 KB policy limit")
    try:
        tree = ast.parse(source, filename="video.py", mode="exec")
    except SyntaxError as exc:
        raise ProgramPolicyError(f"syntax error at line {exc.lineno}: {exc.msg}") from exc

    imports: list[str] = []
    scene_names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
                root = _module_root(alias.name)
                if root in FORBIDDEN_MODULE_ROOTS or root not in ALLOWED_IMPORT_ROOTS:
                    raise ProgramPolicyError(f"import is not allowed: {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            imports.append(module)
            root = _module_root(module)
            if root in FORBIDDEN_MODULE_ROOTS or root not in ALLOWED_IMPORT_ROOTS:
                raise ProgramPolicyError(f"import is not allowed: {module}")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            raise ProgramPolicyError(f"execution primitive is not allowed: {node.id}")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if isinstance(node.func.value, ast.Name) and node.func.value.id in {
                "os",
                "subprocess",
                "socket",
                "shutil",
                "pathlib",
            }:
                raise ProgramPolicyError(f"system call is not allowed: {node.func.value.id}.{node.func.attr}")
        elif isinstance(node, ast.ClassDef):
            if any(isinstance(base, ast.Name) and base.id in SCENE_BASES for base in node.bases):
                scene_names.append(node.name)

    if not scene_names:
        raise ProgramPolicyError("source must define at least one supported Manim Scene subclass")
    if len(scene_names) > 12:
        raise ProgramPolicyError("source may define at most 12 scenes")
    return PolicyResult(scene_names=scene_names, imports=imports)
