#!/usr/bin/env python3
"""Generate a realistic multi-page sample screenplay PDF for the reader mock.
Industry-standard formatting: Courier 12pt, proper margins per element type."""
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch

OUT = "sample-script.pdf"
W, H = letter
FONT = "Courier"
SIZE = 12
LH = 12 * 1.0  # single-space line height in points (12pt courier)

# left margins (inches) per element type
M = {
    "scene":   1.5, "action": 1.5, "char": 3.7,
    "paren":   3.1, "dialog": 2.5, "trans": 6.0, "page": 7.5,
}
RIGHT = 1.0
TOP = 1.0

def wrap(text, max_chars):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= max_chars:
            cur = (cur + " " + w).strip()
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

# (type, text) — a short, atmospheric sample so the page rhythm reads true.
SCRIPT = [
    ("scene", "INT. DISPATCH OFFICE — NIGHT"),
    ("action", "Rain sheets the windows. A wall of monitors throws blue light across MARA REYES (40s), headset on, the only soul awake on the graveyard shift. A single red line blinks on the board."),
    ("char", "MARA"),
    ("dialog", "Midnight Line, this is dispatch. Say again your location."),
    ("action", "Static. Then a voice — calm, too calm."),
    ("char", "VOICE (V.O.)"),
    ("dialog", "You already know where I am, Mara. You've always known."),
    ("action", "Mara's hand freezes over the keyboard. She has never given this caller her name."),
    ("char", "MARA"),
    ("paren", "(steadying herself)"),
    ("dialog", "I'm going to need you to stay on the line with me. Can you do that?"),
    ("char", "VOICE (V.O.)"),
    ("dialog", "I can do that. The question is whether you can."),
    ("trans", "CUT TO:"),
    ("scene", "EXT. RIVERSIDE — CONTINUOUS"),
    ("action", "A payphone, impossibly, still standing. The receiver swings on its cord. No one is there. Headlights smear across the wet asphalt and are gone."),
    ("char", "VOICE (V.O.)"),
    ("dialog", "Twelve calls. Twelve nights. You wrote them all down because you thought writing it down would make it yours. It doesn't work that way."),
    ("action", "Back in the office, Mara pulls a worn notebook from the drawer. Pages of handwriting. Dates. Times. The same number every night."),
    ("char", "MARA"),
    ("dialog", "What do you want from me?"),
    ("char", "VOICE (V.O.)"),
    ("dialog", "To be heard. Same as everyone who's ever dialed these three numbers in the dark. Same as you, the night you didn't pick up."),
    ("action", "Mara closes her eyes. Thunder. When she opens them the red line has gone dark — and every other line on the board is lit."),
    ("char", "MARA"),
    ("paren", "(whisper)"),
    ("dialog", "Oh god. They're all calling at once."),
    ("trans", "SMASH CUT TO:"),
    ("scene", "INT. DISPATCH OFFICE — MOMENTS LATER"),
    ("action", "Mara stands, headset cord stretched taut. Forty lines blinking. She reaches for the master switch — and stops. Her own handwriting stares back from the notebook: DON'T HANG UP ON THEM. NOT AGAIN."),
    ("char", "MARA"),
    ("dialog", "Okay. Okay. One at a time. I'm here. I'm listening."),
    ("action", "She presses the first line. Breathes. Begins."),
    ("trans", "FADE OUT."),
]

c = canvas.Canvas(OUT, pagesize=letter)

def new_page(num):
    c.setFont(FONT, SIZE)
    if num > 1:
        c.drawRightString(W - M["page"]*inch + 6.5*inch, H - 0.5*inch, f"{num}.")

page = 1
new_page(page)
y = H - TOP*inch
# title block on page 1
c.setFont("Courier-Bold", SIZE)
c.drawCentredString(W/2, y - 1.2*inch, "THE MIDNIGHT LINE")
c.setFont(FONT, SIZE)
c.drawCentredString(W/2, y - 1.2*inch - 2*LH, "Written by")
c.drawCentredString(W/2, y - 1.2*inch - 4*LH, "A. Sample")
c.showPage()
page += 1
new_page(page)
y = H - TOP*inch

def line(s, left):
    global y, page
    if y < 1.0*inch:
        c.showPage(); page += 1; new_page(page); y = H - TOP*inch
    c.setFont(FONT, SIZE)
    c.drawString(left*inch, y, s)
    y -= LH

usable = W - RIGHT*inch
for typ, text in SCRIPT:
    left = M[typ]
    maxchars = int((usable - left*inch) / (SIZE*0.6))
    if typ in ("scene",):
        y -= LH  # blank line before scene heading
        line(text.upper(), left)
        y -= 0  # heading hugs its action
    elif typ == "char":
        y -= LH
        line(text.upper(), left)
    elif typ == "trans":
        y -= LH
        if y < 1.0*inch:
            c.showPage(); page += 1; new_page(page); y = H - TOP*inch
        c.setFont(FONT, SIZE)
        c.drawRightString(usable, y, text.upper()); y -= LH
    elif typ == "paren":
        for ln in wrap(text, maxchars):
            line(ln, left)
    elif typ == "dialog":
        for ln in wrap(text, maxchars):
            line(ln, left)
    else:  # action
        y -= LH
        for ln in wrap(text, maxchars):
            line(ln, left)

c.showPage()
c.save()
print("wrote", OUT, "pages:", page)
