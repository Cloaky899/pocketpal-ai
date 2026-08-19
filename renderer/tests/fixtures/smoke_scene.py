from manim import *


class SmokeScene(Scene):
    def construct(self):
        title = Text("PocketPal Manim").to_edge(UP)
        circle = Circle(color=BLUE)
        square = Square(color=YELLOW)
        self.play(Write(title), run_time=0.5)
        self.play(Create(circle), run_time=0.5)
        self.play(Transform(circle, square), run_time=0.5)
        self.wait(0.5)
