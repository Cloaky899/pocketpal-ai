import unittest

from app.policy import ProgramPolicyError, validate_source


SAFE_SOURCE = """from manim import *

class DemoScene(Scene):
    def construct(self):
        title = Text('Demo').to_edge(UP)
        self.play(Write(title), run_time=0.5)
        self.wait(0.5)
"""


class PolicyTests(unittest.TestCase):
    def test_accepts_simple_manim_scene(self) -> None:
        result = validate_source(SAFE_SOURCE)
        self.assertEqual(result.scene_names, ["DemoScene"])
        self.assertEqual(result.imports, ["manim"])

    def test_rejects_forbidden_import(self) -> None:
        with self.assertRaisesRegex(ProgramPolicyError, "import is not allowed"):
            validate_source("import os\n\nclass DemoScene(Scene):\n    pass\n")

    def test_rejects_unsafe_execution_primitive(self) -> None:
        with self.assertRaisesRegex(ProgramPolicyError, "execution primitive"):
            validate_source(
                "from manim import *\n\nclass DemoScene(Scene):\n    def construct(self):\n        eval('1 + 1')\n"
            )

    def test_requires_a_scene(self) -> None:
        with self.assertRaisesRegex(ProgramPolicyError, "at least one"):
            validate_source("from manim import *\nvalue = 1\n")


if __name__ == "__main__":
    unittest.main()
