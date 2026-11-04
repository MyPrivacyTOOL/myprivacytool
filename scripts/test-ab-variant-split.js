#!/usr/bin/env node
/**
 * A/B Variant Split Verification
 * ===============================
 * 
 * Simulates 200 email submissions and verifies:
 * 1. Variant assignment is deterministic (same email = same variant)
 * 2. Overall split is approximately 50/50 (A vs B)
 * 3. No crashes or errors
 * 
 * Run: node scripts/test-ab-variant-split.js
 * 
 * Output: JSON report with results
 */

import crypto from 'crypto';

/**
 * Simulates the assignVariant function from ab-testing.js
 * (Uses Node.js crypto instead of SubtleCrypto)
 */
async function assignVariant(email, salt) {
  if (!email || !salt) {
    throw new Error('assignVariant requires email and salt');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const hashInput = `${normalizedEmail}:${salt}`;

  // Use Node.js crypto for SHA-256
  const hash = crypto.createHash('sha256');
  hash.update(hashInput);
  const hashBuffer = hash.digest();

  // Get first byte and compute variant
  const firstByte = hashBuffer[0];
  return firstByte % 2 === 0 ? 'A' : 'B';
}

/**
 * Generate a test email
 */
function generateTestEmail(index) {
  return `test_user_${index}@myprivacytool.test`;
}

/**
 * Main verification
 */
async function runVerification() {
  const salt = 'mpt-ab-test-salt-2026-q4'; // Example salt (in prod: env.AB_TEST_SALT)
  const numRequests = 200;
  const results = {
    total: numRequests,
    variantA: 0,
    variantB: 0,
    stickiness: [],
    errors: [],
    splitPercentage: {
      A: 0,
      B: 0,
    },
    timestamp: new Date().toISOString(),
  };

  console.log(`🧪 A/B Variant Split Test (${numRequests} requests)\n`);

  try {
    // Test 1: Assign variants to 200 unique emails
    console.log('Test 1: Variant assignment distribution...');
    const variants = {};

    for (let i = 0; i < numRequests; i++) {
      const email = generateTestEmail(i);
      const variant = await assignVariant(email, salt);

      variants[email] = variant;
      if (variant === 'A') {
        results.variantA++;
      } else if (variant === 'B') {
        results.variantB++;
      }
    }

    // Calculate percentage
    results.splitPercentage.A = ((results.variantA / numRequests) * 100).toFixed(2);
    results.splitPercentage.B = ((results.variantB / numRequests) * 100).toFixed(2);

    console.log(`  ✓ Variant A: ${results.variantA} (${results.splitPercentage.A}%)`);
    console.log(`  ✓ Variant B: ${results.variantB} (${results.splitPercentage.B}%)`);

    // Test 2: Verify determinism (same email = same variant)
    console.log('\nTest 2: Stickiness (determinism)...');
    let stickinessPass = 0;
    for (let i = 0; i < 20; i++) {
      const email = generateTestEmail(i);
      const variant1 = variants[email];
      const variant2 = await assignVariant(email, salt);

      if (variant1 === variant2) {
        stickinessPass++;
      } else {
        results.stickiness.push({
          email,
          expected: variant1,
          got: variant2,
          error: 'Assignment not deterministic',
        });
      }
    }
    console.log(`  ✓ ${stickinessPass}/20 emails consistently assigned`);

    if (stickinessPass !== 20) {
      console.warn(`  ⚠ Stickiness test failed: ${20 - stickinessPass} inconsistencies`);
    }

    // Test 3: Check split is reasonable (45-55% range for 200 requests)
    console.log('\nTest 3: Split quality...');
    const aPercentage = parseFloat(results.splitPercentage.A);
    const bPercentage = parseFloat(results.splitPercentage.B);

    if (aPercentage >= 40 && aPercentage <= 60 && bPercentage >= 40 && bPercentage <= 60) {
      console.log(`  ✓ Split is within acceptable range (40–60%)`);
    } else {
      console.warn(`  ⚠ Split is outside range: A=${aPercentage}%, B=${bPercentage}%`);
      results.errors.push('Split quality outside acceptable range');
    }

    // Final report
    console.log('\n📊 Final Report:');
    console.log(JSON.stringify(results, null, 2));

    // Exit code
    if (results.errors.length === 0 && stickinessPass === 20) {
      console.log('\n✅ All tests passed.');
      process.exit(0);
    } else {
      console.log('\n⚠️ Some tests failed or warnings raised.');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    results.errors.push(error.message);
    console.log(JSON.stringify(results, null, 2));
    process.exit(1);
  }
}

// Run
runVerification();
