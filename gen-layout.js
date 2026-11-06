const fs = require('fs');
const PM = require('./omr-core.js');
const lay = PM.layout(30, 4, 6);
fs.writeFileSync(__dirname + '/layout.json', JSON.stringify(lay));
console.log('layout written', lay.fmt, lay.cols, lay.rows, lay.qs.length);
