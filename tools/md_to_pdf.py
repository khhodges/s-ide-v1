import sys
import re
from fpdf import FPDF

md_path = sys.argv[1]
pdf_path = sys.argv[2]

with open(md_path, 'r') as f:
    lines = f.readlines()

class DocPDF(FPDF):
    def header(self):
        pass
    def footer(self):
        self.set_y(-15)
        self.set_font('DejaVu', '', 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', align='C')

pdf = DocPDF('P', 'mm', 'A4')
pdf.alias_nb_pages()
pdf.set_auto_page_break(auto=True, margin=20)

pdf.add_font('DejaVu', '', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf')
pdf.add_font('DejaVu', 'B', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf')
pdf.add_font('DejaVuSans', '', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
pdf.add_font('DejaVuSans', 'B', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
pdf.add_font('DejaVuMono', '', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
pdf.add_font('DejaVuMono', 'B', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf')

FONT = 'DejaVu'
MONO = 'DejaVuMono'

pdf.add_page()
pdf.set_fill_color(255, 255, 255)

def set_body():
    pdf.set_font(FONT, '', 10)
    pdf.set_text_color(17, 17, 17)

def render_inline(text, base_style=''):
    parts = re.split(r'(\*\*.*?\*\*|\*[^*]+\*|`[^`]+`)', text)
    for part in parts:
        if part.startswith('**') and part.endswith('**'):
            pdf.set_font(FONT, 'B', 10)
            pdf.write(5.5, part[2:-2])
            pdf.set_font(FONT, base_style, 10)
        elif part.startswith('*') and part.endswith('*') and not part.startswith('**'):
            pdf.set_font(FONT, '', 10)
            pdf.set_text_color(60, 60, 60)
            pdf.write(5.5, part[1:-1])
            pdf.set_text_color(17, 17, 17)
            pdf.set_font(FONT, base_style, 10)
        elif part.startswith('`') and part.endswith('`'):
            pdf.set_font(MONO, '', 9)
            pdf.write(5.5, part[1:-1])
            pdf.set_font(FONT, base_style, 10)
        else:
            pdf.write(5.5, part)

def write_paragraph(text):
    set_body()
    render_inline(text)
    pdf.ln(7)

def write_table(table_lines):
    rows = []
    for tl in table_lines:
        tl = tl.strip()
        if tl.startswith('|') and tl.endswith('|'):
            cells = [c.strip() for c in tl[1:-1].split('|')]
            if any(set(c) <= set('- :') for c in cells):
                continue
            rows.append(cells)
    if not rows:
        return

    num_cols = len(rows[0])
    usable_w = 170
    col_w = usable_w / num_cols

    pdf.set_font(FONT, 'B', 8)
    pdf.set_fill_color(232, 232, 232)
    pdf.set_draw_color(153, 153, 153)
    for cell in rows[0]:
        clean = re.sub(r'\*\*|`', '', cell)
        pdf.cell(col_w, 6.5, clean[:45], border=1, fill=True)
    pdf.ln()

    pdf.set_font(FONT, '', 8)
    alt_fill = False
    for row in rows[1:]:
        if alt_fill:
            pdf.set_fill_color(247, 247, 247)
        else:
            pdf.set_fill_color(255, 255, 255)
        for cell in row:
            clean = re.sub(r'\*\*|`', '', cell)
            pdf.cell(col_w, 6.5, clean[:55], border=1, fill=True)
        pdf.ln()
        alt_fill = not alt_fill
    pdf.set_fill_color(255, 255, 255)
    pdf.ln(4)

i = 0
in_code_block = False
code_lines = []
in_table = False
table_lines = []
para_buffer = ''

def flush_para():
    global para_buffer
    if para_buffer.strip():
        text = para_buffer.strip()
        if text.startswith('> '):
            x = pdf.get_x()
            y = pdf.get_y()
            pdf.set_draw_color(153, 153, 153)
            pdf.line(23, y, 23, y + 10)
            pdf.set_x(27)
            pdf.set_font(FONT, '', 9.5)
            pdf.set_text_color(68, 68, 68)
            clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', text[2:])
            pdf.multi_cell(153, 5, clean)
            pdf.set_text_color(17, 17, 17)
            pdf.ln(4)
        else:
            write_paragraph(text)
    para_buffer = ''

while i < len(lines):
    line = lines[i]
    raw = line.rstrip('\n')

    if raw.startswith('```'):
        if in_code_block:
            in_code_block = False
            pdf.set_font(MONO, '', 7.5)
            pdf.set_fill_color(244, 244, 244)
            pdf.set_draw_color(221, 221, 221)
            block_h = len(code_lines) * 4 + 6
            if pdf.get_y() + block_h > 277:
                pdf.add_page()
            y_top = pdf.get_y()
            pdf.rect(18, y_top, 174, block_h, 'DF')
            pdf.set_xy(22, y_top + 3)
            for cl in code_lines:
                pdf.cell(0, 4, cl)
                pdf.ln(4)
            pdf.ln(4)
            pdf.set_fill_color(255, 255, 255)
            code_lines = []
        else:
            flush_para()
            in_code_block = True
        i += 1
        continue

    if in_code_block:
        code_lines.append(raw)
        i += 1
        continue

    if raw.startswith('|'):
        if not in_table:
            flush_para()
            in_table = True
            table_lines = []
        table_lines.append(raw)
        i += 1
        continue
    elif in_table:
        write_table(table_lines)
        in_table = False
        table_lines = []

    if raw.startswith('# ') and not raw.startswith('##'):
        flush_para()
        pdf.set_font(FONT, 'B', 18)
        pdf.set_text_color(17, 17, 17)
        pdf.cell(0, 10, raw[2:])
        pdf.ln(12)
        pdf.set_draw_color(51, 51, 51)
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())
        pdf.ln(6)
        set_body()
        i += 1
        continue

    if raw.startswith('## '):
        flush_para()
        pdf.ln(3)
        pdf.set_font(FONT, 'B', 13)
        pdf.set_text_color(26, 26, 46)
        pdf.cell(0, 9, raw[3:])
        pdf.ln(10)
        pdf.set_draw_color(204, 204, 204)
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())
        pdf.ln(3)
        set_body()
        i += 1
        continue

    if raw.startswith('### '):
        flush_para()
        pdf.ln(2)
        pdf.set_font(FONT, 'B', 11)
        pdf.set_text_color(51, 51, 51)
        pdf.cell(0, 8, raw[4:])
        pdf.ln(9)
        set_body()
        i += 1
        continue

    if raw.strip() == '---':
        flush_para()
        pdf.ln(2)
        i += 1
        continue

    if raw.strip() == '':
        flush_para()
        i += 1
        continue

    if raw.startswith('- '):
        flush_para()
        pdf.set_x(25)
        set_body()
        pdf.write(5.5, '\u2022  ')
        render_inline(raw[2:])
        pdf.ln(7)
        i += 1
        continue

    numbered = re.match(r'^(\d+)\.\s+(.*)', raw)
    if numbered:
        flush_para()
        pdf.set_x(25)
        set_body()
        pdf.set_font(FONT, 'B', 10)
        pdf.write(5.5, f'{numbered.group(1)}.  ')
        set_body()
        render_inline(numbered.group(2))
        pdf.ln(7)
        i += 1
        continue

    para_buffer += ' ' + raw if para_buffer else raw
    i += 1

flush_para()
if in_table:
    write_table(table_lines)

pdf.output(pdf_path)
print(f"PDF written to {pdf_path}")
