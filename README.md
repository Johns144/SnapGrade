# SnapGrade

An answer-sheet grader for classroom exams, built for Grade 11 teachers. It works online and offline.

- **Exams:** write items, or paste/upload a questionnaire with its answer key. Supports 15, 20, 30 or 60 items (or custom, up to 60) with 2 to 5 choices.
- **Answer sheets:** prints a bubble sheet as a PDF (A4 or Letter) with a student ID grid.
- **Scanning:** reads filled sheets from a photo or the camera, including tilted or rotated photos. It flags blank and double marks.
- **Online exams:** students take the exam on their phone or laptop. Leaving the page (switching tabs or apps) is recorded. At the end each student gets a code to send to the teacher.
- **Offline exam file:** one HTML file students can open in any browser without internet.
- **Results:** scores, DepEd transmuted grades, pass marks, and CSV export.
- **Quiz menu:** Details and Statistics (min, max, average, median, standard deviation).
- **Item analysis:** difficulty index, D.F. (the correlation between getting an item right and the total score) and choice counts for every item.
- **MPS:** mean percentage score with the DepEd mastery level, for each exam and for each tag.

## Files

| File | What it is |
| --- | --- |
| `shell.html` | Page skeleton and all styles |
| `omr-core.js` | Scanner, grading, statistics and the PDF answer-sheet writer (no dependencies) |
| `app-common.js` | Small shared helpers |
| `app-student.js` | Student exam screen |
| `app-teacher.js` | Teacher workspace |
| `build.js` | Joins everything into `pencilmark.html` |
| `pencilmark.html` | The built app (one self-contained file) |

The app is designed to run as a Claude artifact. Online storage, the student link and downloads use the artifact runtime (`window.claude`). Opened as a plain HTML file, the exam editor, scanner and offline features still work and keep data in the browser.

## Build and test

Needs Node 18 or newer. The browser test also needs Playwright with Chromium, and the PDF test needs Python 3 with Pillow, NumPy and `pdftoppm` (poppler-utils).

```sh
npm run build          # writes pencilmark.html
npm test               # logic, scanner and PDF tests
npm run test:browser   # real-browser run (Playwright)
```

After changing any source file, run `npm run build` and commit the rebuilt `pencilmark.html` with it.
