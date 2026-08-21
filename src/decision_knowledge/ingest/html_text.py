"""Small, deterministic HTML-fragment to text conversion."""

from html.parser import HTMLParser


class _FragmentTextParser(HTMLParser):
    _line_break_tags = frozenset({"br", "div", "li", "p", "section", "tr"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._line_break_tags:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._line_break_tags:
            self._parts.append("\n")

    def text(self) -> str:
        lines = (" ".join(line.split()) for line in "".join(self._parts).splitlines())
        return "\n".join(line for line in lines if line)


def html_fragment_to_text(fragment: str) -> str:
    parser = _FragmentTextParser()
    parser.feed(fragment)
    parser.close()
    return parser.text()
