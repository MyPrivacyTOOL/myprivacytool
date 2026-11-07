import assert from 'node:assert/strict';
import { countSentence } from './countSentence.js';
assert.equal(countSentence(), '54 run in the scan, 368 in the catalogue');
console.log('countSentence ok');
