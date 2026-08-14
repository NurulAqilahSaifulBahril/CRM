"""Renders the CRM install & update guide to a styled PDF.

Mirrors the Installation System guide — same design language (Eternalgy
navy header, blue accent rule, Segoe UI) and the same scope: getting the
app installed and keeping it updated, nothing else.

    python scripts/build-user-guide.py

Writes "CRM Desktop app_user_guide.pdf". This is deliberately NOT the
whole of USER-GUIDE.md: the markdown is the full manual (sidebar sections,
Report Center, the staff login), while this PDF is the short handout you
give someone on day one. Only the install/update/troubleshooting material
is shared between them — keep those parts in step when either changes.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "CRM Desktop app_user_guide.pdf"

VERSION = "1.0.2"
DATE_LABEL = "August 2026"
RELEASES_URL = "https://github.com/NurulAqilahSaifulBahril/CRM/releases/latest"

# --- design tokens -------------------------------------------------------
# Identical to the Installation System guide's palette — same document
# family, same brand.

NAVY = colors.HexColor("#0F1922")
BLUE = colors.HexColor("#2563EB")
BLUE_LIGHT = colors.HexColor("#60A5FA")
EYEBROW_ON_NAVY = colors.HexColor("#93C5FD")
META_ON_NAVY = colors.HexColor("#AEC3DE")
INK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
CODE_BG = colors.HexColor("#EFF2F6")
RULE = colors.HexColor("#E2E8F0")
AMBER_BG = colors.HexColor("#FFF8EB")
AMBER_EDGE = colors.HexColor("#F59E0B")
BLUE_BG = colors.HexColor("#F1F6FE")
ZEBRA = colors.HexColor("#F8FAFC")

PAGE_W, PAGE_H = A4
MARGIN = 46
CONTENT_W = PAGE_W - 2 * MARGIN
HEADER_H = 153
BANNER_H = 34  # running header band on pages 2+

FONTS = {
    "SegoeUI": "segoeui.ttf",
    "SegoeUI-Bold": "segoeuib.ttf",
    "SegoeUI-Italic": "segoeuii.ttf",
    "SegoeUI-Semibold": "seguisb.ttf",
    "Consolas": "consola.ttf",
}

# Segoe UI has no CJK glyphs — the troubleshooting table quotes the app's actual bilingual
# alert text ("保存失败" / "Postgres 同步失败"), which silently rendered as empty boxes under
# Segoe UI. Microsoft YaHei covers both Chinese and Latin, so the "td" style (troubleshooting
# table body cells, the only place Chinese text appears) uses it instead of Segoe UI.
CJK_FONTS = {
    "YaHei": ("msyh.ttc", 0),
    "YaHei-Bold": ("msyhbd.ttc", 0),
}


def register_fonts():
    windows_fonts = Path("C:/Windows/Fonts")
    for name, filename in FONTS.items():
        pdfmetrics.registerFont(TTFont(name, str(windows_fonts / filename)))
    pdfmetrics.registerFontFamily(
        "SegoeUI",
        normal="SegoeUI",
        bold="SegoeUI-Bold",
        italic="SegoeUI-Italic",
        boldItalic="SegoeUI-Bold",
    )
    for name, (filename, index) in CJK_FONTS.items():
        pdfmetrics.registerFont(TTFont(name, str(windows_fonts / filename), subfontIndex=index))
    pdfmetrics.registerFontFamily(
        "YaHei", normal="YaHei", bold="YaHei-Bold", italic="YaHei", boldItalic="YaHei-Bold"
    )


# --- paragraph styles ----------------------------------------------------


def build_styles():
    body = ParagraphStyle(
        "body",
        fontName="SegoeUI",
        fontSize=10,
        leading=15.5,
        textColor=INK,
        spaceAfter=9,
        alignment=TA_LEFT,
    )
    return {
        "body": body,
        "lead": ParagraphStyle(
            "lead", parent=body, fontSize=10.5, leading=16.5, spaceAfter=12
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=body,
            fontName="SegoeUI-Semibold",
            fontSize=17,
            leading=22,
            spaceBefore=4,
            spaceAfter=8,
            keepWithNext=1,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=body,
            fontName="SegoeUI-Semibold",
            fontSize=13,
            leading=18,
            spaceBefore=13,
            spaceAfter=6,
            keepWithNext=1,
        ),
        "eyebrow": ParagraphStyle(
            "eyebrow",
            parent=body,
            fontName="SegoeUI-Bold",
            fontSize=8.4,
            leading=11,
            textColor=BLUE,
            spaceBefore=16,
            spaceAfter=5,
            keepWithNext=1,
        ),
        "step": ParagraphStyle(
            "step", parent=body, leading=15, spaceAfter=0
        ),
        "callout": ParagraphStyle(
            "callout", parent=body, fontSize=9.6, leading=15, spaceAfter=6
        ),
        "callout_title": ParagraphStyle(
            "callout_title",
            parent=body,
            fontName="SegoeUI-Semibold",
            fontSize=10.5,
            leading=15,
            spaceAfter=5,
        ),
        "th": ParagraphStyle(
            "th",
            parent=body,
            fontName="SegoeUI-Bold",
            fontSize=8.2,
            leading=11,
            textColor=colors.white,
            spaceAfter=0,
        ),
        "td": ParagraphStyle(
            "td", parent=body, fontSize=9.3, leading=13.5, spaceAfter=0
        ),
        "code": ParagraphStyle(
            "code",
            parent=body,
            fontName="Consolas",
            fontSize=9.6,
            leading=15,
            textColor=INK,
            spaceAfter=0,
            leftIndent=10,
        ),
        "footer": ParagraphStyle(
            "footer", parent=body, fontSize=7.6, textColor=MUTED, spaceAfter=0
        ),
    }


S = None  # populated in main()


# --- inline helpers ------------------------------------------------------


def code(text):
    """Inline code — Consolas on a light background, like the Installation guide."""
    return (
        f'<font face="Consolas" size="8.8" backColor="#EFF2F6"> {text} </font>'
    )


def link(text, url):
    return f'<link href="{url}" color="#2563EB"><b>{text}</b></link>'


def cjk(text):
    """Inline CJK span — Segoe UI has no Chinese glyphs, so Chinese fragments (quoted directly
    from the app's own bilingual alert text) are wrapped in Microsoft YaHei instead."""
    return f'<font face="YaHei">{text}</font>'


# --- block helpers -------------------------------------------------------


def para(text, style="body"):
    return Paragraph(text, S[style])


def eyebrow(text):
    return Paragraph(text.upper(), S["eyebrow"])


def h2(text):
    return Paragraph(text, S["h2"])


def h3(text):
    return Paragraph(text, S["h3"])


def _number_badge(n):
    """Fixed 15x15 blue square holding the step number.

    Nested in its own table so the fill stays square — a BACKGROUND on the
    outer cell would stretch down the full height of a multi-line step.
    """
    badge = Table(
        [[Paragraph(
            f'<font color="white" face="SegoeUI-Bold" size="8.4">{n}</font>',
            S["step"],
        )]],
        colWidths=[15],
        rowHeights=[15],
    )
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLUE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return badge


def steps(items):
    """Numbered steps with filled blue number badges."""
    rows = [
        [_number_badge(i), Paragraph(item, S["step"])]
        for i, item in enumerate(items, start=1)
    ]

    table = Table(rows, colWidths=[15, CONTENT_W - 15])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (0, -1), 9),
                ("LEFTPADDING", (1, 0), (1, -1), 9),
            ]
        )
    )
    return table


def callout(title, lines, accent=AMBER_EDGE, background=AMBER_BG):
    """Boxed aside with a coloured left edge."""
    inner = []
    if title:
        inner.append(Paragraph(title, S["callout_title"]))
    for text in lines:
        inner.append(Paragraph(text, S["callout"]))

    table = Table([[inner]], colWidths=[CONTENT_W])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), background),
                ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 13),
                ("RIGHTPADDING", (0, 0), (-1, -1), 13),
                ("TOPPADDING", (0, 0), (-1, -1), 11),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def url_block(url):
    """The download address, shown in full.

    A bare <link> renders as styled words with the address hidden, which is
    no use to someone reading this on paper or typing it into a browser.
    """
    table = Table(
        [[Paragraph(
            f'<link href="{url}"><font face="Consolas" size="9.4" '
            f'color="#2563EB">{url}</font></link>',
            S["step"],
        )]],
        colWidths=[CONTENT_W],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLUE_BG),
                ("LINEBEFORE", (0, 0), (0, -1), 3, BLUE),
                ("LEFTPADDING", (0, 0), (-1, -1), 13),
                ("RIGHTPADDING", (0, 0), (-1, -1), 13),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


def code_block(text):
    table = Table([[Paragraph(text, S["code"])]], colWidths=[CONTENT_W])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def data_table(headers, rows, widths):
    """Header band in navy, zebra-striped body — matches the guide's tables."""
    data = [[Paragraph(h.upper(), S["th"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(cell, S["td"]) for cell in row])

    table = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 1), (-1, -2), 0.6, RULE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
    table.setStyle(TableStyle(style))
    return table


# --- page furniture ------------------------------------------------------


def draw_cover_header(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - HEADER_H, PAGE_W, HEADER_H, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, PAGE_H - HEADER_H - 3, PAGE_W, 3, stroke=0, fill=1)

    canvas.setFillColor(EYEBROW_ON_NAVY)
    canvas.setFont("SegoeUI-Bold", 8.5)
    canvas.drawString(MARGIN, PAGE_H - 46, "E T E R N A L G Y")

    canvas.setFillColor(colors.white)
    canvas.setFont("SegoeUI-Semibold", 25)
    canvas.drawString(MARGIN, PAGE_H - 82, "CRM")

    canvas.setFillColor(BLUE_LIGHT)
    canvas.drawString(MARGIN, PAGE_H - 111, "Install & Update Guide")

    canvas.setFillColor(META_ON_NAVY)
    canvas.setFont("SegoeUI", 10)
    canvas.drawString(
        MARGIN,
        PAGE_H - 133,
        f"Eternalgy CRM \u00b7 Version {VERSION} \u00b7 {DATE_LABEL}",
    )
    canvas.restoreState()


def draw_running_header(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - BANNER_H, PAGE_W, BANNER_H, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, PAGE_H - BANNER_H - 2, PAGE_W, 2, stroke=0, fill=1)
    canvas.setFillColor(EYEBROW_ON_NAVY)
    canvas.setFont("SegoeUI-Bold", 8)
    canvas.drawString(MARGIN, PAGE_H - 22, "ETERNALGY  CRM")
    canvas.restoreState()


def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED)
    canvas.setFont("SegoeUI", 7.6)
    canvas.drawString(MARGIN, 30, "Install & Update Guide")
    canvas.drawRightString(PAGE_W - MARGIN, 30, str(doc.page))
    canvas.restoreState()


def on_first_page(canvas, doc):
    draw_cover_header(canvas, doc)
    draw_footer(canvas, doc)


def on_later_pages(canvas, doc):
    draw_running_header(canvas, doc)
    draw_footer(canvas, doc)


# --- content -------------------------------------------------------------


def build_story():
    # Page 1 gets the tall cover banner; every page after it gets the slim
    # running header instead.
    story = [NextPageTemplate("body")]

    story.append(
        para(
            "A short guide for everyone using CRM. You install it "
            "<b>once</b>. After that it keeps itself up to date — with "
            "nothing for you to click.",
            "lead",
        )
    )
    story.append(
        para(
            "It installs like a normal Windows program — there is no "
            "website to log into and no link to remember. Unlike some of "
            "our other apps, <b>there is no setup step</b> — it connects "
            "automatically the moment it opens."
        )
    )

    # Part 1 — installing
    story.append(eyebrow("Part 1"))
    story.append(h2("Part 1 — Installing"))
    story.append(
        para(
            "Set aside about 5 minutes. You need a Windows PC (Windows 10 "
            "or 11) and an internet connection — the app has no offline "
            "mode. There is nothing to install beforehand, and nothing to "
            "ask anyone for first."
        )
    )

    story.append(h3("Step 1 — Download the app"))
    story.append(para("Go to the CRM download page:"))
    story.append(url_block(RELEASES_URL))
    story.append(Spacer(1, 11))
    story.append(
        steps(
            [
                "Scroll down to the <b>Assets</b> list.",
                f"Click the file starting {code('CRM-Setup')} and "
                "ending in <b>.exe</b> to download it. Always take the "
                "newest version the page offers.",
                "It will go to your <b>Downloads</b> folder unless you "
                "choose somewhere else.",
            ]
        )
    )

    story.append(h3("Step 2 — Run the installer"))
    story.append(
        steps(
            [
                "Open the file you just downloaded.",
                "<b>If Windows shows a blue “Windows protected your PC” "
                "box:</b> click <b>More info</b>, then <b>Run anyway</b>. "
                "This is normal — Windows shows it for any app it has not "
                "seen before.",
                "Click <b>Next</b> through the screens. Tick <b>Create a "
                "desktop shortcut</b> if you would like one.",
                "Click <b>Install</b>.",
            ]
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        para(
            "When it finishes you will have an <b>Eternalgy CRM</b> "
            "shortcut on your desktop and in the Start Menu."
        )
    )

    story.append(h3("Step 3 — Open it"))
    story.append(
        para(
            "<b>Start Menu → Eternalgy CRM</b> (or the desktop "
            "shortcut)."
        )
    )
    story.append(
        para(
            "The first time you open it, the window may stay blank for a "
            "few seconds while it starts up. This is normal and only "
            "happens on the first launch. You should then see the "
            "<b>Dashboard</b> directly — no login screen, no setup box. "
            "The app is already connected."
        )
    )
    story.append(
        callout(
            "Signing in only happens when you make a change",
            [
                "You can look around freely without signing in. The moment "
                "you try to <b>add or edit a case</b>, a Staff Login box "
                "appears asking for your name and password — this records "
                "who made each change. If your name isn't listed, ask "
                "whoever manages Staff Accounts to add you.",
            ],
        )
    )

    # Part 2 — updating
    story.append(eyebrow("Part 2"))
    story.append(h2("Part 2 — Updating"))
    story.append(
        para(
            "<b>There is no update button.</b> The app checks for new "
            "versions by itself in the background, downloads quietly if "
            "one is found, and installs it automatically the next time you "
            "close and reopen the app."
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        callout(
            "Things worth knowing",
            [
                "<b>Nothing of yours is lost.</b> All case data lives in "
                "the shared cloud database, not on your PC, so an update "
                "never touches it.",
                "<b>You never download the installer again.</b> Steps 1–3 "
                "above are one time only.",
                "<b>You won't see a progress bar or a prompt.</b> The whole "
                "process is silent — close the app, and next time you open "
                "it you're on the new version.",
                "<b>To check your version:</b> Settings &#8594; Apps "
                "&#8594; Eternalgy CRM. The app itself does not show "
                "a version number on screen.",
            ],
            accent=BLUE,
            background=BLUE_BG,
        )
    )

    # Troubleshooting
    story.append(eyebrow("Troubleshooting"))
    story.append(h2("If something goes wrong"))
    story.append(
        data_table(
            ["What you see", "What to do"],
            [
                [
                    "Blue “Windows protected your PC” screen",
                    "Normal. Click <b>More info</b> → <b>Run anyway</b>",
                ],
                [
                    "Window is blank for a few seconds",
                    "Normal on first launch. If still blank after 10s, "
                    "close it completely and reopen",
                ],
                [
                    f'“<b>{cjk("保存失败")} / Save failed</b>” message',
                    "Serious — the change did <b>not</b> save. Check your "
                    "internet and try again",
                ],
                [
                    f'“<b>Postgres {cjk("同步失败")} / sync failed</b>” message',
                    "Your change <b>was</b> saved. A background copy "
                    "failed — no need to redo anything, just tell Nurul",
                ],
                [
                    "Login box won't accept your name/password",
                    "Your account may not exist yet, or the password "
                    "changed. Ask whoever manages Staff Accounts",
                ],
                ["App will not start at all", "Restart your PC, then try again"],
                [
                    "Anything else",
                    "Contact Nurul. Say what you were doing and what you saw",
                ],
            ],
            widths=[CONTENT_W * 0.42, CONTENT_W * 0.58],
        )
    )

    # Kept together so the closing note never orphans onto a page of its own.
    story.append(
        KeepTogether(
            [
                Spacer(1, 14),
                callout(
                    "Please report problems rather than working around them.",
                    [
                        "The two message types above look similar but mean "
                        "very different things — worth reading carefully "
                        "rather than clicking past them.",
                        "<b>Nurul</b> — for anything about the app: "
                        "problems, questions, or suggestions for what would "
                        "make it easier to use.",
                    ],
                    accent=BLUE,
                    background=BLUE_BG,
                ),
                Spacer(1, 14),
                para(
                    f"<font color='#64748B' size='9'>This is version {VERSION}. "
                    "Nothing is stored on your PC — all case data lives in "
                    "the shared cloud database, so there is nothing to "
                    "back up and nothing lost if your PC is replaced. To "
                    "uninstall: Settings → Apps → Eternalgy CRM → "
                    "Uninstall.</font>"
                ),
            ]
        )
    )

    return story


def main():
    global S
    register_fonts()
    S = build_styles()

    OUT.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(OUT),
        pagesize=A4,
        title="Eternalgy CRM \u2014 Install & Update Guide",
        author="Eternalgy",
        subject="CRM user guide",
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
    )

    cover_frame = Frame(
        MARGIN,
        46,
        CONTENT_W,
        PAGE_H - HEADER_H - 46 - 22,
        id="cover",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    body_frame = Frame(
        MARGIN,
        46,
        CONTENT_W,
        PAGE_H - BANNER_H - 46 - 26,
        id="body",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )

    doc.addPageTemplates(
        [
            PageTemplate(id="cover", frames=[cover_frame], onPage=on_first_page),
            PageTemplate(id="body", frames=[body_frame], onPage=on_later_pages),
        ]
    )

    doc.build(build_story())
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
