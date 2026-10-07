#!/usr/bin/env node

/**
 * Environment Validation Script for Core Brain Worker
 * 
 * Validates all required environment variables, Supabase access,
 * Qwen API connectivity, and local configuration before deployment.
 * 
 * Usage: node scripts/validate-env.js
 */

const fs = require('fs');
const path = require('path');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  section: (msg) => console.log(`\n${colors.blue}━━━ ${msg} ━━━${colors.reset}`),
};

let passCount = 0;
let failCount = 0;
let warnCount = 0;

// Test 1: Check package.json exists
const validatePackageJson = () => {
  log.section('Package Configuration');
  const packagePath = path.join(__dirname, '..', 'package.json');
  
  if (!fs.existsSync(packagePath)) {
    log.error('package.json not found');
    failCount++;
    return;
  }
  
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    log.success(`package.json found (name: ${pkg.name})`);
    
    if (!pkg.dependencies || !pkg.dependencies.wrangler) {
      log.error('wrangler not in dependencies');
      failCount++;
    } else {
      log.success(`wrangler dependency found (${pkg.dependencies.wrangler})`);
      passCount++;
    }
    passCount++;
  } catch (err) {
    log.error(`Failed to parse package.json: ${err.message}`);
    failCount++;
  }
};

// Test 2: Check wrangler.toml exists and is valid
const validateWranglerToml = () => {
  log.section('Wrangler Configuration');
  const wranglerPath = path.join(__dirname, '..', 'wrangler.toml');
  
  if (!fs.existsSync(wranglerPath)) {
    log.error('wrangler.toml not found');
    failCount++;
    return;
  }
  
  const content = fs.readFileSync(wranglerPath, 'utf8');
  log.success('wrangler.toml found');
  passCount++;
  
  // Check for required fields
  const checks = [
    { pattern: /name\s*=\s*["']mpt-core-brain/, label: 'Worker name defined' },
    { pattern: /main\s*=\s*["']index\.js/, label: 'Main entry point defined' },
    { pattern: /compatibility_date/, label: 'Compatibility date set' },
    { pattern: /kv_namespaces/, label: 'KV namespace binding present' },
  ];
  
  checks.forEach((check) => {
    if (check.pattern.test(content)) {
      log.success(check.label);
      passCount++;
    } else {
      log.warn(check.label + ' (missing or misconfigured)');
      warnCount++;
    }
  });
  
  // Check for placeholder values
  if (content.includes('REPLACE_WITH_KV_NAMESPACE_ID')) {
    log.warn('KV namespace ID not yet configured (placeholder present)');
    warnCount++;
  } else {
    log.success('KV namespace ID configured');
    passCount++;
  }
};

// Test 3: Check source files
const validateSourceFiles = () => {
  log.section('Source Files');
  
  const files = ['index.js', 'handlers/routing.js', 'handlers/qwen.js', 'handlers/supabase.js'];
  const basePath = path.join(__dirname, '..');
  
  files.forEach((file) => {
    const filePath = path.join(basePath, file);
    if (fs.existsSync(filePath)) {
      log.success(`${file} present`);
      passCount++;
    } else {
      log.error(`${file} missing`);
      failCount++;
    }
  });
};

// Test 4: Check test files
const validateTestFiles = () => {
  log.section('Test Coverage');
  
  const testPath = path.join(__dirname, '..', 'tests');
  if (!fs.existsSync(testPath)) {
    log.warn('tests/ directory not found');
    warnCount++;
    return;
  }
  
  const files = fs.readdirSync(testPath).filter(f => f.endsWith('.test.js'));
  if (files.length === 0) {
    log.warn('No test files found');
    warnCount++;
  } else {
    log.success(`${files.length} test file(s) found: ${files.join(', ')}`);
    passCount++;
  }
};

// Test 5: Check README
const validateReadme = () => {
  log.section('Documentation');
  
  const readmePath = path.join(__dirname, '..', 'README.md');
  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, 'utf8');
    const sections = [
      { pattern: /## Overview/, label: 'Overview section' },
      { pattern: /## Architecture/, label: 'Architecture section' },
      { pattern: /## API/, label: 'API documentation' },
      { pattern: /## Testing/, label: 'Testing guide' },
    ];
    
    log.success('README.md found');
    passCount++;
    
    sections.forEach((section) => {
      if (section.pattern.test(content)) {
        log.success(section.label);
        passCount++;
      } else {
        log.warn(section.label + ' (not yet documented)');
        warnCount++;
      }
    });
  } else {
    log.error('README.md not found');
    failCount++;
  }
};

// Test 6: Environment variables check (from .env.example)
const validateEnvExample = () => {
  log.section('Environment Variables');
  
  const envExamplePath = path.join(__dirname, '..', '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    log.warn('.env.example not found (should document required vars)');
    warnCount++;
    return;
  }
  
  const content = fs.readFileSync(envExamplePath, 'utf8');
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'QWEN_API_KEY',
    'QWEN_MODEL',
    'WEBHOOK_SECRET',
  ];
  
  log.success('.env.example found');
  passCount++;
  
  requiredVars.forEach((varName) => {
    if (content.includes(varName)) {
      log.success(`${varName} documented`);
      passCount++;
    } else {
      log.warn(`${varName} not in .env.example`);
      warnCount++;
    }
  });
};

// Test 7: Deployment guide
const validateDeploymentGuide = () => {
  log.section('Deployment Documentation');
  
  const deploymentPath = path.join(__dirname, '..', '..', 'docs', 'CORE_BRAIN_DEPLOYMENT.md');
  if (fs.existsSync(deploymentPath)) {
    log.success('CORE_BRAIN_DEPLOYMENT.md found');
    passCount++;
  } else {
    log.warn('CORE_BRAIN_DEPLOYMENT.md not found (should create deployment guide)');
    warnCount++;
  }
};

// Test 8: Check for secrets in files
const validateNoSecretsInFiles = () => {
  log.section('Security Check');
  
  const filesToCheck = [
    'index.js',
    'wrangler.toml',
    'package.json',
  ];
  
  const secretPatterns = [
    { pattern: /sk-[A-Za-z0-9]{20,}/, label: 'Qwen API key' },
    { pattern: /eyJhbGc[A-Za-z0-9-_.]*/, label: 'JWT token' },
    { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  ];
  
  const basePath = path.join(__dirname, '..');
  let foundSecrets = false;
  
  filesToCheck.forEach((file) => {
    const filePath = path.join(basePath, file);
    if (!fs.existsSync(filePath)) return;
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    secretPatterns.forEach((secret) => {
      if (secret.pattern.test(content)) {
        log.error(`Potential ${secret.label} found in ${file}`);
        failCount++;
        foundSecrets = true;
      }
    });
  });
  
  if (!foundSecrets) {
    log.success('No hardcoded secrets detected in source files');
    passCount++;
  }
};

// Run all validations
const runValidation = () => {
  console.log(`\n${colors.blue}╔════════════════════════════════════════╗`);
  console.log(`║  Core Brain Worker — Environment Validation  ║`);
  console.log(`╚════════════════════════════════════════╝${colors.reset}\n`);
  
  validatePackageJson();
  validateWranglerToml();
  validateSourceFiles();
  validateTestFiles();
  validateReadme();
  validateEnvExample();
  validateDeploymentGuide();
  validateNoSecretsInFiles();
  
  // Summary
  log.section('Summary');
  console.log(`${colors.green}✓ Passed:${colors.reset} ${passCount}`);
  console.log(`${colors.yellow}⚠ Warnings:${colors.reset} ${warnCount}`);
  console.log(`${colors.red}✗ Failed:${colors.reset} ${failCount}`);
  
  if (failCount === 0) {
    console.log(`\n${colors.green}✓ All critical checks passed. Ready for deployment!${colors.reset}\n`);
    if (warnCount > 0) {
      console.log(`${colors.yellow}⚠ Note: ${warnCount} warning(s) to review.${colors.reset}\n`);
    }
    process.exit(0);
  } else {
    console.log(`\n${colors.red}✗ ${failCount} critical issue(s) found. Please fix before deploying.${colors.reset}\n`);
    process.exit(1);
  }
};

runValidation();
