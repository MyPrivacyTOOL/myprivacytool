import assert from 'node:assert/strict';
import { countSentence } from './countSentence.js';
assert.equal(countSentence(), '54 run in the scan');
assert.ok(!/\d{3}/.test(countSentence()), 'no catalogue total in the sentence (MPC-11541)');
console.log('countSentence ok');
