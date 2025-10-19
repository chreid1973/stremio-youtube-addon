// Shim so Render starts even if it insists on `node index.js`
try {
  require('./index.cjs');
} catch (err) {
  console.error(err);
  process.exit(1);
}
