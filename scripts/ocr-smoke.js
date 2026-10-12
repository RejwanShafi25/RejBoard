// Smoke test for the bundled Tesseract.js path (run on Linux after `npm run libs:linux`).
// Reads test/hello.png entirely from memory using the same code the app uses.
const fs = require('fs'), os = require('os'), path = require('path');
const { _test } = require('../ocr.js');
(async () => {
  const root = _test.tessJsRoot();
  if (!root) { console.error('FAIL: bundled tesseract.js not found (run: npm run libs:linux)'); process.exit(1); }
  const png = fs.readFileSync(path.join(__dirname, '..', 'test', 'hello.png'));
  const text = await _test.viaTesseractJs(png, 'en', os.tmpdir());
  await _test.killWorker();
  console.log('OCR result:', JSON.stringify(text));
  if (!/hello/i.test(text)) { console.error('FAIL: expected "hello"'); process.exit(1); }
  console.log('OK');
})().catch(e => { console.error('FAIL:', e && e.message || e); process.exit(1); });
