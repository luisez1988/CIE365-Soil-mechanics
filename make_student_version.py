import re
import shutil
from pathlib import Path


def transform_html(input_path: Path, output_path: Path,
                   figures_folder: str = "FiguresGeneral",
                   figures_dst_folder: str = None):
    """
    Transforms <object class='Animation' ... data='FiguresGeneral/x.svg'>
    into <img src='{figures_dst_folder}/x.svg'> in the HTML file.
    If figures_dst_folder is None, the original figures_folder name is kept.
    """
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()

    pattern = r'<object([^>]*?)class=["\']Animation["\']([^>]*)>(.*?)</object>'

    def to_img_tag(match):
        before_class = match.group(1)
        after_class  = match.group(2)
        all_attrs    = before_class + after_class

        data_match  = re.search(r'data=["\']([^"\']+)["\']',  all_attrs)
        style_match = re.search(r'style=["\']([^"\']+)["\']', all_attrs)

        src   = data_match.group(1)  if data_match  else ''
        style = style_match.group(1) if style_match else ''

        # Redirect to the appropriate figures folder
        target = figures_dst_folder if figures_dst_folder else figures_folder
        src = src.replace(figures_folder + '/', target + '/', 1)

        return f'<img src="{src}" style="{style}"/>'

    modified, count = re.subn(pattern, to_img_tag, content, flags=re.DOTALL | re.IGNORECASE)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(modified)

    print(f"  [HTML] Converted {count} Animation objects → <img> tags")


def comment_animate_elements_in_svg(svg_path: Path):
    """
    In an SVG file, comments out every element that has class="Animate".
    Operates in-place on the file.
    """
    with open(svg_path, 'r', encoding='utf-8') as f:
        content = f.read()

    result      = []
    pos         = 0
    count       = 0
    tag_pattern = re.compile(
        r'<(\w[\w\-\.]*)([^>]*?class=["\']Animate["\'][^>]*?)(/?)>',
        re.DOTALL
    )

    for m in tag_pattern.finditer(content):
        tag_name   = m.group(1)
        self_close = m.group(3)

        result.append(content[pos:m.start()])

        if self_close:
            # Self-closing tag: <tag ... class="Animate" />
            result.append(f'<!-- STUDENT_HIDDEN {m.group(0)} -->')
            pos = m.end()
            count += 1
        else:
            # Find the matching closing tag, respecting nesting
            close_tag  = f'</{tag_name}>'
            open_tag   = f'<{tag_name}'
            depth      = 1
            search_pos = m.end()

            while depth > 0:
                next_open  = content.find(open_tag,  search_pos)
                next_close = content.find(close_tag, search_pos)

                if next_close == -1:
                    # No closing tag found — bail, leave unchanged
                    result.append(m.group(0))
                    pos   = m.end()
                    depth = 0
                    break

                if next_open != -1 and next_open < next_close:
                    depth      += 1
                    search_pos  = next_open + len(open_tag)
                else:
                    depth      -= 1
                    search_pos  = next_close + len(close_tag)

            if depth == 0 and next_close != -1:
                end_pos = next_close + len(close_tag)
                block   = content[m.start():end_pos]
                result.append(f'<!-- STUDENT_HIDDEN\n{block}\n-->')
                pos   = end_pos
                count += 1

    result.append(content[pos:])
    modified = ''.join(result)

    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(modified)

    if count:
        print(f"    [SVG] {svg_path.name}: commented out {count} Animate element(s)")
    else:
        print(f"    [SVG] {svg_path.name}: no Animate elements found")


def get_animation_svg_paths(html_path: Path, figures_src: Path) -> list[Path]:
    """
    Returns resolved paths of all SVGs referenced as Animation objects in the HTML.
    Handles both attribute orderings (class before data, and data before class).
    """
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()

    pattern1 = re.compile(
        r'<object[^>]*?class=["\']Animation["\'][^>]*?data=["\']([^"\']+)["\']',
        re.DOTALL | re.IGNORECASE
    )
    pattern2 = re.compile(
        r'<object[^>]*?data=["\']([^"\']+)["\'][^>]*?class=["\']Animation["\']',
        re.DOTALL | re.IGNORECASE
    )

    paths = set()
    for pattern in [pattern1, pattern2]:
        for m in pattern.finditer(content):
            svg_path = (html_path.parent / m.group(1)).resolve()
            if svg_path.exists():
                paths.add(svg_path)
            else:
                print(f"  [WARN] SVG not found: {svg_path}")

    return list(paths)


def process_presentation(folder: Path):
    """
    Processes a single presentation folder:
      1. Converts Animation objects → <img src='FiguresGeneral_student/...'>
         and saves as index_student.html alongside the original index.html
      2. Copies FiguresGeneral/ → FiguresGeneral_student/ at the same level
      3. Comments out class="Animate" elements in the copied SVGs
    """
    html_input = folder / "index.html"
    if not html_input.exists():
        print(f"[ERROR] No index.html found in {folder}")
        return

    figures_src = folder / "FiguresGeneral"
    figures_dst = folder / "FiguresGeneral_student"
    html_output = folder / "index_student.html"
    prof_output = folder / "index_professor.html"

    print(f"\n{'='*60}")
    print(f"Processing : {folder.name}")

    # ── Cleanup: remove any previously generated files ───────────────────────
    for f in [html_output, prof_output]:
        if f.exists():
            f.unlink()
            print(f"  [DEL] {f.name}")
    if figures_dst.exists():
        shutil.rmtree(figures_dst)
        print(f"  [DEL] FiguresGeneral_student/")

    print(f"  Output     : {html_output.name}  +  FiguresGeneral_student/")
    print(f"             : {prof_output.name}  (maps to FiguresGeneral/)")

    # ── Step 1a: Student HTML ────────────────────────────────────────────────
    # Same folder as original so all css/, js/, plugin/ paths remain valid
    transform_html(html_input, html_output, figures_dst_folder="FiguresGeneral_student")

    # ── Step 1b: Professor HTML ──────────────────────────────────────────────
    # object → img, but keep pointing at the original FiguresGeneral/
    transform_html(html_input, prof_output, figures_dst_folder=None)
    print(f"  [HTML] Professor version saved as {prof_output.name}")

    # ── Step 2: Copy FiguresGeneral → FiguresGeneral_student ────────────────
    if not figures_src.exists():
        print(f"  [WARN] No FiguresGeneral folder found in {folder}")
        return

    shutil.copytree(figures_src, figures_dst)
    print(f"  [COPY] FiguresGeneral → FiguresGeneral_student")

    # ── Step 3: Comment out Animate elements in the copied SVGs ─────────────
    svg_paths = get_animation_svg_paths(html_input, figures_src)
    print(f"  [INFO] {len(svg_paths)} Animation SVG(s) to process")

    for svg_src in svg_paths:
        rel     = svg_src.relative_to(figures_src)
        svg_dst = figures_dst / rel
        if svg_dst.exists():
            comment_animate_elements_in_svg(svg_dst)

    print(f"\n  Done!")


def list_presentations(repo_root: Path) -> list[Path]:
    """
    Lists all presentation folders (those containing index.html).
    Excludes any folder named 'student' or containing 'student' in its path.
    """
    return sorted(set(
        f.parent for f in repo_root.rglob("index.html")
        if "student" not in f.parts and f.name == "index.html"
    ))


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    repo_root = Path(r"c:\Users\zamcr\OneDrive\Documents\GitHub\CIE365-Soil-mechanics")

    presentations = list_presentations(repo_root)

    if not presentations:
        print("No presentations found.")
        exit()

    print("Available presentations:\n")
    for i, folder in enumerate(presentations):
        print(f"  [{i}] {folder.relative_to(repo_root)}")

    print("\nEnter the number of the presentation to process: ", end="")
    choice = input().strip()

    try:
        idx = int(choice)
        if 0 <= idx < len(presentations):
            process_presentation(presentations[idx])
        else:
            print(f"[ERROR] Please enter a number between 0 and {len(presentations) - 1}")
    except ValueError:
        print("[ERROR] Invalid input. Please enter a number.")
