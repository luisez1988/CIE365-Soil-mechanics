#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Builds the interactive course ebook from the reveal.js lecture decks.
The course name shown to students lives in ebook_src/config.json ("course");
nothing else writes it.

    python ebook_build.py                # build every chapter in ebook_src/config.json + TOC
    python ebook_build.py 1D_flow        # build one chapter + refresh TOC
    python ebook_build.py --list 1D_flow # print section indices/titles (to configure skips)

The slides remain the source of truth; ebook/ is fully regenerated on each run
and is safe to delete. The correct answers (contents of span.atb) are NEVER
written to the output — blanks ship as empty contenteditable spans whose only
answer-derived attribute is a width hint.
"""

import hashlib
import json
import os
import re
import shutil
import stat
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
SRC = REPO / "ebook_src"
OUT = REPO / "ebook"


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def force_rmtree(path: Path):
    """Remove a directory tree, clearing read-only flags first (Windows/OneDrive)."""
    def remove_readonly(func, fpath, _):
        os.chmod(fpath, stat.S_IWRITE)
        func(fpath)
    shutil.rmtree(path, onerror=remove_readonly)


def strip_comments(html: str) -> str:
    return re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)


def visible_text(html: str) -> str:
    txt = re.sub(r'<[^>]+>', ' ', html)
    txt = txt.replace('&nbsp;', ' ').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', txt).strip()


def split_sections(html: str):
    """Return [(attrs, body), ...] for every top-level <section>.
    Depth is clamped at 0 so a stray </section> cannot derail the scan."""
    sections = []
    depth = 0
    start = 0
    attrs = ''
    for m in re.finditer(r'<section\b([^>]*)>|</section\s*>', html, re.IGNORECASE):
        if m.group(0)[1] == '/':
            if depth == 0:
                continue  # stray closing tag (e.g. Induced_stress)
            depth -= 1
            if depth == 0:
                sections.append((attrs, html[start:m.start()]))
        else:
            if depth == 0:
                start = m.end()
                attrs = m.group(1) or ''
            depth += 1
    return sections


def find_balanced_end(html: str, open_end: int, tag: str) -> int:
    """Given the position right after an opening <tag ...>, return the position
    just past the matching </tag>, or -1 if unbalanced."""
    low = html.lower()
    open_tag = '<' + tag.lower()
    close_tag = '</' + tag.lower()
    depth = 1
    pos = open_end
    while depth:
        nxt_close = low.find(close_tag, pos)
        if nxt_close == -1:
            return -1
        nxt_open = low.find(open_tag, pos)
        # ensure the open we found is a real tag boundary (<g vs <glyph)
        while nxt_open != -1:
            boundary = low[nxt_open + len(open_tag): nxt_open + len(open_tag) + 1]
            if boundary in ('>', ' ', '\t', '\n', '\r', '/'):
                break
            nxt_open = low.find(open_tag, nxt_open + 1)
        if nxt_open != -1 and nxt_open < nxt_close:
            depth += 1
            pos = nxt_open + len(open_tag)
        else:
            depth -= 1
            pos = low.find('>', nxt_close)
            if pos == -1:
                return -1
            pos += 1
    return pos


def remove_elements_by_class(html: str, token: str) -> str:
    """Remove every element (balanced, any tag) whose class contains `token`."""
    open_re = re.compile(
        r'<(\w[\w-]*)\b[^>]*class=["\'][^"\']*\b' + re.escape(token) + r'\b[^"\']*["\'][^>]*?(/?)>',
        re.IGNORECASE)
    out = []
    pos = 0
    while True:
        m = open_re.search(html, pos)
        if not m:
            out.append(html[pos:])
            break
        out.append(html[pos:m.start()])
        if m.group(2):  # self-closing
            pos = m.end()
            continue
        end = find_balanced_end(html, m.end(), m.group(1))
        pos = end if end != -1 else m.end()
    return ''.join(out)


# ---------------------------------------------------------------------------
# Per-section transformations
# ---------------------------------------------------------------------------

FRAGMENT_TOKENS = ('current-visible', 'grow', 'shrink', 'semi-fade-out')


def strip_fragment_classes(html: str) -> str:
    def clean(m):
        quote, val = m.group(1), m.group(2)
        toks = [t for t in val.split()
                if t != 'fragment'
                and not t.startswith('fade-')
                and not t.startswith('highlight-')
                and t not in FRAGMENT_TOKENS]
        return 'class=%s%s%s' % (quote, ' '.join(toks), quote) if toks else ''
    html = re.sub(r'class=(["\'])(.*?)\1', clean, html)
    html = re.sub(r'\sdata-fragment-index=["\'][^"\']*["\']', '', html)
    html = re.sub(r'\sdata-preload(?==|[\s>])(=["\'][^"\']*["\'])?', '', html)
    return html


def convert_animation_objects(html: str, collected: set) -> str:
    """<object class='Animation' data='FiguresGeneral/x.svg'> -> <img src='figures/x.svg'>"""
    def repl(m):
        tag = m.group(0)
        data_m = re.search(r'data=["\']([^"\']+)["\']', tag)
        style_m = re.search(r'style=["\']([^"\']+)["\']', tag)
        if not data_m:
            return ''
        src = data_m.group(1)
        collected.add(src)
        base = src.split('/')[-1]
        style = style_m.group(1) if style_m else 'width:100%'
        return '<img src="figures/%s" style="%s" alt=""/>' % (base, style)
    return re.sub(
        r'<object\b[^>]*class=["\'][^"\']*\bAnimation\b[^"\']*["\'][^>]*>\s*</object>',
        repl, html, flags=re.IGNORECASE | re.DOTALL)


SOLUTION_DIV = re.compile(
    r'<div\b[^>]*class=["\'][^"\']*\bSolution\b[^"\']*["\'][^>]*>\s*</div>',
    re.IGNORECASE | re.DOTALL)


def expand_solutions(html: str, deck: str, state: dict) -> str:
    """Inline <div class='Solution' data-src='solutions/x.html'></div>.

    The slides split a long solution across two slides with data-part; the book
    is a scrollable page, so it takes the whole file at once. Each data-src is
    therefore inlined only ONCE per chapter -- collect_blocks already merges the
    untitled continuation slide into its parent block, so without this the
    solution would appear twice."""
    def repl(m):
        tag = m.group(0)
        src_m = re.search(r'data-src=["\']([^"\']+)["\']', tag)
        if not src_m:
            return ''
        src = src_m.group(1)
        if src in state['seen']:
            return ''                      # continuation slide: already inlined
        state['seen'].add(src)
        path = REPO / deck / src
        if not path.exists():
            state['missing'].append(src)
            return ''
        body = strip_comments(path.read_text(encoding='utf-8', errors='replace'))
        # data-part splits a solution across two slides; data-slide carries the
        # short form of a note for the slide's tight vertical budget. Both are
        # slide-only hints -- a scrolling page takes the whole thing at full
        # length, so strip them and keep the element's own (full) text.
        return re.sub(r'\sdata-(?:part|slide)=(["\']).*?\1', '', body,
                      flags=re.DOTALL)
    return SOLUTION_DIV.sub(repl, html)


def rewrite_figure_paths(html: str, deck: str) -> str:
    # case-insensitive: sources contain typos like "Figuresgeneral/"; normalize
    # to the real folder case so links work on case-sensitive GitHub Pages
    return re.sub(r'(src|data|href)=(["\'])(?:\./)?FiguresGeneral/',
                  lambda m: '%s=%s../../%s/FiguresGeneral/' % (m.group(1), m.group(2), deck),
                  html, flags=re.IGNORECASE)


def colwidth_to_var(html: str) -> str:
    """In .col divs, turn inline `width: X%` into `--colw:X%` (book.css consumes it)."""
    def repl(m):
        tag = m.group(0)
        if not re.search(r'class=["\'][^"\']*\bcol\b', tag):
            return tag
        return re.sub(r'width:\s*([\d.]+)\s*%', r'--colw:\1%', tag)
    return re.sub(r'<div\b[^>]*>', repl, html)


def strip_position_margins(html: str) -> str:
    """Drop slide-positioning declarations from inline styles: margins and
    absolute/fixed positioning are 1280x720 layout hacks that break a
    scrollable document (elements escape their block and overlap)."""
    def repl(m):
        quote, css = m.group(1), m.group(2)
        css = re.sub(r'margin(?:-top|-left|-right)?\s*:\s*[^;"\']*;?', '', css)
        css = re.sub(r'position\s*:\s*(?:absolute|fixed)\s*;?', '', css)
        css = css.strip().strip(';').strip()
        return 'style=%s%s%s' % (quote, css, quote) if css else ''
    return re.sub(r'style=(["\'])(.*?)\1', repl, html)


def transform_body(body: str, deck: str, anim_svgs: set, sol_state: dict) -> str:
    # first: pull worked solutions in from solutions/*.html, so everything below
    # (fragment stripping, blank conversion) sees them as ordinary slide markup
    body = expand_solutions(body, deck, sol_state)
    body = re.sub(r'<script\b.*?</script>', '', body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r'<style\b.*?</style>', '', body, flags=re.DOTALL | re.IGNORECASE)
    body = re.sub(r'<aside\b[^>]*class=["\'][^"\']*\bnotes\b[^"\']*["\'].*?</aside>', '',
                  body, flags=re.DOTALL | re.IGNORECASE)
    for token in ('qrCode_cont', 'qrCode', 'blackboard'):
        body = remove_elements_by_class(body, token)
    body = re.sub(r'<span[^>]*id=["\']spanDate_text["\'][^>]*>\s*</span>', '', body)
    body = re.sub(r'</?section[^>]*>', '', body)  # flatten vertical stacks
    body = strip_fragment_classes(body)
    body = convert_animation_objects(body, anim_svgs)
    body = rewrite_figure_paths(body, deck)
    body = colwidth_to_var(body)
    body = strip_position_margins(body)
    body = re.sub(r'\sclass=(["\'])\s*\1', '', body)  # empty class leftovers
    body = re.sub(r'<img\b(?![^>]*\bloading=)', '<img loading="lazy"', body)
    # slides autoplay videos silently; in the book give students controls, and
    # muted keeps autoplay working under browser media policies
    body = re.sub(r'<video\b(?![^>]*\bcontrols\b)', '<video controls muted', body)
    # third-party embeds (Google Sheets etc.) become click-to-load placeholders:
    # they make the page heavy/janky and can stall rendering entirely
    body = re.sub(r'<iframe\b[^>]*\bsrc=(["\'])(https?://[^"\']+)\1[^>]*>.*?</iframe>',
                  lambda m: ('<div class="embed-placeholder" data-src="%s" role="button" '
                             'tabindex="0">\U0001f4ca Interactive worksheet — click to load'
                             '</div>' % m.group(2)),
                  body, flags=re.DOTALL | re.IGNORECASE)
    return body


# ---------------------------------------------------------------------------
# Blanks
# ---------------------------------------------------------------------------

# Three markers become blanks:
#   .atb   prose fill-in-the-blank, used throughout the decks
#   .fill  a value the student works out inside a solution (blue)
#   .ans   the answer the problem asked for (green)
BLANK_OPEN = re.compile(
    r'<span\b[^>]*class=(["\'])[^"\']*\b(?:atb|fill|ans)\b[^"\']*\1[^>]*>',
    re.IGNORECASE)
BLANK_MARK = re.compile(r'<span class="blank[^"]*"[^>]*>\s*</span>')
CLOSE_SPAN = re.compile(r'</span\s*>\s*$', re.IGNORECASE)


def convert_blanks(article: str, deck: str):
    """Replace every .atb/.fill/.ans span with an empty typed blank.
    Returns (html, answers).

    Blank IDs hash the ~48 visible characters preceding the blank, so they
    survive slide insertion/reordering and leak nothing about the answer.

    The closing tag is found by balanced scan rather than a non-greedy `.*?`:
    solution blanks wrap MathJax delimiters and inline markup, and the decks
    contain mismatched spans (1D_flow/index.html:397) that stop a lazy match at
    the wrong tag."""
    out = []
    last = 0
    pos = 0
    counts = {}
    answers = []
    while True:
        m = BLANK_OPEN.search(article, pos)
        if not m:
            break
        end = find_balanced_end(article, m.end(), 'span')
        if end == -1:                       # unbalanced: leave the markup alone
            pos = m.end()
            continue
        ans_html = CLOSE_SPAN.sub('', article[m.end():end])
        out.append(article[last:m.start()])
        ans = visible_text(ans_html)
        answers.append(ans)
        is_math = ('\\(' in ans_html) or ('$' in ans_html)
        is_ans = re.search(r'class=["\'][^"\']*\bans\b', m.group(0), re.IGNORECASE)
        width = max(4, min(40, len(ans) + 2))
        ctx_html = BLANK_MARK.sub(' ___ ', ''.join(out))
        ctx = visible_text(ctx_html).lower()[-48:]
        base = '%s.%s' % (deck, hashlib.sha1(ctx.encode('utf-8')).hexdigest()[:8])
        k = counts.get(base, 0)
        counts[base] = k + 1
        bid = '%s-%d' % (base, k)
        cls = ['blank']
        extra = ''
        if is_math:
            cls.append('math')
            # Blanks are deliberately excluded from MathJax (ignoreHtmlClass:
            # 'blank' in chapter_template.html) and are plaintext-only, so
            # whatever is typed stays literal. The tooltip must not imply that
            # typing LaTeX will render it.
            extra = (' data-math="1" '
                     'title="Math answer — plain text is fine, e.g. pi*7.6^2/4"')
        if is_ans:
            cls.append('ans')               # book.css boxes the final answer
        out.append('<span class="%s" data-bid="%s"%s style="min-width:%dch" '
                   'contenteditable="plaintext-only" spellcheck="false"></span>'
                   % (' '.join(cls), bid, extra, width))
        last = end
        pos = end
    out.append(article[last:])
    return ''.join(out), answers


# ---------------------------------------------------------------------------
# SVG sanitizing (Animation figures: DELETE answer strokes, never comment them)
# ---------------------------------------------------------------------------

# Both step channels are stripped. In the decks `.fragment` was meant for the
# problem setup and `.Animate` for the worked answer, but the convention was not
# applied consistently -- EX4140.svg carries its entire solution in `.fragment`
# groups and has no `.Animate` at all. Since the two cannot be told apart
# reliably, everything that is revealed step-by-step is treated as answer work.
#
# Consequence: for a handwritten figure that is *entirely* built up in steps,
# nothing drawable survives. build_chapter drops those figures and names them,
# rather than shipping a blank image -- converting the example to
# solutions/*.html is the real fix.
ANIM_EL = re.compile(
    r'<(\w[\w\-\.]*)\b[^>]*class=["\'][^"\']*\b(?:Animate(?:Group)?|fragment)\b[^"\']*["\']'
    r'[^>]*?(/?)>',
    re.DOTALL)

DRAWABLE = re.compile(r'<(?:path|text|image|circle|rect|line|polyline|polygon|ellipse)\b',
                      re.IGNORECASE)


def sanitize_svg(svg_path: Path):
    content = svg_path.read_text(encoding='utf-8', errors='replace')
    content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    out = []
    pos = 0
    count = 0
    while True:
        m = ANIM_EL.search(content, pos)
        if not m:
            out.append(content[pos:])
            break
        out.append(content[pos:m.start()])
        if m.group(2):  # self-closing
            pos = m.end()
            count += 1
            continue
        end = find_balanced_end(content, m.end(), m.group(1))
        if end == -1:
            out.append(m.group(0))
            pos = m.end()
        else:
            pos = end
            count += 1
    cleaned = ''.join(out)
    svg_path.write_text(cleaned, encoding='utf-8')
    return count, len(DRAWABLE.findall(cleaned))


# ---------------------------------------------------------------------------
# Chapter build
# ---------------------------------------------------------------------------

def extract_chapter_title(body: str):
    m = re.search(r'<[^>]*class=["\'][^"\']*\btitle_slide\b[^"\']*["\'][^>]*>', body)
    if not m:
        return None
    name_m = re.search(r'name=(["\'])(.*?)\1', m.group(0))
    return name_m.group(2).strip() if name_m else None


def esc(text) -> str:
    """Escape a config/title string for use in HTML text or attribute values
    (course names contain '&', which must not be emitted raw)."""
    return (str(text).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def slugify(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', (text or '').lower()).strip('-')[:40]


def section_title(body: str):
    m = re.search(r'<h1[^>]*>(.*?)</h1>', body, re.DOTALL | re.IGNORECASE)
    if not m:
        return None, None
    return visible_text(m.group(1)), m.group(1).strip()


def collect_blocks(sections, ch_cfg, global_skips):
    """Turn raw sections into merged blocks; returns (chapter_title, blocks, stats)."""
    skip_titles = {t.strip().lower() for t in global_skips}
    skip_titles |= {t.strip().lower() for t in ch_cfg.get('skip_titles', [])}
    skip_indices = set(ch_cfg.get('skip_indices', []))

    chapter_title = None
    blocks = []  # {'title','title_html','parts','iclicker'}
    stats = {'total': len(sections), 'skipped': 0, 'merged': 0}

    for i, (attrs, body) in enumerate(sections):
        t = extract_chapter_title(body)
        if t:
            chapter_title = chapter_title or t
            stats['skipped'] += 1
            continue
        title, title_html = section_title(body)
        if i in skip_indices or (title and title.lower() in skip_titles):
            stats['skipped'] += 1
            continue

        body = re.sub(r'<h1[^>]*>.*?</h1>', '', body, flags=re.DOTALL | re.IGNORECASE)
        bg = re.search(r'data-background-image=["\']([^"\']+)["\']', attrs)
        if bg and 'FiguresGeneral/' in bg.group(1):
            body = '<figure class="bg-figure"><img src="%s" alt=""/></figure>\n' % bg.group(1) + body

        iclicker = 'iClicker' in body
        # untitled/same-title sections continue the previous block, but an
        # iClicker (participation question) block never absorbs continuations
        if (blocks and not blocks[-1]['iclicker'] and not iclicker
                and (title is None or title == blocks[-1]['title'])):
            blocks[-1]['parts'].append(body)
            stats['merged'] += 1
        else:
            blocks.append({'title': title, 'title_html': title_html,
                           'parts': [body], 'iclicker': iclicker})
    return chapter_title, blocks, stats


def build_chapter(ch_cfg, config):
    deck = ch_cfg['dir']
    src_file = REPO / deck / 'index.html'
    if not src_file.exists():
        print('[ERROR] %s not found' % src_file)
        return None

    html = strip_comments(src_file.read_text(encoding='utf-8', errors='replace'))
    sections = split_sections(html)
    chapter_title, blocks, stats = collect_blocks(
        sections, ch_cfg, config.get('global_skip_titles', []))
    title = ch_cfg.get('title') or chapter_title or deck.replace('_', ' ')

    out_dir = OUT / deck
    if out_dir.exists():
        force_rmtree(out_dir)
    (out_dir / 'figures').mkdir(parents=True)

    anim_svgs = set()
    sol_state = {'seen': set(), 'missing': []}
    nav_items = []
    rendered = []
    used_anchors = set()
    for i, b in enumerate(blocks):
        parts = [transform_body(p, deck, anim_svgs, sol_state) for p in b['parts']]
        cls = 'block check-yourself' if b['iclicker'] else 'block'
        # stable anchor for student sticky notes: title slug, falling back to index
        anchor = slugify(b['title']) if b['title'] else ''
        if not anchor:
            anchor = 's%d' % i
        if anchor in used_anchors:
            anchor = '%s-%d' % (anchor, i)
        used_anchors.add(anchor)
        sec = ['<section class="%s" id="s%d" data-anchor="%s">' % (cls, i, anchor)]
        if b['title']:
            sec.append('<h2 class="block-title">%s</h2>' % b['title_html'])
            nav_items.append('<li><a href="#s%d">%s</a></li>' % (i, b['title']))
        sec.extend(parts)
        sec.append('</section>')
        rendered.append('\n'.join(sec))
    article = '\n\n'.join(rendered)
    article, answers = convert_blanks(article, deck)

    # copy + sanitize the Animation SVGs
    emptied = []
    for rel in sorted(anim_svgs):
        src_svg = REPO / deck / rel
        if not src_svg.exists():
            print('  [WARN] Animation SVG missing: %s' % src_svg)
            continue
        dst_svg = out_dir / 'figures' / src_svg.name
        shutil.copy2(src_svg, dst_svg)
        n, remaining = sanitize_svg(dst_svg)
        if remaining == 0:
            # the whole figure was step-by-step solution work; there is no
            # problem sketch underneath to keep
            dst_svg.unlink()
            emptied.append(src_svg.name)
        elif n:
            print('  [SVG] %s: removed %d answer element(s)' % (dst_svg.name, n))

    for name in emptied:
        article = re.sub(r'<img\b[^>]*src="figures/%s"[^>]*>' % re.escape(name),
                         '', article)
    if emptied:
        print('  [WARN] %d figure(s) were entirely solution work and are omitted '
              'from the book (the ProblemBox is left as writing space). Convert '
              'these to solutions/*.html next: %s' % (len(emptied), ', '.join(emptied)))
    if sol_state['missing']:
        print('  [FAIL] solution partial(s) not found: %s'
              % ', '.join(sol_state['missing']))

    template = (SRC / 'chapter_template.html').read_text(encoding='utf-8')
    page = (template
            .replace('{{COURSE}}', esc(config['course']))
            .replace('{{COURSE_CODE}}', esc(config.get('course_code', 'course')))
            .replace('{{AUTHOR}}', esc(config.get('author', '')))
            .replace('{{ATTRIBUTION}}', esc(config.get('attribution', '')))
            .replace('{{QA_ENDPOINT}}', esc(config.get('qa_endpoint', '')))
            .replace('{{TITLE}}', esc(title))
            .replace('{{CHAPTER_ID}}', deck)
            .replace('{{TOTAL_BLANKS}}', str(len(answers)))
            .replace('{{NAV}}', '\n'.join(nav_items))
            .replace('{{BODY}}', article))
    (out_dir / 'index.html').write_text(page, encoding='utf-8')

    meta = {'dir': deck, 'title': title, 'blanks': len(answers),
            'blocks': len(blocks), 'sections': stats['total']}
    (out_dir / 'meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')

    print('  [OK] %s: %d sections -> %d blocks (%d merged, %d skipped), %d blanks'
          % (deck, stats['total'], len(blocks), stats['merged'], stats['skipped'],
             len(answers)))
    validate_chapter(page, answers, deck, out_dir)
    return meta


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------

def validate_chapter(page: str, answers, deck: str, out_dir: Path):
    problems = []
    if re.search(r'class=["\'][^"\']*\batb\b', page):
        problems.append('residual .atb class in output')
    # an unconverted .fill/.ans means a solution value is printed in the book.
    # `blank ans` is our own output (the boxed answer blank), so skip blanks.
    for m in re.finditer(r'class=(["\'])([^"\']*)\1', page):
        toks = m.group(2).split()
        if 'blank' in toks:
            continue
        for token in ('fill', 'ans'):
            if token in toks:
                problems.append(
                    'residual .%s span in output (answer would be visible)' % token)
    if re.search(r'class=["\'][^"\']*\bSolution\b', page):
        problems.append('unexpanded .Solution placeholder in output')
    if 'data-original-text' in page:
        problems.append('residual data-original-text in output')
    bids = re.findall(r'data-bid="([^"]+)"', page)
    if len(bids) != len(set(bids)):
        problems.append('duplicate blank IDs')
    if len(bids) != len(answers):
        problems.append('blank count mismatch (%d ids vs %d answers)' % (len(bids), len(answers)))

    for attr, quote, path in re.findall(r'(src|data)=(["\'])([^"\']+)\2', page):
        if path.startswith(('http', 'data:', '#')):
            continue
        target = (out_dir / path).resolve()
        if not target.exists():
            problems.append('missing figure: %s' % path)

    for svg in (out_dir / 'figures').glob('*.svg'):
        text = svg.read_text(encoding='utf-8', errors='replace')
        for token in ('Animate', 'fragment'):
            if re.search(r'class=["\'][^"\']*\b%s' % token, text):
                problems.append('unsanitized %s element in %s' % (token, svg.name))

    plain = visible_text(page).lower()
    leaks = sorted({a.lower() for a in answers if len(a) > 3 and a.lower() in plain})
    for a in leaks:
        print('  [note] answer text also appears in prose (%dx): "%s"'
              % (plain.count(a.lower()), a))

    if problems:
        for p in problems:
            print('  [FAIL] %s' % p)
    else:
        print('  [VALID] %s passed all hard checks' % deck)
    return not problems


# ---------------------------------------------------------------------------
# TOC
# ---------------------------------------------------------------------------

def build_toc(config):
    items = []
    for ch in config['chapters']:
        meta_file = OUT / ch['dir'] / 'meta.json'
        if not meta_file.exists():
            continue
        meta = json.loads(meta_file.read_text(encoding='utf-8'))
        items.append(
            '<li><a class="chapter-link" href="%s/index.html" data-chapter="%s" data-total="%d">'
            '<span class="ch-title">%s</span>'
            '<span class="ch-progress" data-for="%s"></span></a></li>'
            % (meta['dir'], meta['dir'], meta['blanks'], meta['title'], meta['dir']))
    template = (SRC / 'toc_template.html').read_text(encoding='utf-8')
    page = (template
            .replace('{{COURSE}}', esc(config['course']))
            .replace('{{COURSE_CODE}}', esc(config.get('course_code', 'course')))
            .replace('{{AUTHOR}}', esc(config.get('author', '')))
            .replace('{{ATTRIBUTION}}', esc(config.get('attribution', '')))
            .replace('{{CHAPTERS}}', '\n'.join(items)))
    (OUT / 'index.html').write_text(page, encoding='utf-8')
    print('[OK] TOC with %d chapter(s) -> ebook/index.html' % len(items))


def copy_assets():
    assets = OUT / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    for name in ('book.css', 'book.js'):
        shutil.copy2(SRC / name, assets / name)
    # solution styling and MathJax macros are shared with the decks, so they
    # live at the repo root and are copied in rather than duplicated
    for name in ('solutions.css', 'mathjax-macros.js'):
        shutil.copy2(REPO / 'assets' / name, assets / name)
    # the handwriting webfont is self-hosted so the book renders the same
    # offline and on any machine; solutions.css refers to it relatively
    src_fonts = REPO / 'assets' / 'fonts'
    if src_fonts.is_dir():
        dst_fonts = assets / 'fonts'
        if dst_fonts.exists():
            force_rmtree(dst_fonts)
        shutil.copytree(src_fonts, dst_fonts)
    print('[OK] assets copied')


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def list_sections(deck: str, config):
    src_file = REPO / deck / 'index.html'
    html = strip_comments(src_file.read_text(encoding='utf-8', errors='replace'))
    sections = split_sections(html)
    print('%s: %d top-level sections' % (deck, len(sections)))
    for i, (attrs, body) in enumerate(sections):
        title, _ = section_title(body)
        flags = []
        if extract_chapter_title(body):
            flags.append('TITLE-SLIDE: %s' % extract_chapter_title(body))
        if 'iClicker' in body:
            flags.append('iClicker')
        n_blanks = len(BLANK_RE.findall(body))
        if n_blanks:
            flags.append('%d blank(s)' % n_blanks)
        print('  [%2d] %-45s %s' % (i, title or '(untitled)', ' | '.join(flags)))


def main(argv):
    config = json.loads((SRC / 'config.json').read_text(encoding='utf-8'))

    if argv and argv[0] == '--list':
        if len(argv) < 2:
            print('usage: python ebook_build.py --list <deck_dir>')
            return 1
        list_sections(argv[1], config)
        return 0

    chapters = config['chapters']
    if argv:
        chapters = [c for c in chapters if c['dir'] == argv[0]]
        if not chapters:
            print('[ERROR] "%s" not in ebook_src/config.json chapters' % argv[0])
            return 1

    copy_assets()
    for ch in chapters:
        print('Building %s ...' % ch['dir'])
        build_chapter(ch, config)
    build_toc(config)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
