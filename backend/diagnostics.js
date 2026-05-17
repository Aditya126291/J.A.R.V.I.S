/**
 * J.A.R.V.I.S. Diagnostics & Verification Suite
 * Runs tests against the AI Router, executes model negotiation validation,
 * and outputs a rich diagnostic report confirming key stability and model health.
 */

const aiRouter = require('./modules/ai_router');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDiagnostics() {
  console.log('====================================================');
  console.log('       J.A.R.V.I.S. DIAGNOSTICS & SYSTEM RESTORE     ');
  console.log('====================================================');
  console.log('[1/3] Waiting for boot negotiation to settle...');
  
  // Wait 5 seconds for background initial health check / negotiation to run
  await delay(5000);
  
  console.log('\n[2/3] Retrieving AI Router Status:');
  const status = aiRouter.getStatus();
  console.log(`Active Provider:      ${status.activeProvider}`);
  console.log(`Active Provider Name: ${status.activeProviderName}`);
  console.log('--- Providers Registered ---');
  status.providers.forEach(p => {
    console.log(`- [${p.id}] ${p.name}`);
    console.log(`  Configured:  ${p.configured}`);
    console.log(`  Available:   ${p.available}`);
    console.log(`  Fail Count:  ${p.failCount}`);
    console.log(`  Last Error:  ${p.lastErrorCode ? `[${p.lastErrorCode}] ${p.lastError}` : 'None'}`);
  });
  console.log('-----------------------------');
  
  console.log('\n[3/3] Sending test payload to settled AI Router...');
  try {
    const testPrompt = "Jarvis, what is your name?";
    console.log(`Sending user prompt: "${testPrompt}"`);
    
    const response = await aiRouter.chat(testPrompt);
    
    console.log('\n=================== RESPONSE RECEIVED ===================');
    console.log('Success:         ', response.success);
    console.log('Speech Output:   ', response.speech);
    console.log('Legacy Response: ', response.response);
    console.log('Actions Triggered:', JSON.stringify(response.actions));
    console.log('Current Status:  ', response.status);
    console.log('Active Provider: ', response.provider);
    if (response.providerSwitch) {
      console.log('Provider Switch: ', JSON.stringify(response.providerSwitch));
    }
    console.log('=========================================================');
    
    // Check if active provider is NOT emergency mode
    if (response.provider !== 'Emergency Mode' && response.provider !== 'none') {
      console.log('\n[DIAGNOSTICS SUCCESS] J.A.R.V.I.S. AI Router has successfully recovered!');
      console.log('Primary/Fallback models are functioning and authenticated.');
      aiRouter.stopHealthMonitor();
      process.exit(0);
    } else {
      console.error('\n[DIAGNOSTICS FAILURE] Fallback occurred. Router is in Emergency Mode.');
      console.error('Please verify API keys and credentials.');
      aiRouter.stopHealthMonitor();
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[DIAGNOSTICS EXCEPTION] An error occurred during chat execution:', err);
    aiRouter.stopHealthMonitor();
    process.exit(1);
  }
}

runDiagnostics();
