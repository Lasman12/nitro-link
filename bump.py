# מעדכן מספר גרסה בכל הקישורים לקבצי המשחק, כדי שהדפדפן לא יערבב קבצים ישנים עם חדשים אחרי עדכון.
# מריצים לפני כל העלאה:  python bump.py
import io, re, time, glob

v = str(int(time.time()))
for path in glob.glob('js/*.js'):
    s = io.open(path, encoding='utf-8').read()
    n = re.sub(r"(from\s+'\./[\w.-]+\.js)(\?v=\d+)?'", lambda m: f"{m.group(1)}?v={v}'", s)
    if n != s:
        io.open(path, 'w', encoding='utf-8', newline='\n').write(n)
s = io.open('index.html', encoding='utf-8').read()
s = re.sub(r'(js/main\.js|css/style\.css)(\?v=\d+)?"', lambda m: f'{m.group(1)}?v={v}"', s)
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(s)
print('version', v)
